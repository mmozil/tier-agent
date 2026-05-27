"""ta_tier_pay_config — Pagar.me secret key por tenant

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ta_tier_pay_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("ta_tenant.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("secret_key_enc", sa.Text(), nullable=False),  # Fernet-encrypted sk_*
        sa.Column("recipient_id", sa.String(64), nullable=True),  # re_* Pagar.me
        sa.Column("statement_descriptor", sa.String(22), nullable=True),
        sa.Column("fee_percent", sa.Float(), nullable=False, server_default="1.0"),  # split Tier master
        sa.Column("webhook_secret_enc", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ta_tier_pay_config")
