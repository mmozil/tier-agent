"""agente escolhe o proprio modelo (herda o do tenant quando vazio)

Separa credencial de escolha, no mesmo desenho do Dify:
- ta_llm_provider (tenant) = cofre de chaves + default da conta
- ta_agent.llm_model       = modelo DESTE agente; NULL herda o default acima

Nao mexe em embedding: a coluna pgvector e vector(768) fixa, entao o provider de
embedding continua por tenant (todo provider tem que emitir 768 dims).

Revision ID: 0010
Revises: 0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ta_agent", sa.Column("llm_model", sa.String(128), nullable=True))
    op.add_column("ta_agent", sa.Column("llm_provider_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_ta_agent_llm_provider",
        "ta_agent",
        "ta_llm_provider",
        ["llm_provider_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_ta_agent_llm_provider", "ta_agent", type_="foreignkey")
    op.drop_column("ta_agent", "llm_provider_id")
    op.drop_column("ta_agent", "llm_model")
