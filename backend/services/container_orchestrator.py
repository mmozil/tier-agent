"""Orquestra containers Hermes — 1 por tenant — via SSH no host Docker daemon.

Por que SSH e não Docker SDK direto:
- Coolify não mounta /var/run/docker.sock no container backend
- SSH é portável (funciona em qualquer host Docker)
- Backend tem chave SSH com authorized_keys no host

Isolamento total via Docker volume + HERMES_HOME por tenant. Cada container
expõe REST API OpenAI-compatible (porta 8642 interna) numa porta dinâmica.
"""

import base64
import io
import json
import logging
import secrets
import shlex
from dataclasses import dataclass
from datetime import datetime

import paramiko
import redis.asyncio as redis_async
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt, encrypt
from models import TaContainer, TaFeatureFlag, TaLlmProvider

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ContainerSpec:
    tenant_id: int
    llm_provider: str
    llm_model: str
    llm_api_key: str
    feature_flags: dict
    statement_descriptor: str = ""


# ============================================================
# SSH client (cacheado)
# ============================================================
_ssh_client: paramiko.SSHClient | None = None


def _get_ssh() -> paramiko.SSHClient:
    global _ssh_client
    if _ssh_client is not None:
        try:
            _ssh_client.exec_command("true", timeout=3)
            return _ssh_client
        except Exception:
            _ssh_client = None

    if not settings.tier_agent_ssh_privkey_b64:
        raise RuntimeError("TIER_AGENT_SSH_PRIVKEY_B64 não configurada")

    privkey_pem = base64.b64decode(settings.tier_agent_ssh_privkey_b64).decode()
    pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(privkey_pem))

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=settings.tier_agent_ssh_host,
        port=settings.tier_agent_ssh_port,
        username=settings.tier_agent_ssh_user,
        pkey=pkey,
        timeout=10,
        banner_timeout=10,
    )
    _ssh_client = client
    return client


def _ssh_run(cmd: str, *, timeout: int = 30) -> tuple[int, str, str]:
    """Executa comando no host via SSH. Retorna (exit_code, stdout, stderr)."""
    client = _get_ssh()
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        logger.warning("ssh_run rc=%s cmd=%s err=%s", rc, cmd[:120], err[:300])
    return rc, out, err


# ============================================================
# Port pool — Redis SETNX
# ============================================================
_PORT_POOL_KEY = "tier_agent:port_pool"


async def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.redis_url, decode_responses=True)


async def acquire_port() -> int:
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
# Naming helpers
# ============================================================
def container_name(tenant_id: int) -> str:
    return f"tier-hermes-tenant-{tenant_id}"


def volume_name(tenant_id: int) -> str:
    return f"tier-hermes-vol-{tenant_id}"


# ============================================================
# Container lifecycle (via SSH)
# ============================================================
async def create_container(spec: ContainerSpec, db: AsyncSession) -> TaContainer:
    """Cria volume + container Hermes pra um tenant. Idempotente."""
    name = container_name(spec.tenant_id)
    vol = volume_name(spec.tenant_id)

    # Volume
    _ssh_run(f"docker volume create {shlex.quote(vol)} --label tier.tenant_id={spec.tenant_id} >/dev/null")

    # Remove container antigo se existir
    _ssh_run(f"docker rm -f {shlex.quote(name)} >/dev/null 2>&1 || true")

    port = await acquire_port()
    api_server_key = secrets.token_hex(32)

    env_pairs = {
        "HERMES_UID": "10000",
        "HERMES_GID": "10000",
        "TIER_LLM_PROVIDER": spec.llm_provider,
        "TIER_LLM_MODEL": spec.llm_model,
        "TIER_LLM_API_KEY": spec.llm_api_key,
        "TIER_FEATURE_FLAGS": json.dumps(spec.feature_flags),
        "TIER_STATEMENT_DESCRIPTOR": spec.statement_descriptor,
        "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_PORT": "8642",
        "API_SERVER_KEY": api_server_key,
        "GATEWAY_ALLOW_ALL_USERS": "true",
        f"{spec.llm_provider.upper()}_API_KEY": spec.llm_api_key,
    }
    env_args = " ".join(f"-e {shlex.quote(f'{k}={v}')}" for k, v in env_pairs.items())

    cmd = (
        f"docker run -d --name {shlex.quote(name)} "
        f"--restart unless-stopped "
        f"-v {shlex.quote(vol)}:/opt/data "
        f"-p {port}:8642 "
        f"--label tier.tenant_id={spec.tenant_id} "
        f"--label tier.image_version={shlex.quote(settings.hermes_image)} "
        f"{env_args} "
        f"{shlex.quote(settings.hermes_image)}"
    )
    rc, out, err = _ssh_run(cmd, timeout=60)
    if rc != 0:
        await release_port(port)
        raise RuntimeError(f"docker run falhou: {err.strip()[:400]}")
    container_id = out.strip()

    # Persiste API key no Redis pra hermes_proxy ler
    r = await _redis()
    await r.set(
        f"tier_agent:hermes_key:{spec.tenant_id}", encrypt(api_server_key), ex=86400 * 90
    )

    # Upsert TaContainer
    existing = await db.get(TaContainer, spec.tenant_id)
    if existing:
        existing.docker_container_id = container_id
        existing.status = "starting"
        existing.port = port
        existing.image_version = settings.hermes_image
        existing.restart_count = 0
        record = existing
    else:
        record = TaContainer(
            tenant_id=spec.tenant_id,
            docker_container_id=container_id,
            status="starting",
            host=settings.tier_agent_ssh_host,
            port=port,
            image_version=settings.hermes_image,
        )
        db.add(record)
    await db.commit()
    await db.refresh(record)

    logger.info(
        "container criado tenant=%s id=%s port=%s", spec.tenant_id, container_id[:12], port
    )
    return record


async def stop_container(tenant_id: int, db: AsyncSession) -> None:
    name = container_name(tenant_id)
    _ssh_run(f"docker stop {shlex.quote(name)} >/dev/null 2>&1 || true", timeout=30)

    record = await db.get(TaContainer, tenant_id)
    if record:
        record.status = "stopped"
        if record.port:
            await release_port(record.port)
            record.port = None
        await db.commit()


async def remove_container(
    tenant_id: int, db: AsyncSession, drop_volume: bool = False
) -> None:
    name = container_name(tenant_id)
    _ssh_run(f"docker rm -f {shlex.quote(name)} >/dev/null 2>&1 || true")

    if drop_volume:
        _ssh_run(f"docker volume rm {shlex.quote(volume_name(tenant_id))} >/dev/null 2>&1 || true")

    record = await db.get(TaContainer, tenant_id)
    if record:
        if record.port:
            await release_port(record.port)
        await db.delete(record)
        await db.commit()


async def restart_container(tenant_id: int, db: AsyncSession) -> None:
    name = container_name(tenant_id)
    rc, _, err = _ssh_run(f"docker restart {shlex.quote(name)}", timeout=30)
    if rc != 0:
        raise RuntimeError(f"restart falhou: {err[:200]}")
    record = await db.get(TaContainer, tenant_id)
    if record:
        record.restart_count += 1
        record.status = "starting"
        await db.commit()


async def health_check(tenant_id: int, db: AsyncSession) -> bool:
    """Health via REST do container Hermes."""
    import httpx

    record = await db.get(TaContainer, tenant_id)
    if not record or not record.port:
        return False

    url = f"http://{record.host}:{record.port}/health"
    try:
        async with httpx.AsyncClient(timeout=5) as cli:
            r = await cli.get(url)
            ok = r.status_code == 200
    except Exception as e:
        logger.warning("health tenant=%s falhou: %s", tenant_id, e)
        ok = False

    record.status = "running" if ok else "unhealthy"
    record.last_health_check_at = datetime.utcnow()  # coluna é tz-naive
    await db.commit()
    return ok


# ============================================================
# Build spec from DB (LLM config + feature flags)
# ============================================================
async def build_spec_from_db(tenant_id: int, db: AsyncSession) -> ContainerSpec:
    from sqlalchemy import select

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
