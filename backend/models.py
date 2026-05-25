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
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
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
