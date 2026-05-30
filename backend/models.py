"""Models do Tier Agent control plane.

Multi-tenant via tenant_id em toda query. Detalhe de runtime do agente
(memória, skills, FTS5, sessions) fica isolado no SQLite do container Hermes
do tenant. Aqui guardamos só: configuração, billing, audit, agregação leve.
"""

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db import Base


# ============================================================
# 1. Tenant — empresa cliente
# ============================================================
class TaTenant(Base):
    __tablename__ = "ta_tenant"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)  # nome da empresa
    nome_pessoa: Mapped[str | None] = mapped_column(String(255), nullable=True)  # nome do usuário responsável
    cnpj: Mapped[str | None] = mapped_column(String(14), unique=True, nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(32), default="trial", nullable=False)
    # sku: trial | ta-starter | ta-pro | ta-business
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    # status: active | suspended | cancelled
    # Login (MVP: tenant_email + password vira JWT). V2 split em ta_user.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    agents: Mapped[list["TaAgent"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


# ============================================================
# 2. Agent — instância de agente do tenant
# ============================================================
class TaAgent(Base):
    __tablename__ = "ta_agent"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    persona: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # template_kind: atendente_loja | sdr | suporte | cobranca | custom
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    tenant: Mapped["TaTenant"] = relationship(back_populates="agents")
    connectors: Mapped[list["TaConnector"]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    knowledge: Mapped[list["TaKnowledge"]] = relationship(back_populates="agent", cascade="all, delete-orphan")


# ============================================================
# 3. LLM Provider — config de provider/modelo (zero hardcode)
# ============================================================
class TaLlmProvider(Base):
    __tablename__ = "ta_llm_provider"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True, nullable=True
    )
    # tenant_id NULL = config global default Tier

    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    # provider: minimax | gemini | anthropic | openrouter | openai | nous | local

    api_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    # Fernet-encrypted

    default_model: Mapped[str] = mapped_column(String(128), nullable=False)
    fallback_chain_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # ex: [{"provider":"anthropic","model":"claude-sonnet-4-6"}, {"provider":"openai","model":"gpt-4o-mini"}]

    temperature: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096, nullable=False)
    timeout_s: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    cost_input_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_output_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)

    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pra providers OpenAI-compatible customizados

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 4. Feature Flag — toggle on/off (zero hardcode)
# ============================================================
class TaFeatureFlag(Base):
    __tablename__ = "ta_feature_flag"
    __table_args__ = (UniqueConstraint("escopo", "escopo_id", "key", name="uq_feature_scope_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    escopo: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # escopo: global | tenant | agent

    escopo_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # escopo_id: NULL pra global, tenant_id pra tenant, agent_id pra agent

    key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 5. Runtime Param — key-value config (zero hardcode)
# ============================================================
class TaRuntimeParam(Base):
    __tablename__ = "ta_runtime_param"
    __table_args__ = (UniqueConstraint("escopo", "escopo_id", "key", name="uq_param_scope_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    escopo: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    escopo_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 6. Connector — canal habilitado por agente
# ============================================================
class TaConnector(Base):
    __tablename__ = "ta_connector"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # kind: whatsapp | telegram | email | web_form | signal | discord

    config_json_enc: Mapped[str] = mapped_column(Text, nullable=False)
    # Fernet-encrypted JSON com tokens/keys/etc

    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    agent: Mapped["TaAgent"] = relationship(back_populates="connectors")


# ============================================================
# 7. Knowledge — fonte de RAG por agente
# ============================================================
class TaKnowledge(Base):
    __tablename__ = "ta_knowledge"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    # kind: pdf | sheet | url | text | manual

    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    r2_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    skill_md_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # path dentro do container Hermes do tenant

    status: Mapped[str] = mapped_column(String(32), default="indexing", nullable=False)
    # status: indexing | ready | failed

    chunks_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    agent: Mapped["TaAgent"] = relationship(back_populates="knowledge")


# ============================================================
# 8. Conversation log — agregação leve (detalhe fica no SQLite Hermes)
# ============================================================
class TaConversation(Base):
    __tablename__ = "ta_conversation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True)
    connector_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # ex: número WhatsApp, chat_id Telegram, email From, etc

    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    last_message_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    msg_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    # status: active | closed | handed_off
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # lista de etiquetas (ex: ["orçamento", "vip"]) — adicionada via ensure runtime DDL
    assigned_to: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # nome do atendente responsável (display)
    assigned_member_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # FK lógica pra ta_member.id (fila/round-robin + filtro "minhas conversas")
    csat_state: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    # csat: none | pending | done
    csat_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-5
    csat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sla_alerted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # quando o último alerta de SLA foi disparado (anti-spam do job)


class TaMessageLog(Base):
    __tablename__ = "ta_message_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ta_conversation.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # role: user | assistant | system | tool

    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # texto da mensagem (user/assistant) — pra inbox/histórico. Coluna adicionada
    # via ensure_message_content_column() (runtime DDL, nullable, retrocompatível).
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ============================================================
# 9. Usage daily — billing / quota
# ============================================================
class TaUsageDaily(Base):
    __tablename__ = "ta_usage_daily"
    __table_args__ = (UniqueConstraint("tenant_id", "day", name="uq_usage_tenant_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tts_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


# ============================================================
# 10. Subscription — vínculo com Tier Pay
# ============================================================
class TaSubscription(Base):
    __tablename__ = "ta_subscription"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("ta_tenant.id", ondelete="CASCADE"), unique=True, index=True
    )
    sku: Mapped[str] = mapped_column(String(32), nullable=False)
    tierpay_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="trial", nullable=False)
    # status: trial | active | paused | cancelled | past_due
    next_billing_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 11. Audit log
# ============================================================
class TaAuditLog(Base):
    __tablename__ = "ta_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ============================================================
# 12. Webhook event — idempotency
# ============================================================
class TaWebhookEvent(Base):
    __tablename__ = "ta_webhook_event"
    __table_args__ = (UniqueConstraint("source", "event_id", name="uq_webhook_source_event"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    processed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ============================================================
# 13. Container health — orquestração Hermes
# ============================================================
class TaContainer(Base):
    __tablename__ = "ta_container"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("ta_tenant.id", ondelete="CASCADE"), unique=True, index=True)
    docker_container_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="not_created", nullable=False)
    # status: not_created | starting | running | unhealthy | stopped | failed

    host: Mapped[str] = mapped_column(String(255), default="localhost", nullable=False)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    last_health_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    restart_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 14. Playbook — canvas visual estilo N8N + ManyChat híbrido
# ============================================================
class TaPlaybook(Base):
    """Fluxo de atendimento desenhado em canvas drag-and-drop.

    Quando publicado, popula ta_playbook_trigger_index e passa a
    interceptar mensagens antes do Hermes via agent_runtime.
    """
    __tablename__ = "ta_playbook"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False, index=True)
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    canvas_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # {version, nodes:[{id,type,position,data}], edges:[{id,source,target,sourceHandle?}]}
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    # status: draft | published | archived
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Q3.5: marketplace
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    public_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    public_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    marketplace_downloads: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    marketplace_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_playbook_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_playbook.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ============================================================
# 15. Trigger index — denormalização pra match rápido na mensagem
# ============================================================
class TaPlaybookTriggerIndex(Base):
    """Snapshot dos nós trigger de cada playbook publicado.

    Atualizada em POST /playbooks/{id}/publish. Permite query única
    por agent_id+trigger_type sem ter que parsear canvas_json em runtime.
    """
    __tablename__ = "ta_playbook_trigger_index"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playbook_id: Mapped[int] = mapped_column(ForeignKey("ta_playbook.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # trigger_keyword | trigger_intent | trigger_manual | trigger_cron | trigger_event
    trigger_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        # índice composto pra lookup rápido por agent+trigger ativo
        # criado via Index() em migration (Alembic gera melhor que aqui)
    )


# ============================================================
# 16. Playbook execution — 1 row por run
# ============================================================
class TaPlaybookExecution(Base):
    __tablename__ = "ta_playbook_execution"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playbook_id: Mapped[int] = mapped_column(ForeignKey("ta_playbook.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_conversation.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trigger_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trigger_node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    # status: running | completed | failed | waiting | handed_off
    vars_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resume_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # pra nó wait — scheduler.resume_waiting_playbooks job
    next_node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # quando pause=True, guarda o próximo node_id que executor deve rodar no resume

    error: Mapped[str | None] = mapped_column(Text, nullable=True)


# ============================================================
# 17. Playbook step log — log de cada nó executado
# ============================================================
class TaPlaybookStepLog(Base):
    __tablename__ = "ta_playbook_step_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("ta_playbook_execution.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    node_type: Mapped[str] = mapped_column(String(32), nullable=False)
    input_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    # status: ok | error | skipped
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ============================================================
# 18.5 Tier Pay config por tenant (Q3.7 multi-tenant)
# ============================================================
class TaTierPayConfig(Base):
    __tablename__ = "ta_tier_pay_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("ta_tenant.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    secret_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    recipient_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    statement_descriptor: Mapped[str | None] = mapped_column(String(22), nullable=True)
    fee_percent: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    webhook_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


# ============================================================
# 18. Notification — inbox de eventos pra equipe do tenant
# ============================================================
class TaNotification(Base):
    """Notificações criadas por nós de playbook (especialmente handoff_human)
    ou eventos do sistema (erros críticos, alertas billing).
    """
    __tablename__ = "ta_notification"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("ta_tenant.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=True, index=True
    )
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_conversation.id", ondelete="SET NULL"), nullable=True
    )
    playbook_execution_id: Mapped[int | None] = mapped_column(
        ForeignKey("ta_playbook_execution.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(32), default="info", nullable=False)
    # category: handoff | lead | sla | mention | error | info
    target_member_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # se setado, notificação é direcionada a este atendente (ex: @menção). null = broadcast do tenant
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    queue: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # queue: fila de atendimento (vendas, suporte) — só usado em handoff
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="unread", nullable=False)
    # status: unread | read | archived
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ============================================================
# Membros do time (atendentes) — multi-usuário por tenant
# ============================================================
class TaMember(Base):
    """Atendente/membro do tenant. O 'owner' (dono) continua autenticando via
    TaTenant; estes são contas adicionais com login próprio, usadas em
    atribuição de conversas (fila/round-robin) e @menção em notas."""
    __tablename__ = "ta_member"
    __table_args__ = (UniqueConstraint("email", name="uq_member_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("ta_tenant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(16), default="atendente", nullable=False)
    # role: admin | atendente  (owner é o TaTenant, fora desta tabela)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    # status: active | disabled
    online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_conversas: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0 = ilimitado
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


# ============================================================
# Respostas prontas (canned responses) — atalhos do atendente
# ============================================================
class TaCannedResponse(Base):
    """Respostas prontas por tenant — o atendente insere com 1 clique na hora de
    responder pelo painel. `shortcut` é um atalho curto (ex: 'horario')."""
    __tablename__ = "ta_canned_response"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("ta_tenant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shortcut: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
