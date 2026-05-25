from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from core.db import db_context

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


@router.get("/health/db")
async def health_db():
    async with db_context() as db:
        result = await db.execute(text("SELECT 1"))
        ok = result.scalar() == 1
    return {"db": "ok" if ok else "fail"}
