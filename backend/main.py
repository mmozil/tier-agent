"""Tier Agent — control plane FastAPI."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routes import acessos, agents, atividades, attention, auth, billing, canned_responses, connectors, containers, conversations, embedding_providers, features, health, integrations_pet, integrations_tier, internal, knowledge, llm, macros, mcp_server, metrics, notifications, playbooks, public_chat, reports, secops, skills, team, templates, tenants, tier_pay, tool_providers, webhooks, whatsapp_oficial

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("tier-agent")
# 🚨 O httpx loga a URL inteira em INFO — com query string. A troca do code da Meta manda o
# client_secret na query, e ele ia parar no log do contêiner a cada cadastro (11/11/2026).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

app = FastAPI(
    title="Tier Agent — Control Plane",
    description="SaaS de agentes IA configuráveis. Multi-tenant via 1 container Engine por cliente.",
    version="0.1.0",
)

class _NuncaGuardarRespostaDaApi:
    """Toda resposta da API sai com `Cache-Control: private, no-store` (31/10/2026).

    Lição do Steam (Natal de 2015): uma regra de cache numa CDN serviu a página de um usuário
    logado a 34 mil outros. Hoje a Cloudflare não guarda nada da API (medido: DYNAMIC), mas por
    padrão dela, não por regra nossa — se alguém criar uma regra de cache, esta linha segura.
    Quem já define o próprio Cache-Control (arquivo público de voz, por exemplo) fica como está.
    ASGI puro, sem BaseHTTPMiddleware: não mexe em resposta em fluxo.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)

        async def _send(msg):
            if msg.get("type") == "http.response.start":
                headers = list(msg.get("headers") or [])
                if not any(k.lower() == b"cache-control" for k, _ in headers):
                    headers.append((b"cache-control", b"private, no-store"))
                    msg = {**msg, "headers": headers}
            await send(msg)

        await self.app(scope, receive, _send)


# Registro de atividades (11/11/2026): quem fez o quê, quando e de onde — toda ação de
# todo usuário. É o mais interno dos três, para ver a resposta da rota como ela saiu.
from services.registro_atividade import RegistroDeAtividade  # noqa: E402

app.add_middleware(RegistroDeAtividade)
app.add_middleware(_NuncaGuardarRespostaDaApi)

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
app.include_router(embedding_providers.router, prefix="/api/v1")
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
app.include_router(internal.router, prefix="/api/v1")
app.include_router(attention.router, prefix="/api/v1")
app.include_router(macros.router, prefix="/api/v1")
from routes import etiquetas  # noqa: E402

app.include_router(etiquetas.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(tier_pay.router, prefix="/api/v1")
app.include_router(tool_providers.router, prefix="/api/v1")
app.include_router(tool_providers.oauth_router, prefix="/api/v1")
app.include_router(mcp_server.router, prefix="/api/v1")
app.include_router(canned_responses.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(team.router, prefix="/api/v1")
app.include_router(acessos.router, prefix="/api/v1")
app.include_router(atividades.router, prefix="/api/v1")
app.include_router(whatsapp_oficial.router, prefix="/api/v1")
app.include_router(secops.router, prefix="/api/v1")
app.include_router(public_chat.router, prefix="/api/v1")

# Disparo em lote pelo WhatsApp oficial, pela tela do Agent (11/11/2026).
from routes import disparos_oficiais  # noqa: E402

app.include_router(disparos_oficiais.router, prefix="/api/v1")


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
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS crm_opportunity_id INTEGER",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS followup_step INTEGER DEFAULT 0",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS attachments_json JSONB",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS system_prompt_sent TEXT",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS memory_block TEXT",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS rag_block TEXT",
                # 21/10/2026: reação com emoji — a chave da mensagem no WhatsApp + as reações
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(128)",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS wa_remote_jid VARCHAR(128)",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS wa_from_me BOOLEAN",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS reacoes_json JSONB",
                "CREATE INDEX IF NOT EXISTS ix_ta_message_log_wa_message_id ON ta_message_log (wa_message_id)",
                # 21/10/2026: edição de mensagem — quando foi editada e as versões anteriores
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS editada_em TIMESTAMP",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS edicoes_json JSONB",
                "ALTER TABLE ta_notification ADD COLUMN IF NOT EXISTS target_member_id INTEGER",
                "ALTER TABLE ta_llm_provider ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100",
                "ALTER TABLE ta_agent ADD COLUMN IF NOT EXISTS avatar_url TEXT",
                # Etapa 1 do caminho A (09/09/2026): número em modo registro + de qual número veio a conversa
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS modo VARCHAR(16) NOT NULL DEFAULT 'agente'",
                "ALTER TABLE ta_conversation ADD COLUMN IF NOT EXISTS connector_id INTEGER",
                "CREATE INDEX IF NOT EXISTS ix_ta_conversation_connector_id ON ta_conversation (connector_id)",
                # Etapa 3: membro vindo do ERP (pessoa federada) — chave = owner_id do ERP
                "ALTER TABLE ta_member ADD COLUMN IF NOT EXISTS erp_owner_id VARCHAR(64)",
                # 14/10/2026: cargo do ERP e se o cargo atribui conversas
                "ALTER TABLE ta_member ADD COLUMN IF NOT EXISTS cargo VARCHAR(80)",
                "ALTER TABLE ta_member ADD COLUMN IF NOT EXISTS pode_atribuir BOOLEAN",
                "CREATE INDEX IF NOT EXISTS ix_ta_member_erp_owner_id ON ta_member (erp_owner_id)",
                # Etapa 2: de quem é o número + quem mandou a mensagem humana
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS member_id INTEGER",
                "CREATE INDEX IF NOT EXISTS ix_ta_connector_member_id ON ta_connector (member_id)",
                "ALTER TABLE ta_message_log ADD COLUMN IF NOT EXISTS member_id INTEGER",
                # 07/10/2026: «*Nome:*» na frente da resposta do painel (número dividido)
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS assinar_nome BOOLEAN NOT NULL DEFAULT FALSE",
                # 10/11/2026: botão «IA ligada» do número (desligar sem desconectar o QR)
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS ia_ligada BOOLEAN NOT NULL DEFAULT TRUE",
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS ia_horario TEXT",
                # 16/10/2026: número com VÁRIAS pessoas (padrão Chatwoot/Zendesk) — o
                # `member_id` segue sendo o responsável; aqui ficam as outras que também veem.
                "CREATE TABLE IF NOT EXISTS ta_connector_membro ("
                " connector_id INTEGER NOT NULL REFERENCES ta_connector(id) ON DELETE CASCADE,"
                " member_id INTEGER NOT NULL REFERENCES ta_member(id) ON DELETE CASCADE,"
                " created_at TIMESTAMP DEFAULT now(),"
                " PRIMARY KEY (connector_id, member_id))",
                "CREATE INDEX IF NOT EXISTS ix_ta_connector_membro_member ON ta_connector_membro (member_id)",
                # 12/11/2026: lista fixa de etiquetas da conta (padrão Chatwoot) — a equipe
                # escolhe na lista em vez de digitar. Regras em `services/etiquetas.py`.
                "CREATE TABLE IF NOT EXISTS ta_etiqueta ("
                " id SERIAL PRIMARY KEY,"
                " tenant_id INTEGER NOT NULL REFERENCES ta_tenant(id) ON DELETE CASCADE,"
                " nome VARCHAR(24) NOT NULL,"
                " descricao VARCHAR(200),"
                " cor VARCHAR(7) NOT NULL DEFAULT '#6B7280',"
                " na_lateral BOOLEAN NOT NULL DEFAULT TRUE,"
                " created_at TIMESTAMP DEFAULT now(),"
                " UNIQUE (tenant_id, nome))",
                # 31/10/2026 — pente fino do incidente da M7 (conversas vistas por quem não devia):
                # perfil do WhatsApp de cada número (conferir de quem é o chip)…
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS perfil_whatsapp VARCHAR(200)",
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS perfil_vezes INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS perfil_visto_em TIMESTAMP",
                "ALTER TABLE ta_connector ADD COLUMN IF NOT EXISTS perfil_alertado VARCHAR(200)",
                # …o interruptor «fechar o Atendimento» (modo incidente)…
                "ALTER TABLE ta_tenant ADD COLUMN IF NOT EXISTS atendimento_fechado_em TIMESTAMP",
                # …e o registro de QUEM ABRIU cada conversa (sem ele não há como medir um
                # incidente: «quem leu a conversa da Rebecca?» ficava sem resposta).
                "CREATE TABLE IF NOT EXISTS ta_acesso_conversa ("
                " id BIGSERIAL PRIMARY KEY,"
                " tenant_id INTEGER NOT NULL,"
                " conversation_id INTEGER NOT NULL,"
                " member_id INTEGER,"
                " papel VARCHAR(16),"
                " via VARCHAR(24) NOT NULL,"
                " criado_em TIMESTAMP NOT NULL DEFAULT now())",
                "CREATE INDEX IF NOT EXISTS ix_ta_acesso_conversa_conv ON ta_acesso_conversa (conversation_id, criado_em)",
                "CREATE INDEX IF NOT EXISTS ix_ta_acesso_conversa_tenant ON ta_acesso_conversa (tenant_id, criado_em)",
                "CREATE INDEX IF NOT EXISTS ix_ta_acesso_conversa_member ON ta_acesso_conversa (member_id, criado_em)",
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
                # Quem pode acionar (09/10/2026): 'todos' mantém o que já existia; 'equipe' = só painel
                "ALTER TABLE ta_tool_provider ADD COLUMN IF NOT EXISTS publico VARCHAR(16) NOT NULL DEFAULT 'todos'",
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


async def _ensure_embedding_provider_table():
    """Runtime DDL idempotente — cria ta_embedding_provider (config de embedding do RAG).

    Provider de embedding por tenant (ou global), com chave PRÓPRIA Fernet, separado do
    LLM. Mesmo padrão de ta_tool_provider (sem Alembic — o deploy não roda migrations)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text(
                    """
                    CREATE TABLE IF NOT EXISTS ta_embedding_provider (
                        id SERIAL PRIMARY KEY,
                        tenant_id INTEGER REFERENCES ta_tenant(id) ON DELETE CASCADE,
                        provider VARCHAR(64) NOT NULL,
                        api_key_enc TEXT NOT NULL,
                        default_model VARCHAR(128) NOT NULL,
                        dimensions INTEGER NOT NULL DEFAULT 768,
                        base_url TEXT,
                        cost_per_1m DOUBLE PRECISION,
                        active BOOLEAN NOT NULL DEFAULT true,
                        priority INTEGER NOT NULL DEFAULT 100,
                        created_at TIMESTAMP DEFAULT now(),
                        updated_at TIMESTAMP DEFAULT now()
                    )
                    """
                )
            )
            await db.execute(
                _sql_text(
                    "CREATE INDEX IF NOT EXISTS ix_ta_embedding_provider_scope "
                    "ON ta_embedding_provider (tenant_id, active, priority)"
                )
            )
            await db.commit()
        logger.info("ensure_embedding_provider_table ok")
    except Exception:
        logger.exception("ensure_embedding_provider_table falhou (segue mesmo assim)")


async def _ensure_tenant_avatar_column():
    """Runtime DDL — coluna avatar_url em ta_tenant (foto do perfil, R2)."""
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(_sql_text("ALTER TABLE ta_tenant ADD COLUMN IF NOT EXISTS avatar_url TEXT"))
            await db.commit()
        logger.info("ensure_tenant_avatar_column ok")
    except Exception:
        logger.exception("ensure_tenant_avatar_column falhou (segue mesmo assim)")


async def _ensure_agent_llm_columns():
    """Runtime DDL — modelo por agente em ta_agent.

    Credencial continua na conta (ta_llm_provider); aqui fica só a ESCOLHA do
    agente. NULL = herda o default do tenant, que é o comportamento antigo.
    Colunas pequenas em tabela pequena — seguro no startup.
    """
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            await db.execute(
                _sql_text("ALTER TABLE ta_agent ADD COLUMN IF NOT EXISTS llm_model VARCHAR(128)")
            )
            await db.execute(
                _sql_text("ALTER TABLE ta_agent ADD COLUMN IF NOT EXISTS llm_provider_id INTEGER")
            )
            # FK separada: ADD CONSTRAINT não tem IF NOT EXISTS, então checa antes.
            await db.execute(
                _sql_text(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_ta_agent_llm_provider'
                        ) THEN
                            ALTER TABLE ta_agent
                              ADD CONSTRAINT fk_ta_agent_llm_provider
                              FOREIGN KEY (llm_provider_id)
                              REFERENCES ta_llm_provider(id) ON DELETE SET NULL;
                        END IF;
                    END $$;
                    """
                )
            )
            await db.commit()
        logger.info("ensure_agent_llm_columns ok")
    except Exception:
        logger.exception("ensure_agent_llm_columns falhou (segue mesmo assim)")


async def _ensure_disparo_oficial_tables():
    """Runtime DDL — disparo em lote pelo WhatsApp oficial (11/11/2026).

    `ta_wa_descadastro`: contato que pediu para não receber disparo (por tenant, chave tolerante
    ao 9º dígito). `ta_wa_envio_status`: entrega de cada mensagem da Cloud API pelo wamid.
    Tabelas NOVAS (nascem vazias): os índices abaixo saem na hora — nada de índice em tabela
    grande no startup. Ver services/disparo_oficial.py.
    """
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            for ddl in (
                "CREATE TABLE IF NOT EXISTS ta_wa_descadastro ("
                " id SERIAL PRIMARY KEY,"
                " tenant_id INTEGER NOT NULL,"
                " numero VARCHAR(32) NOT NULL,"
                " chave VARCHAR(32) NOT NULL,"
                " connector_id INTEGER,"
                " texto VARCHAR(255),"
                " criado_em TIMESTAMP NOT NULL DEFAULT now())",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_wa_descadastro_tenant_chave"
                " ON ta_wa_descadastro (tenant_id, chave)",
                "CREATE TABLE IF NOT EXISTS ta_wa_envio_status ("
                " id BIGSERIAL PRIMARY KEY,"
                " wamid VARCHAR(128) NOT NULL,"
                " tenant_id INTEGER,"
                " connector_id INTEGER,"
                " conversation_id INTEGER,"
                " destino VARCHAR(32),"
                " status VARCHAR(16) NOT NULL,"
                " ordem INTEGER NOT NULL DEFAULT 0,"
                " erro_codigo INTEGER,"
                " erro VARCHAR(500),"
                " status_em TIMESTAMP,"
                " criado_em TIMESTAMP NOT NULL DEFAULT now(),"
                " atualizado_em TIMESTAMP NOT NULL DEFAULT now())",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_wa_envio_status_wamid ON ta_wa_envio_status (wamid)",
                "CREATE INDEX IF NOT EXISTS ix_ta_wa_envio_status_tenant ON ta_wa_envio_status (tenant_id, criado_em)",
                # 11/11/2026 — «site sem imagem de prévia» compartilhado pelos 2 processos (services/previa_link.py).
                "CREATE TABLE IF NOT EXISTS ta_site_previa ("
                " host VARCHAR(255) PRIMARY KEY,"
                " tem_imagem BOOLEAN NOT NULL,"
                " conferido_em TIMESTAMP NOT NULL DEFAULT now())",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_disparo_oficial_tables ok")
    except Exception:
        logger.exception("ensure_disparo_oficial_tables falhou (segue mesmo assim)")


async def _ensure_disparo_lote_tables():
    """Runtime DDL — página «Disparos» (disparo em lote pela tela do Agent, 11/11/2026).

    `ta_disparo_oficial` (um disparo) + `ta_disparo_oficial_envio` (um contato do disparo).
    Tabelas NOVAS, nascem vazias: os índices saem na hora. Ver services/disparo_lote.py.
    """
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            for ddl in (
                "CREATE TABLE IF NOT EXISTS ta_disparo_oficial ("
                " id SERIAL PRIMARY KEY,"
                " tenant_id INTEGER NOT NULL,"
                " connector_id INTEGER NOT NULL,"
                " nome VARCHAR(120) NOT NULL,"
                " modelo VARCHAR(512) NOT NULL,"
                " idioma VARCHAR(16) NOT NULL,"
                " categoria VARCHAR(32),"
                " modelo_json JSON,"
                " variaveis_json JSON,"
                " intervalo_ms INTEGER NOT NULL DEFAULT 8000,"
                " variacao_ms INTEGER NOT NULL DEFAULT 2000,"
                " agendado_para TIMESTAMP,"
                " status VARCHAR(16) NOT NULL DEFAULT 'rascunho',"
                " motivo_pausa VARCHAR(500),"
                " total INTEGER NOT NULL DEFAULT 0,"
                " proximo_envio_em TIMESTAMP,"
                " taxa_base_enviados INTEGER NOT NULL DEFAULT 0,"
                " taxa_base_falhas INTEGER NOT NULL DEFAULT 0,"
                " criado_por_member_id INTEGER,"
                " criado_por VARCHAR(120),"
                " criado_em TIMESTAMP NOT NULL DEFAULT now(),"
                " iniciado_em TIMESTAMP,"
                " pausado_em TIMESTAMP,"
                " concluido_em TIMESTAMP,"
                " cancelado_em TIMESTAMP)",
                "CREATE INDEX IF NOT EXISTS ix_ta_disparo_oficial_tenant ON ta_disparo_oficial (tenant_id, id)",
                "CREATE INDEX IF NOT EXISTS ix_ta_disparo_oficial_fila ON ta_disparo_oficial (proximo_envio_em)"
                " WHERE status = 'em_andamento'",
                "CREATE TABLE IF NOT EXISTS ta_disparo_oficial_envio ("
                " id BIGSERIAL PRIMARY KEY,"
                " disparo_id INTEGER NOT NULL REFERENCES ta_disparo_oficial(id) ON DELETE CASCADE,"
                " numero VARCHAR(20) NOT NULL,"
                " chave VARCHAR(32) NOT NULL,"
                " nome VARCHAR(120),"
                " status VARCHAR(16) NOT NULL DEFAULT 'pendente',"
                " tentativas INTEGER NOT NULL DEFAULT 0,"
                " reservado_em TIMESTAMP,"
                " wamid VARCHAR(128),"
                " wa_id VARCHAR(32),"
                " conversation_id INTEGER,"
                " erro_codigo INTEGER,"
                " erro VARCHAR(500),"
                " enviado_em TIMESTAMP)",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_disparo_oficial_envio_chave"
                " ON ta_disparo_oficial_envio (disparo_id, chave)",
                "CREATE INDEX IF NOT EXISTS ix_ta_disparo_oficial_envio_fila"
                " ON ta_disparo_oficial_envio (disparo_id, status, id)",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_disparo_lote_tables ok")
    except Exception:
        logger.exception("ensure_disparo_lote_tables falhou (segue mesmo assim)")


async def _ensure_wa_preco_columns():
    """Runtime DDL — cobrança da Meta por mensagem em `ta_wa_envio_status` (12/11/2026).

    O webhook de status traz o objeto `pricing` (billable, pricing_model, type, category, subtype)
    e, na janela grátis de anúncio, `conversation.origin.type`. Base do relatório «WhatsApp oficial»
    (services/relatorio_whatsapp_oficial.py). Só ADD COLUMN nullable, sem índice: a tabela nasceu em
    11/11 e o relatório filtra pelo índice que já existe (tenant_id, criado_em). Roda DEPOIS de
    `_ensure_disparo_oficial_tables` (que cria a tabela).
    """
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            for ddl in (
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS cobravel BOOLEAN",
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS tipo_preco VARCHAR(32)",
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS categoria_preco VARCHAR(32)",
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS modelo_preco VARCHAR(8)",
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS subtipo_preco VARCHAR(32)",
                "ALTER TABLE ta_wa_envio_status ADD COLUMN IF NOT EXISTS origem_conversa VARCHAR(32)",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_wa_preco_columns ok")
    except Exception:
        logger.exception("ensure_wa_preco_columns falhou (segue mesmo assim)")


async def _ensure_callback_tables():
    """Runtime DDL — callbacks por agente (11/11/2026, CCDA).

    `ta_callback_envio`: um passo de callback por conversa (único conversa+passo, gravado antes de
    enviar). Tabela NOVA (nasce vazia): o índice sai na hora. Ver services/callbacks.py.
    """
    try:
        from sqlalchemy import text as _sql_text

        from core.db import db_context

        async with db_context() as db:
            for ddl in (
                "CREATE TABLE IF NOT EXISTS ta_callback_envio ("
                " id SERIAL PRIMARY KEY,"
                " conversation_id INTEGER NOT NULL,"
                " agent_id INTEGER NOT NULL,"
                " passo VARCHAR(64) NOT NULL,"
                " ancora_em TIMESTAMP,"
                " status VARCHAR(16) NOT NULL,"
                " motivo VARCHAR(64),"
                " enviado_em TIMESTAMP,"
                " criado_em TIMESTAMP NOT NULL DEFAULT now())",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_callback_envio_conv_passo"
                " ON ta_callback_envio (conversation_id, passo)",
            ):
                await db.execute(_sql_text(ddl))
            await db.commit()
        logger.info("ensure_callback_tables ok")
    except Exception:
        logger.exception("ensure_callback_tables falhou (segue mesmo assim)")


@app.on_event("startup")
async def startup():
    logger.info("Tier Agent starting — env=%s port=%s", settings.environment, settings.app_port)
    await _ensure_message_content_column()
    await _ensure_canned_response_table()
    await _ensure_member_table()
    await _ensure_tool_provider_table()
    await _ensure_incident_table()
    await _ensure_embedding_provider_table()
    await _ensure_tenant_avatar_column()
    await _ensure_agent_llm_columns()
    await _ensure_disparo_oficial_tables()
    await _ensure_disparo_lote_tables()
    await _ensure_wa_preco_columns()
    await _ensure_callback_tables()
    from services import registro_atividade

    registro_atividade.iniciar()
    from scheduler import init_scheduler
    init_scheduler()
    # Worker do disparo em lote (página «Disparos»): pendurado no MESMO scheduler, sem mexer em
    # scheduler.py. A trava entre os 2 workers é no banco (services/disparo_lote.py).
    try:
        from services import disparo_lote

        disparo_lote.agendar(init_scheduler())
    except Exception:
        logger.exception("worker do disparo em lote não agendou (segue sem ele)")
    # Discord Gateway (inbound): task de fundo, líder eleito via Redis (não duplica
    # entre workers). Totalmente opcional — se discord.py/Redis falhar, o backend segue.
    try:
        from workers.discord_gateway import start_discord_gateway

        start_discord_gateway()
    except Exception:
        logger.exception("discord gateway não iniciou (opcional, segue)")


@app.on_event("shutdown")
async def shutdown():
    logger.info("Tier Agent shutting down")
    from services import registro_atividade

    await registro_atividade.parar()
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
