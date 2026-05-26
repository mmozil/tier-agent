"""playbook resume real + notifications table

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ta_playbook_execution.next_node_id (pra resume real do nó wait)
    op.add_column(
        "ta_playbook_execution",
        sa.Column("next_node_id", sa.String(64), nullable=True),
    )

    # ta_notification — inbox de eventos pra equipe do tenant
    # (handoff_human cria 1 linha por handoff disparado)
    op.create_table(
        "ta_notification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("ta_conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "playbook_execution_id",
            sa.Integer(),
            sa.ForeignKey("ta_playbook_execution.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("category", sa.String(32), nullable=False, server_default="info"),
        # category: handoff | error | info
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("queue", sa.String(64), nullable=True),
        # queue: fila de atendimento (vendas, suporte, etc) — pra handoff
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unread"),
        # status: unread | read | archived
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_notif_tenant_status", "ta_notification", ["tenant_id", "status", "created_at"])
    op.create_index("idx_notif_agent", "ta_notification", ["agent_id"])


def downgrade() -> None:
    op.drop_table("ta_notification")
    op.drop_column("ta_playbook_execution", "next_node_id")
