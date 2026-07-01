"""Config de EMBEDDING provider (RAG + memória) — espelha routes/llm.py.

O usuário cadastra provider + chave PRÓPRIA (separada da LLM) + modelo + dimensões.
Chave Fernet-encrypted at-rest. O motor (services/embeddings.py) usa o ativo de menor
priority (tenant sobre global). Trocar de provider ⇒ reindexar (POST /reindex-all).
"""

import logging
import time
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import db_context, get_db
from core.encryption import decrypt, encrypt
from models import TaEmbeddingProvider
from services import embeddings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/embedding-providers", tags=["embedding"])


class EmbeddingProviderIn(BaseModel):
    provider: str
    api_key: str  # plaintext na request, encrypted at rest
    default_model: str
    dimensions: int = 768
    base_url: str | None = None
    cost_per_1m: float | None = None
    tenant_id: int | None = None  # NULL = global (só admin)
    active: bool = True
    priority: int = 100


class EmbeddingProviderPatch(BaseModel):
    provider: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    dimensions: int | None = None
    base_url: str | None = None
    cost_per_1m: float | None = None
    active: bool | None = None
    priority: int | None = None


class EmbeddingProviderOut(BaseModel):
    id: int
    provider: str
    default_model: str
    dimensions: int = 768
    base_url: str | None = None
    cost_per_1m: float | None = None
    tenant_id: int | None
    active: bool
    priority: int = 100
    api_key_prefix: str | None = None
    api_key_suffix: str | None = None
    created_at: datetime | None = None
    in_use: bool = False
    reindex: str | None = None  # "started" quando salvar disparou reindex em background

    model_config = {"from_attributes": True}


@router.get("/supported")
async def supported_providers():
    """Provedores de embedding suportados + modelos sugeridos (UI popula o dropdown)."""
    catalog = embeddings.provider_models()
    return {
        "providers": [
            {"key": k, "label": v, "models": catalog.get(k, [])}
            for k, v in embeddings.SUPPORTED_EMBEDDING_PROVIDERS.items()
        ],
        "default_dims": embeddings.DEFAULT_DIMS,
    }


@router.get("", response_model=list[EmbeddingProviderOut])
async def list_providers(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista providers de embedding do tenant + globais (admin). Marca `in_use` no que o
    motor realmente pega (ativo de menor priority; tenant sobre global)."""
    stmt = select(TaEmbeddingProvider)
    if not user.is_admin:
        stmt = stmt.where(TaEmbeddingProvider.tenant_id == user.tenant_id)
    rows = list(
        (
            await db.execute(
                stmt.order_by(TaEmbeddingProvider.priority.asc(), TaEmbeddingProvider.id.desc())
            )
        ).scalars().all()
    )

    in_use_ids: set[int] = set()
    if user.is_admin:
        by_scope: dict[int | None, list[TaEmbeddingProvider]] = {}
        for r in rows:
            by_scope.setdefault(r.tenant_id, []).append(r)
        for scope_rows in by_scope.values():
            winner = next((r for r in scope_rows if r.active), None)
            if winner:
                in_use_ids.add(winner.id)
    else:
        tenant_winner = next((r for r in rows if r.tenant_id == user.tenant_id and r.active), None)
        global_winner = next((r for r in rows if r.tenant_id is None and r.active), None)
        effective = tenant_winner or global_winner
        if effective:
            in_use_ids.add(effective.id)

    items: list[EmbeddingProviderOut] = []
    for row in rows:
        out = EmbeddingProviderOut.model_validate(row)
        out.in_use = row.id in in_use_ids
        out.created_at = row.created_at
        try:
            raw = decrypt(row.api_key_enc) or ""
            out.api_key_suffix = raw[-4:] if len(raw) >= 4 else "••••"
            out.api_key_prefix = raw[:7] if len(raw) >= 16 else None
        except Exception:
            out.api_key_suffix = None
            out.api_key_prefix = None
        items.append(out)
    return items


async def _run_reindex(tenant_id: int | None) -> dict:
    """Re-embeda conhecimento + memória com o provider ATUAL (resolvido por tenant).

    tenant_id = None → todos (config global). Abre sessão PRÓPRIA — seguro em
    BackgroundTasks (a sessão do request já fechou). Reusa o texto salvo (chunk_text/fact)."""
    out = {"knowledge_chunks": 0, "memory_facts": 0, "errors": 0}
    BATCH = 50
    try:
        async with db_context() as db:
            if tenant_id is None:
                crows = (
                    await db.execute(
                        sql_text(
                            "SELECT kc.id, kc.chunk_text, a.tenant_id FROM ta_knowledge_chunk kc "
                            "JOIN ta_agent a ON a.id = kc.agent_id WHERE kc.chunk_text IS NOT NULL"
                        )
                    )
                ).all()
                mrows = (
                    await db.execute(
                        sql_text("SELECT id, fact, tenant_id FROM ta_contact_memory WHERE fact IS NOT NULL")
                    )
                ).all()
            else:
                crows = (
                    await db.execute(
                        sql_text(
                            "SELECT kc.id, kc.chunk_text, a.tenant_id FROM ta_knowledge_chunk kc "
                            "JOIN ta_agent a ON a.id = kc.agent_id "
                            "WHERE a.tenant_id = :t AND kc.chunk_text IS NOT NULL"
                        ),
                        {"t": tenant_id},
                    )
                ).all()
                mrows = (
                    await db.execute(
                        sql_text(
                            "SELECT id, fact, tenant_id FROM ta_contact_memory "
                            "WHERE tenant_id = :t AND fact IS NOT NULL"
                        ),
                        {"t": tenant_id},
                    )
                ).all()

            by_chunk: dict[int | None, list] = defaultdict(list)
            for cid, txt, tid in crows:
                by_chunk[tid].append((cid, txt))
            for tid, rows in by_chunk.items():
                for i in range(0, len(rows), BATCH):
                    b = rows[i : i + BATCH]
                    try:
                        vecs = await embeddings.embed(
                            db, [t for _, t in b], tenant_id=tid, task_type="RETRIEVAL_DOCUMENT"
                        )
                    except Exception:
                        out["errors"] += len(b)
                        continue
                    for (cid, _), vec in zip(b, vecs):
                        if not vec:
                            out["errors"] += 1
                            continue
                        lit = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
                        await db.execute(
                            sql_text("UPDATE ta_knowledge_chunk SET embedding = (:v)::vector WHERE id = :id"),
                            {"v": lit, "id": cid},
                        )
                        out["knowledge_chunks"] += 1
                    await db.commit()

            by_mem: dict[int | None, list] = defaultdict(list)
            for mid, fact, tid in mrows:
                by_mem[tid].append((mid, fact))
            for tid, rows in by_mem.items():
                for i in range(0, len(rows), BATCH):
                    b = rows[i : i + BATCH]
                    try:
                        vecs = await embeddings.embed(
                            db, [f for _, f in b], tenant_id=tid, task_type="RETRIEVAL_DOCUMENT"
                        )
                    except Exception:
                        out["errors"] += len(b)
                        continue
                    for (mid, _), vec in zip(b, vecs):
                        if not vec:
                            out["errors"] += 1
                            continue
                        lit = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
                        await db.execute(
                            sql_text("UPDATE ta_contact_memory SET embedding = (:v)::vector WHERE id = :id"),
                            {"v": lit, "id": mid},
                        )
                        out["memory_facts"] += 1
                    await db.commit()
        logger.info("reindex ok tenant=%s -> %s", tenant_id, out)
    except Exception:
        logger.exception("reindex falhou tenant=%s", tenant_id)
    return out


@router.post("", response_model=EmbeddingProviderOut, status_code=201)
async def create_provider(
    payload: EmbeddingProviderIn,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.provider not in embeddings.SUPPORTED_EMBEDDING_PROVIDERS:
        raise HTTPException(
            400, f"Provider não suportado. Use um de: {list(embeddings.SUPPORTED_EMBEDDING_PROVIDERS)}"
        )
    if user.is_admin:
        tenant_id = payload.tenant_id
    else:
        tenant_id = user.tenant_id
        if not tenant_id:
            raise HTTPException(403, "Sua conta não tem tenant pra associar o provider")

    item = TaEmbeddingProvider(
        tenant_id=tenant_id,
        provider=payload.provider,
        api_key_enc=encrypt(payload.api_key),
        default_model=payload.default_model,
        dimensions=payload.dimensions or embeddings.DEFAULT_DIMS,
        base_url=payload.base_url,
        cost_per_1m=payload.cost_per_1m,
        active=payload.active,
        priority=payload.priority,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    # Novo provider → re-embeda a base com ele em background (sem o usuário apertar botão)
    background_tasks.add_task(_run_reindex, item.tenant_id)
    out = EmbeddingProviderOut.model_validate(item)
    out.reindex = "started"
    return out


@router.patch("/{provider_id}", response_model=EmbeddingProviderOut)
async def update_provider(
    provider_id: int,
    payload: EmbeddingProviderPatch,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaEmbeddingProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")
    if item.tenant_id is None and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode editar config global")
    if item.tenant_id is not None and item.tenant_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, "Provider de outro tenant")

    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data:
        item.api_key_enc = encrypt(data.pop("api_key"))
    for k, v in data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    # Mudou algo que altera o embedding gerado / o provider ativo → re-embeda em background.
    reindex = None
    if any(k in data for k in ("provider", "default_model", "dimensions", "active", "priority")):
        background_tasks.add_task(_run_reindex, item.tenant_id)
        reindex = "started"
    out = EmbeddingProviderOut.model_validate(item)
    out.reindex = reindex
    return out


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(TaEmbeddingProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")
    if item.tenant_id is None and not user.is_admin:
        raise HTTPException(403, "Apenas admin Tier pode deletar config global")
    if item.tenant_id is not None and item.tenant_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, "Provider de outro tenant")
    await db.delete(item)
    await db.commit()


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ping real: embeda um texto e confere se a dimensão bate com a base (pgvector)."""
    item = await db.get(TaEmbeddingProvider, provider_id)
    if not item:
        raise HTTPException(404, "Provider não encontrado")
    if item.tenant_id is not None and item.tenant_id != user.tenant_id and not user.is_admin:
        raise HTTPException(403, "Provider de outro tenant")

    started = time.perf_counter()
    try:
        vecs = await embeddings.embed_with_provider(
            item, ["ping de teste do Tier Agent"], task_type="RETRIEVAL_QUERY"
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        dim = len(vecs[0]) if vecs and vecs[0] else 0
        dim_ok = dim == item.dimensions
        return {
            "ok": True,
            "provider": item.provider,
            "model": item.default_model,
            "latency_ms": latency_ms,
            "dimensions": dim,
            "dim_ok": dim_ok,
            "warn": None
            if dim_ok
            else f"Modelo retornou {dim} dims, mas a base espera {item.dimensions}. "
            f"Ajuste as dimensões/modelo (a busca só funciona com {item.dimensions}).",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "provider": item.provider,
            "model": item.default_model,
            "detail": str(e)[:300],
        }


class ReindexOut(BaseModel):
    knowledge_chunks: int = 0
    memory_facts: int = 0
    errors: int = 0


@router.post("/reindex-all", response_model=ReindexOut)
async def reindex_all(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-embeda TODO o conhecimento + memória do tenant com o provider atual.

    Necessário ao TROCAR de provider (embeddings de providers diferentes não são
    intercambiáveis). Reusa o texto já salvo nos chunks (não re-baixa do R2)."""
    if not user.tenant_id:
        raise HTTPException(403, "Sem tenant")
    tenant_id = user.tenant_id

    agent_ids = [
        r[0]
        for r in (
            await db.execute(sql_text("SELECT id FROM ta_agent WHERE tenant_id = :t"), {"t": tenant_id})
        ).all()
    ]
    if not agent_ids:
        return ReindexOut()

    out = ReindexOut()
    BATCH = 50

    # 1) Knowledge chunks (reusa chunk_text já indexado)
    chunk_rows = (
        await db.execute(
            sql_text(
                "SELECT id, chunk_text FROM ta_knowledge_chunk "
                "WHERE agent_id = ANY(:aids) AND chunk_text IS NOT NULL ORDER BY id"
            ),
            {"aids": agent_ids},
        )
    ).all()
    for i in range(0, len(chunk_rows), BATCH):
        batch = chunk_rows[i : i + BATCH]
        try:
            vecs = await embeddings.embed(
                db, [r[1] for r in batch], tenant_id=tenant_id, task_type="RETRIEVAL_DOCUMENT"
            )
        except Exception:
            out.errors += len(batch)
            continue
        for (cid, _txt), vec in zip(batch, vecs):
            if not vec:
                out.errors += 1
                continue
            lit = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
            await db.execute(
                sql_text("UPDATE ta_knowledge_chunk SET embedding = (:v)::vector WHERE id = :id"),
                {"v": lit, "id": cid},
            )
            out.knowledge_chunks += 1
        await db.commit()

    # 2) Memória de contato (reusa o fato já salvo)
    mem_rows = (
        await db.execute(
            sql_text(
                "SELECT id, fact FROM ta_contact_memory "
                "WHERE tenant_id = :t AND fact IS NOT NULL ORDER BY id"
            ),
            {"t": tenant_id},
        )
    ).all()
    for i in range(0, len(mem_rows), BATCH):
        batch = mem_rows[i : i + BATCH]
        try:
            vecs = await embeddings.embed(
                db, [r[1] for r in batch], tenant_id=tenant_id, task_type="RETRIEVAL_DOCUMENT"
            )
        except Exception:
            out.errors += len(batch)
            continue
        for (mid, _fact), vec in zip(batch, vecs):
            if not vec:
                out.errors += 1
                continue
            lit = "[" + ",".join(str(round(v, 6)) for v in vec) + "]"
            await db.execute(
                sql_text("UPDATE ta_contact_memory SET embedding = (:v)::vector WHERE id = :id"),
                {"v": lit, "id": mid},
            )
            out.memory_facts += 1
        await db.commit()

    return out
