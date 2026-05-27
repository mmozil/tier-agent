"""Knowledge upload — PDF/Sheets/Texto → skill markdown no container Hermes do tenant."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent, TaKnowledge
from services import skill_builder
from services.storage_service import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


async def _ensure_agent_owned(db: AsyncSession, agent_id: int, user: CurrentUser) -> TaAgent:
    agent = await db.get(TaAgent, agent_id)
    if not agent:
        raise HTTPException(404, "Agente não encontrado")
    if not user.is_admin and agent.tenant_id != user.tenant_id:
        raise HTTPException(403, "Agente de outro tenant")
    return agent


def _detect_kind(filename: str) -> str:
    f = (filename or "").lower()
    if f.endswith(".pdf"):
        return "pdf"
    if f.endswith((".xlsx", ".xls")):
        return "sheet"
    if f.endswith(".txt") or f.endswith(".md"):
        return "text"
    return "unknown"


@router.get("")
async def list_knowledge(
    agent_id: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if agent_id:
        await _ensure_agent_owned(db, agent_id, user)
        stmt = select(TaKnowledge).where(TaKnowledge.agent_id == agent_id)
    else:
        if not user.tenant_id:
            return []
        stmt = (
            select(TaKnowledge)
            .join(TaAgent, TaAgent.id == TaKnowledge.agent_id)
            .where(TaAgent.tenant_id == user.tenant_id)
        )
    result = await db.execute(stmt.order_by(TaKnowledge.id.desc()))
    return [
        {
            "id": k.id,
            "agent_id": k.agent_id,
            "kind": k.kind,
            "title": k.title,
            "status": k.status,
            "chunks_count": k.chunks_count,
            "indexed_at": k.indexed_at.isoformat() if k.indexed_at else None,
            "skill_md_path": k.skill_md_path,
            "source_url": k.source_url,
        }
        for k in result.scalars().all()
    ]


@router.post("/upload")
async def upload(
    agent_id: int = Form(...),
    title: str | None = Form(None),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload de PDF/Sheet → extrai texto → gera skill → instala no Hermes do tenant."""
    agent = await _ensure_agent_owned(db, agent_id, user)
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "Arquivo > 20MB")

    kind = _detect_kind(file.filename or "")
    if kind == "unknown":
        raise HTTPException(400, f"Tipo não suportado. Use PDF, XLSX ou TXT/MD.")

    final_title = title or (file.filename or "documento").rsplit(".", 1)[0]

    # Cria registro pending
    record = TaKnowledge(
        agent_id=agent.id,
        kind=kind,
        title=final_title,
        status="indexing",
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    # Upload binário pro R2
    try:
        up = storage.upload(content, folder=f"knowledge/agent-{agent.id}", filename=file.filename, content_type=file.content_type or "application/octet-stream")
        record.r2_key = up["key"]
        record.source_url = up["url"]
    except Exception as e:
        logger.warning("storage upload falhou: %s", e)

    # Extrai texto + gera skill
    try:
        if kind == "pdf":
            body = skill_builder.extract_pdf_text(content)
        elif kind == "sheet":
            body = skill_builder.extract_xlsx_text(content)
        else:
            body = content.decode("utf-8", errors="replace")

        if not body.strip():
            raise RuntimeError("Não foi possível extrair texto do arquivo")

        skill_md = skill_builder.build_skill_md(title=final_title, body=body)
        filename = f"{skill_builder._slug(final_title)}-{record.id}.md"
        skill_path = skill_builder.install_skill_in_container(agent.tenant_id, filename, skill_md)

        record.skill_md_path = skill_path
        record.status = "ready"
        record.indexed_at = datetime.utcnow()
        await db.commit()

        # Indexa no pgvector pra RAG real (em paralelo ao skill no container Hermes)
        try:
            from services import rag_engine

            stats = await rag_engine.index_knowledge(db, record.id, full_text=body)
            record.chunks_count = int(stats.get("chunks_count", 0))
            if stats.get("error"):
                logger.warning("rag_engine.index falhou knowledge=%s: %s", record.id, stats["error"])
        except Exception:
            logger.exception("rag_engine.index_knowledge falhou knowledge=%s", record.id)
            record.chunks_count = len([p for p in body.split("\n\n") if p.strip()])
    except RuntimeError as e:
        record.status = "failed"
        logger.exception("skill build falhou")
        await db.commit()
        raise HTTPException(500, f"Falha processando arquivo: {e}")
    except Exception:
        record.status = "failed"
        await db.commit()
        raise

    await db.commit()
    await db.refresh(record)

    return {
        "id": record.id,
        "title": record.title,
        "kind": record.kind,
        "status": record.status,
        "chunks_count": record.chunks_count,
        "skill_md_path": record.skill_md_path,
    }


@router.post("/{knowledge_id}/reindex")
async def reindex_knowledge(
    knowledge_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-extrai texto do R2 (ou skill no container) + re-indexa em pgvector."""
    k = await db.get(TaKnowledge, knowledge_id)
    if not k:
        raise HTTPException(404, "Knowledge não encontrado")
    agent = await _ensure_agent_owned(db, k.agent_id, user)

    # Pega texto do R2 (se temos r2_key) ou re-baixa do source_url
    full_text = ""
    try:
        if k.r2_key:
            data = storage.download(k.r2_key)
            if k.kind == "pdf":
                full_text = skill_builder.extract_pdf_text(data)
            elif k.kind == "sheet":
                full_text = skill_builder.extract_xlsx_text(data)
            else:
                full_text = data.decode("utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(500, f"Falha re-extraindo texto: {e}")

    if not full_text.strip():
        raise HTTPException(400, "Não foi possível extrair texto pra re-indexar")

    from services import rag_engine

    stats = await rag_engine.index_knowledge(db, k.id, full_text=full_text)
    if stats.get("error"):
        raise HTTPException(500, f"reindex falhou: {stats['error']}")

    k.chunks_count = int(stats.get("chunks_count", 0))
    k.status = "ready"
    k.indexed_at = datetime.utcnow()
    await db.commit()
    return {"reindexed": True, "knowledge_id": k.id, "chunks_count": k.chunks_count}


@router.delete("/{knowledge_id}", status_code=204)
async def delete_knowledge(
    knowledge_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    k = await db.get(TaKnowledge, knowledge_id)
    if not k:
        raise HTTPException(404, "Knowledge não encontrado")
    agent = await _ensure_agent_owned(db, k.agent_id, user)

    # Remove skill do container (best-effort)
    if k.skill_md_path:
        try:
            from services.container_orchestrator import _ssh_run, container_name
            import shlex

            cname = container_name(agent.tenant_id)
            _ssh_run(
                f"docker exec {shlex.quote(cname)} rm -f {shlex.quote(k.skill_md_path)} 2>&1 || true"
            )
        except Exception as e:
            logger.warning("remove skill falhou: %s", e)

    tenant_id_inv = agent.tenant_id if agent else None
    agent_id_inv = agent.id if agent else None
    await db.delete(k)
    await db.commit()
    if tenant_id_inv:
        try:
            from services import llm_cache

            await llm_cache.invalidate(tenant_id_inv, agent_id_inv)
        except Exception:
            pass
