"""nome_pessoa em ta_tenant

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ta_tenant", sa.Column("nome_pessoa", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("ta_tenant", "nome_pessoa")
