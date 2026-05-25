"""Orquestra containers Hermes — 1 por tenant.

Isolamento total via Docker volume + HERMES_HOME por tenant. Cada container
expõe REST API OpenAI-compatible numa porta dinâmica do range configurado.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import docker
import redis.asyncio as redis_async
from docker.errors import APIError, NotFound
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt
from models import TaContainer, TaLlmProvider

logger = logging.getLogger(__name__)
settings = get_settings()

_client: docker.DockerClient | None = None


def docker_client() -> docker.DockerClient:
    global _client
    if _client is None:
        _client = docker.DockerClient(base_url=settings.docker_host)
    return _client


@dataclass
class ContainerSpec:
    tenant_id: int
    llm_provider: str
    llm_model: str
    llm_api_key: str
    feature_flags: dict
    statement_descriptor: str = ""


# ============================================================
# Port pool — Redis-based (evita conflito multi-instância)
# ============================================================
_PORT_POOL_KEY = "tier_agent:port_pool"


async def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.redis_url, decode_responses=True)


async def acquire_port() -> int:
    """Acquire a port from the configured range using Redis SETNX."""
    r = await _redis()
    for port in range(settings.hermes_port_range_start, settings.hermes_port_range_end + 1):
        key = f"{_PORT_POOL_KEY}:{port}"
        if await r.set(key, "1", nx=True, ex=86400 * 30):
            return port
    raise RuntimeError("No free ports in Hermes range")


async def release_port(port: int) -> None:
    r = await _redis()
    await r.delete(f"{_PORT_POOL_KEY}:{port}")


# ============================================================
# Container lifecycle
# ============================================================
def container_name(tenant_id: int) -> str:
    return f"tier-hermes-tenant-{tenant_id}"


def volume_name(tenant_id: int) -> str:
    return f"tier-hermes-vol-{tenant_id}"


async def create_container(spec: ContainerSpec, db: AsyncSession) -> TaContainer:
    """Cria volume + container Hermes pra um tenant. Idempotente."""
    cli = docker_client()
    name = container_name(spec.tenant_id)
    vol = volume_name(spec.tenant_id)

    # Volume (mesmo nome = mesmo volume = persistência entre recreates)
    try:
        cli.volumes.get(vol)
        logger.info("volume %s já existe (reuso)", vol)
    except NotFound:
        cli.volumes.create(name=vol, labels={"tier.tenant_id": str(spec.tenant_id)})

    # Container
    try:
        existing = cli.containers.get(name)
        logger.warning("container %s já existe — removendo pra recriar", name)
        existing.remove(force=True)
    except NotFound:
        pass

    port = await acquire_port()

    env = {
        "HERMES_UID": "10000",
        "HERMES_GID": "10000",
        "TIER_LLM_PROVIDER": spec.llm_provider,
        "TIER_LLM_MODEL": spec.llm_model,
        "TIER_LLM_API_KEY": spec.llm_api_key,
        "TIER_FEATURE_FLAGS": json.dumps(spec.feature_flags),
        "TIER_STATEMENT_DESCRIPTOR": spec.statement_descriptor,
        # Provider-specific aliases (entrypoint resolve)
        f"{spec.llm_provider.upper()}_API_KEY": spec.llm_api_key,
    }

    container = cli.containers.run(
        image=settings.hermes_image,
        name=name,
        detach=True,
        restart_policy={"Name": "unless-stopped"},
        volumes={vol: {"bind": "/opt/data", "mode": "rw"}},
        ports={"8000/tcp": port},
        environment=env,
        labels={
            "tier.tenant_id": str(spec.tenant_id),
            "tier.image_version": settings.hermes_image,
            "tier.created_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    # Upsert TaContainer
    existing_row = await db.get(TaContainer, spec.tenant_id)
    if existing_row:
        existing_row.docker_container_id = container.id
        existing_row.status = "starting"
        existing_row.port = port
        existing_row.image_version = settings.hermes_image
        existing_row.restart_count = 0
        record = existing_row
    else:
        record = TaContainer(
            tenant_id=spec.tenant_id,
            docker_container_id=container.id,
            status="starting",
            host="localhost",
            port=port,
            image_version=settings.hermes_image,
        )
        db.add(record)
    await db.commit()
    await db.refresh(record)

    logger.info("container criado tenant=%s container=%s port=%s", spec.tenant_id, container.id[:12], port)
    return record


async def stop_container(tenant_id: int, db: AsyncSession) -> None:
    cli = docker_client()
    try:
        c = cli.containers.get(container_name(tenant_id))
        c.stop(timeout=10)
    except NotFound:
        pass

    record = await db.get(TaContainer, tenant_id)
    if record:
        record.status = "stopped"
        if record.port:
            await release_port(record.port)
            record.port = None
        await db.commit()


async def remove_container(tenant_id: int, db: AsyncSession, drop_volume: bool = False) -> None:
    cli = docker_client()
    try:
        c = cli.containers.get(container_name(tenant_id))
        c.remove(force=True)
    except NotFound:
        pass

    if drop_volume:
        try:
            v = cli.volumes.get(volume_name(tenant_id))
            v.remove()
        except (NotFound, APIError) as e:
            logger.warning("volume drop falhou: %s", e)

    record = await db.get(TaContainer, tenant_id)
    if record:
        if record.port:
            await release_port(record.port)
        await db.delete(record)
        await db.commit()


async def restart_container(tenant_id: int, db: AsyncSession) -> None:
    cli = docker_client()
    try:
        c = cli.containers.get(container_name(tenant_id))
        c.restart(timeout=10)
        record = await db.get(TaContainer, tenant_id)
        if record:
            record.restart_count += 1
            record.status = "starting"
            await db.commit()
    except NotFound as e:
        raise RuntimeError(f"Container tenant {tenant_id} não existe") from e


async def health_check(tenant_id: int, db: AsyncSession) -> bool:
    """Verifica se container está respondendo."""
    import httpx

    record = await db.get(TaContainer, tenant_id)
    if not record or not record.port:
        return False

    url = f"http://{record.host}:{record.port}/v1/health"
    try:
        async with httpx.AsyncClient(timeout=3) as cli:
            r = await cli.get(url)
            ok = r.status_code < 500
    except Exception as e:
        logger.warning("health check tenant=%s falhou: %s", tenant_id, e)
        ok = False

    record.status = "running" if ok else "unhealthy"
    record.last_health_check_at = datetime.now(timezone.utc)
    await db.commit()
    return ok


# ============================================================
# Helpers — resolver LLM config do DB pra spec
# ============================================================
async def build_spec_from_db(tenant_id: int, db: AsyncSession) -> ContainerSpec:
    """Lê config LLM ativa do tenant (ou global fallback) + feature flags."""
    from sqlalchemy import select

    from models import TaFeatureFlag

    # LLM: prefere tenant-specific; senão pega global (tenant_id NULL)
    stmt_llm = (
        select(TaLlmProvider)
        .where(TaLlmProvider.active.is_(True))
        .where((TaLlmProvider.tenant_id == tenant_id) | (TaLlmProvider.tenant_id.is_(None)))
        .order_by(TaLlmProvider.tenant_id.desc().nulls_last())
        .limit(1)
    )
    result = await db.execute(stmt_llm)
    llm = result.scalar_one_or_none()
    if not llm:
        raise RuntimeError(f"Nenhum LLM provider ativo pra tenant {tenant_id}")

    # Feature flags: global + tenant-scoped
    stmt_flags = select(TaFeatureFlag).where(
        TaFeatureFlag.enabled.is_(True),
        (TaFeatureFlag.escopo == "global")
        | ((TaFeatureFlag.escopo == "tenant") & (TaFeatureFlag.escopo_id == tenant_id)),
    )
    flags_result = await db.execute(stmt_flags)
    flags = {f.key: f.value or "true" for f in flags_result.scalars().all()}

    return ContainerSpec(
        tenant_id=tenant_id,
        llm_provider=llm.provider,
        llm_model=llm.default_model,
        llm_api_key=decrypt(llm.api_key_enc),
        feature_flags=flags,
        statement_descriptor=f"TIER-AGENT-{tenant_id}",
    )
