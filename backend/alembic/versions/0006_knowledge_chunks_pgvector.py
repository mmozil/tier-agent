"""ta_knowledge_chunk com pgvector pra RAG real

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Garante extensão pgvector (idempotent — Postgres do Tier já tem instalada)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "ta_knowledge_chunk",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "knowledge_id",
            sa.Integer(),
            sa.ForeignKey("ta_knowledge.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("ta_agent.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("tokens_count", sa.Integer(), nullable=False, server_default="0"),
        # vector(768) — Gemini text-embedding-004 retorna 768 dims
        sa.Column("embedding", sa.dialects.postgresql.ARRAY(sa.Float()), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    # Trocar coluna ARRAY → vector(768) via SQL bruto (Alembic não tem helper pra pgvector)
    op.execute("ALTER TABLE ta_knowledge_chunk DROP COLUMN embedding")
    op.execute("ALTER TABLE ta_knowledge_chunk ADD COLUMN embedding vector(768)")

    op.create_index(
        "idx_kchunk_agent_knowledge",
        "ta_knowledge_chunk",
        ["agent_id", "knowledge_id"],
    )
    # HNSW index pra cosine similarity (pgvector 0.5+)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_kchunk_embedding_hnsw ON ta_knowledge_chunk "
        "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_kchunk_embedding_hnsw")
    op.drop_index("idx_kchunk_agent_knowledge", table_name="ta_knowledge_chunk")
    op.drop_table("ta_knowledge_chunk")
