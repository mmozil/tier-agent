"""Tier Agent — control plane FastAPI."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routes import agents, auth, billing, canned_responses, connectors, containers, conversations, features, health, knowledge, llm, mcp_server, metrics, notifications, playbooks, reports, skills, team, templates, tenants, tier_pay, webhooks

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("tier-agent")

app = FastAPI(
    title="Tier Agent — Control Plane",
    description="SaaS de agentes IA configuráveis. Multi-tenant via 1 container Hermes por cliente.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://agent.tier.finance",
        "https://app.tier.finance",
        "https://erp.tier.finance",
        "http://localhost:5174",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "tier-agent",
        "version": "0.1.0",
        "environment": settings.environment,
        "docs": "/docs",
    }


# Routers
app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(tenants.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(features.router, prefix="/api/v1")
app.include_router(containers.router, prefix="/api/v1")
app.include_router(connectors.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")
app.include_router(templates.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")
app.include_router(playbooks.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(conversations.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(tier_pay.router, prefix="/api/v1")
app.include_router(mcp_server.router, prefix="/api/v1")
app.include_router(canned_responses.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(team.router, prefix="/api/v1")


async def _ensure_message_content_column():
    """Runtime DDL idempotente — adiciona ta_message_log.content (texto da msg,
    pra inbox/histórico). Coluna nullable, tabela pequena → ALTER rápido e seguro.
    Não usa Alembic porque o deploy não roda migrations."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(_sql_text("ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS content TEXT"))
            await db.execute(
                _sql_text("ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb")
            )
            for ddl in (
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(120)",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_state VARCHAR(16) DEFAULT 'none'",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_score INTEGER",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_at TIMESTAMP",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS sla_alerted_at TIMESTAMP",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_message_content_column ok")
    except Exception:
        logger.exception("ensure_message_content_column falhou (segue mesmo assim)")


async def _ensure_canned_response_table():
    """Runtime DDL idempotente — cria ta_canned_response (respostas prontas)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_canned_response (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER NOT NULL REFERENCES ta_tenant(id) ON DELETE CASCADE,
                        shortcut VARCHAR(64) NOT NULL,
                        content TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT now(),
                        updated_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text(
                    "CREATE INDEX IF NOT EXISTS ix_ta_canned_response_tenant_id "
                    "ON ta_canned_response (tenant_id)"
                )
            )
            await db.commit()
        logger.info("ensure_canned_response_table ok")
    except Exception:
        logger.exception("ensure_canned_response_table falhou (segue mesmo assim)")


async def _ensure_member_table():
    """Runtime DDL idempotente — cria ta_member (atendentes do tenant)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_member (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER NOT NULL REFERENCES ta_tenant(id) ON DELETE CASCADE,
                        nome VARCHAR(120) NOT NULL,
                        email VARCHAR(255) NOT NULL,
                        password_hash VARCHAR(255),
                        role VARCHAR(16) NOT NULL DEFAULT 'atendente',
                        status VARCHAR(16) NOT NULL DEFAULT 'active',
                        online BOOLEAN NOT NULL DEFAULT false,
                        max_conversas INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT now(),
                        updated_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text("CREATE UNIQUE INDEX IF NOT EXISTS uq_member_email ON ta_member (email)")
            )
            await db.execute(
                _sql_text("CREATE INDEX IF NOT EXISTS ix_ta_member_tenant_id ON ta_member (tenant_id)")
            )
            await db.commit()
        logger.info("ensure_member_table ok")
    except Exception:
        logger.exception("ensure_member_table falhou (segue mesmo assim)")


@app.on_event("startup")
async def startup():
    logger.info("Tier Agent starting — env=%s port=%s", settings.environment, settings.app_port)
    await _ensure_message_content_column()
    await _ensure_canned_response_table()
    await _ensure_member_table()
    from scheduler import init_scheduler
    init_scheduler()


@app.on_event("shutdown")
async def shutdown():
    logger.info("Tier Agent shutting down")
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
