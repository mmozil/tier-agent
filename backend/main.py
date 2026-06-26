"""Tier Agent — control plane FastAPI."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routes import agents, attention, auth, billing, canned_responses, connectors, containers, conversations, features, health, integrations_pet, integrations_tier, knowledge, llm, macros, mcp_server, metrics, notifications, playbooks, reports, secops, skills, team, templates, tenants, tier_pay, tool_providers, webhooks

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("tier-agent")

app = FastAPI(
    title="Tier Agent — Control Plane",
    description="SaaS de agentes IA configuráveis. Multi-tenant via 1 container Engine por cliente.",
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
app.include_router(integrations_pet.router, prefix="/api/v1")
app.include_router(integrations_tier.router, prefix="/api/v1")
app.include_router(attention.router, prefix="/api/v1")
app.include_router(macros.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(tier_pay.router, prefix="/api/v1")
app.include_router(tool_providers.router, prefix="/api/v1")
app.include_router(tool_providers.oauth_router, prefix="/api/v1")
app.include_router(mcp_server.router, prefix="/api/v1")
app.include_router(canned_responses.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(team.router, prefix="/api/v1")
app.include_router(secops.router, prefix="/api/v1")


async def _ensure_message_content_column():
    """Runtime DDL idempotente — adiciona ta_message_log.content (texto da msg,
    pra inbox/histórico). Coluna nullable, tabela pequena → ALTER rápido e seguro.
    Não usa Alembic porque o deploy não roda migrations."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(_sql_text("ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS content TEXT"))
            # Observabilidade/eval: ferramentas chamadas + freios disparados por turno (nullable).
            await db.execute(_sql_text("ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS tool_calls_json JSONB"))
            await db.execute(_sql_text("ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS brakes_fired JSONB"))
            await db.execute(
                _sql_text("ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb")
            )
            for ddl in (
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(120)",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_state VARCHAR(16) DEFAULT 'none'",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_score INTEGER",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS csat_at TIMESTAMP",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS sla_alerted_at TIMESTAMP",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS assigned_member_id INTEGER",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS priority VARCHAR(16) DEFAULT 'none'",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS team_id INTEGER",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS attachments_json JSONB",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS system_prompt_sent TEXT",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS memory_block TEXT",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS rag_block TEXT",
                "ALTER TABLE ta_notification ADD COLUMN IF NOT EXISTS target_member_id INTEGER",
                "ALTER TABLE ta_llm_provider ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100",
                "ALTER TABLE ta_agent ADD COLUMN IF NOT EXISTS avatar_url TEXT",
            ):
                await db.execute(_sql_text(ddl))
            # Macros (paridade Chatwoot) — tabela criada em runtime (sem Alembic)
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_macro (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER NOT NULL REFERENCES ta_tenant(id) ON DELETE CASCADE,
                        name VARCHAR(120) NOT NULL,
                        actions JSONB NOT NULL DEFAULT '[]'::jsonb,
                        created_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text("CREATE INDEX IF NOT EXISTS ix_ta_macro_tenant ON ta_macro (tenant_id)")
            )
            # Times (paridade Chatwoot) — grupos pra organizar/atribuir conversas
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_team (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER NOT NULL REFERENCES ta_tenant(id) ON DELETE CASCADE,
                        name VARCHAR(120) NOT NULL,
                        created_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text("CREATE INDEX IF NOT EXISTS ix_ta_team_tenant ON ta_team (tenant_id)")
            )
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
            await db.execute(
                _sql_text("ALTER TABLE ta_member ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64)")
            )
            await db.commit()
        logger.info("ensure_member_table ok")
    except Exception:
        logger.exception("ensure_member_table falhou (segue mesmo assim)")


async def _ensure_tool_provider_table():
    """Runtime DDL idempotente — cria ta_tool_provider (federação MCP).

    Servidores MCP externos plugados por agente (ERP Tier Empresas, Hovio Pet, etc).
    Sem Alembic porque o deploy não roda migrations (mesmo padrão de ta_member/ta_macro)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_tool_provider (
                        id SERIAL PRIMARY KEY,
                        agent_id INTEGER NOT NULL REFERENCES ta_agent(id) ON DELETE CASCADE,
                        tenant_id INTEGER NOT NULL,
                        nome VARCHAR(120) NOT NULL,
                        mcp_server_url TEXT NOT NULL,
                        bearer_enc TEXT,
                        enabled BOOLEAN NOT NULL DEFAULT true,
                        priority INTEGER NOT NULL DEFAULT 100,
                        last_test_at TIMESTAMP,
                        last_test_ok BOOLEAN,
                        last_tools_count INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT now(),
                        updated_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text(
                    "CREATE INDEX IF NOT EXISTS ix_ta_tool_provider_agent_enabled "
                    "ON ta_tool_provider (agent_id, enabled, priority)"
                )
            )
            # Conexão OAuth (Conectar→Autorizar): refresh automático de tokens
            for ddl in (
                "ALTER TABLE ta_tool_provider ADD COLUMN IF NOT EXISTS refresh_enc TEXT",
                "ALTER TABLE ta_tool_provider ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP",
                "ALTER TABLE ta_tool_provider ADD COLUMN IF NOT EXISTS token_url TEXT",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_tool_provider_table ok")
    except Exception:
        logger.exception("ensure_tool_provider_table falhou (segue mesmo assim)")


async def _ensure_incident_table():
    """Runtime DDL idempotente — cria ta_incident (alertas SecOps/infra do servidor).

    Alimentada pelo webhook /secops/alert (guards scan-guard/C&C-guard/ingress-guard) e lida
    pelo comando `incidentes` do agente DevOps. tenant_id NULL = infra-global. fingerprint
    pra idempotência (mesmo alerta repetido não duplica)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_incident (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER,
                        source VARCHAR(40) NOT NULL DEFAULT 'manual',
                        severity VARCHAR(16) NOT NULL DEFAULT 'warning',
                        kind VARCHAR(80),
                        title VARCHAR(240) NOT NULL,
                        detail TEXT,
                        raw_json JSONB,
                        fingerprint VARCHAR(120),
                        status VARCHAR(16) NOT NULL DEFAULT 'open',
                        created_at TIMESTAMP DEFAULT now(),
                        updated_at TIMESTAMP DEFAULT now(),
                        resolved_at TIMESTAMP
                    )
                    """
                )
            )
            await db.execute(
                _sql_text("CREATE INDEX IF NOT EXISTS ix_ta_incident_status ON ta_incident (status, created_at DESC)")
            )
            # Idempotência: um mesmo alerta (fingerprint) aberto não duplica.
            await db.execute(
                _sql_text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_incident_open_fp "
                    "ON ta_incident (fingerprint) WHERE status IN ('open','ack') AND fingerprint IS NOT NULL"
                )
            )
            await db.commit()
        logger.info("ensure_incident_table ok")
    except Exception:
        logger.exception("ensure_incident_table falhou (segue mesmo assim)")


@app.on_event("startup")
async def startup():
    logger.info("Tier Agent starting — env=%s port=%s", settings.environment, settings.app_port)
    await _ensure_message_content_column()
    await _ensure_canned_response_table()
    await _ensure_member_table()
    await _ensure_tool_provider_table()
    await _ensure_incident_table()
    from scheduler import init_scheduler
    init_scheduler()


@app.on_event("shutdown")
async def shutdown():
    logger.info("Tier Agent shutting down")
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
