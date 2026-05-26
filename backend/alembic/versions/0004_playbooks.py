"""playbooks — canvas visual + trigger index + execution + step_log

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. ta_playbook
    op.create_table(
        "ta_playbook",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nome", sa.String(120), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("canvas_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_playbook_agent_status", "ta_playbook", ["agent_id", "status"])

    # 2. ta_playbook_trigger_index
    op.create_table(
        "ta_playbook_trigger_index",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("playbook_id", sa.Integer(), sa.ForeignKey("ta_playbook.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(64), nullable=False),
        sa.Column("trigger_type", sa.String(32), nullable=False),
        sa.Column("trigger_data", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_trigger_playbook", "ta_playbook_trigger_index", ["playbook_id"])
    op.create_index(
        "idx_trigger_agent_type_enabled",
        "ta_playbook_trigger_index",
        ["agent_id", "trigger_type", "enabled"],
    )

    # 3. ta_playbook_execution
    op.create_table(
        "ta_playbook_execution",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("playbook_id", sa.Integer(), sa.ForeignKey("ta_playbook.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("ta_conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("trigger_type", sa.String(32), nullable=True),
        sa.Column("trigger_node_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("vars_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("started_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("resume_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("idx_exec_playbook", "ta_playbook_execution", ["playbook_id"])
    op.create_index("idx_exec_conversation", "ta_playbook_execution", ["conversation_id"])
    op.create_index("idx_exec_status_resume", "ta_playbook_execution", ["status", "resume_at"])

    # 4. ta_playbook_step_log
    op.create_table(
        "ta_playbook_step_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "execution_id",
            sa.Integer(),
            sa.ForeignKey("ta_playbook_execution.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", sa.String(64), nullable=False),
        sa.Column("node_type", sa.String(32), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=True),
        sa.Column("output_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="ok"),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_step_execution_created", "ta_playbook_step_log", ["execution_id", "created_at"])


def downgrade() -> None:
    op.drop_table("ta_playbook_step_log")
    op.drop_table("ta_playbook_execution")
    op.drop_table("ta_playbook_trigger_index")
    op.drop_table("ta_playbook")
