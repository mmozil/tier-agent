"""initial — 13 tabelas TA*

Revision ID: 0001
Revises:
Create Date: 2026-05-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ta_tenant",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_user_id", sa.Integer, index=True, nullable=True),
        sa.Column("nome", sa.String(255), nullable=False),
        sa.Column("cnpj", sa.String(14), unique=True, index=True, nullable=True),
        sa.Column("email", sa.String(255), nullable=False, index=True),
        sa.Column("sku", sa.String(32), nullable=False, server_default="trial"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_agent",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True),
        sa.Column("nome", sa.String(255), nullable=False),
        sa.Column("persona", sa.Text, nullable=True),
        sa.Column("system_prompt", sa.Text, nullable=True),
        sa.Column("template_kind", sa.String(64), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_llm_provider",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True, nullable=True),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("api_key_enc", sa.Text, nullable=False),
        sa.Column("default_model", sa.String(128), nullable=False),
        sa.Column("fallback_chain_json", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("temperature", sa.Float, nullable=False, server_default="0.7"),
        sa.Column("max_tokens", sa.Integer, nullable=False, server_default="4096"),
        sa.Column("timeout_s", sa.Integer, nullable=False, server_default="30"),
        sa.Column("cost_input_per_1m", sa.Float, nullable=True),
        sa.Column("cost_output_per_1m", sa.Float, nullable=True),
        sa.Column("base_url", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_feature_flag",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("escopo", sa.String(16), nullable=False, index=True),
        sa.Column("escopo_id", sa.Integer, nullable=True, index=True),
        sa.Column("key", sa.String(64), nullable=False, index=True),
        sa.Column("value", sa.String(255), nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("escopo", "escopo_id", "key", name="uq_feature_scope_key"),
    )

    op.create_table(
        "ta_runtime_param",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("escopo", sa.String(16), nullable=False, index=True),
        sa.Column("escopo_id", sa.Integer, nullable=True, index=True),
        sa.Column("key", sa.String(64), nullable=False, index=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("escopo", "escopo_id", "key", name="uq_param_scope_key"),
    )

    op.create_table(
        "ta_connector",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True),
        sa.Column("kind", sa.String(32), nullable=False, index=True),
        sa.Column("config_json_enc", sa.Text, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_event_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_knowledge",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("source_url", sa.Text, nullable=True),
        sa.Column("r2_key", sa.Text, nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("skill_md_path", sa.Text, nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="indexing"),
        sa.Column("chunks_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("indexed_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_conversation",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), index=True),
        sa.Column("connector_kind", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False, index=True),
        sa.Column("contact_name", sa.String(255), nullable=True),
        sa.Column("started_at", sa.DateTime, server_default=sa.func.now(), index=True),
        sa.Column("last_message_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("msg_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    )

    op.create_table(
        "ta_message_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("ta_conversation.id", ondelete="CASCADE"), index=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("tokens_in", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens_out", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("model_used", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )

    op.create_table(
        "ta_usage_daily",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), index=True),
        sa.Column("day", sa.String(10), nullable=False, index=True),
        sa.Column("messages", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens_in", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens_out", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tts_chars", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("tenant_id", "day", name="uq_usage_tenant_day"),
    )

    op.create_table(
        "ta_subscription",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), unique=True, index=True),
        sa.Column("sku", sa.String(32), nullable=False),
        sa.Column("tierpay_subscription_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="trial"),
        sa.Column("next_billing_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ta_audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, nullable=True, index=True),
        sa.Column("actor", sa.String(255), nullable=False),
        sa.Column("action", sa.String(64), nullable=False, index=True),
        sa.Column("target", sa.String(255), nullable=True),
        sa.Column("payload_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )

    op.create_table(
        "ta_webhook_event",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source", sa.String(64), nullable=False, index=True),
        sa.Column("event_id", sa.String(255), nullable=False, index=True),
        sa.Column("payload_json", sa.JSON, nullable=True),
        sa.Column("processed_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("source", "event_id", name="uq_webhook_source_event"),
    )

    op.create_table(
        "ta_container",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), unique=True, index=True),
        sa.Column("docker_container_id", sa.String(64), nullable=True, index=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="not_created"),
        sa.Column("host", sa.String(255), nullable=False, server_default="localhost"),
        sa.Column("port", sa.Integer, nullable=True),
        sa.Column("image_version", sa.String(64), nullable=True),
        sa.Column("last_health_check_at", sa.DateTime, nullable=True),
        sa.Column("restart_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    for t in [
        "ta_container",
        "ta_webhook_event",
        "ta_audit_log",
        "ta_subscription",
        "ta_usage_daily",
        "ta_message_log",
        "ta_conversation",
        "ta_knowledge",
        "ta_connector",
        "ta_runtime_param",
        "ta_feature_flag",
        "ta_llm_provider",
        "ta_agent",
        "ta_tenant",
    ]:
        op.drop_table(t)
