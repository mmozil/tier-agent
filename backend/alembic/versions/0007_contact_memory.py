"""ta_contact_memory + ta_memory_config — Mem0-like cross-session pra cada contato

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Garante extensão (já tem do 0006, mas idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ta_memory_config (1 por tenant — policy de retention/quota)
    op.create_table(
        "ta_memory_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("retention_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("max_facts_per_contact", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("importance_threshold", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # ta_contact_memory (1 row por fato extraído)
    op.create_table(
        "ta_contact_memory",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.Integer(),
            sa.ForeignKey("ta_agent.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_chat_id", sa.String(128), nullable=False, index=True),
        # category: preference | fact | event | profile
        sa.Column("category", sa.String(32), nullable=False, server_default="fact"),
        sa.Column("fact", sa.Text(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False, server_default="3"),  # 1-5
        sa.Column("source_message_at", sa.DateTime(), nullable=True),
        sa.Column("last_referenced_at", sa.DateTime(), nullable=True),
        sa.Column("references_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    # Add embedding column via raw SQL (pgvector type)
    op.execute("ALTER TABLE ta_contact_memory ADD COLUMN embedding vector(768)")

    op.create_index(
        "idx_cmem_agent_contact",
        "ta_contact_memory",
        ["agent_id", "external_chat_id"],
    )
    op.create_index(
        "idx_cmem_tenant_created",
        "ta_contact_memory",
        ["tenant_id", "created_at"],
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_cmem_embedding_hnsw ON ta_contact_memory "
        "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cmem_embedding_hnsw")
    op.drop_index("idx_cmem_tenant_created", table_name="ta_contact_memory")
    op.drop_index("idx_cmem_agent_contact", table_name="ta_contact_memory")
    op.drop_table("ta_contact_memory")
    op.drop_table("ta_memory_config")
