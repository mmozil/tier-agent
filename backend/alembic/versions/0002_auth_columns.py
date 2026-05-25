"""auth columns em ta_tenant

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ta_tenant", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("ta_tenant", sa.Column("is_admin", sa.Boolean, nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("ta_tenant", "is_admin")
    op.drop_column("ta_tenant", "password_hash")
