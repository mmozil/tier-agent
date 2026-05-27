"""playbook marketplace flags + ratings

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ta_playbook", sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ta_playbook", sa.Column("public_label", sa.String(120), nullable=True))
    op.add_column("ta_playbook", sa.Column("public_description", sa.Text(), nullable=True))
    op.add_column("ta_playbook", sa.Column("marketplace_downloads", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ta_playbook", sa.Column("marketplace_rating", sa.Float(), nullable=True))
    op.add_column("ta_playbook", sa.Column("source_playbook_id", sa.Integer(), sa.ForeignKey("ta_playbook.id", ondelete="SET NULL"), nullable=True))

    op.create_index("idx_playbook_public", "ta_playbook", ["is_public", "marketplace_downloads"])


def downgrade() -> None:
    op.drop_index("idx_playbook_public", table_name="ta_playbook")
    op.drop_column("ta_playbook", "source_playbook_id")
    op.drop_column("ta_playbook", "marketplace_rating")
    op.drop_column("ta_playbook", "marketplace_downloads")
    op.drop_column("ta_playbook", "public_description")
    op.drop_column("ta_playbook", "public_label")
    op.drop_column("ta_playbook", "is_public")
