"""expand color hex_code to support alpha values

Revision ID: ef529a7422d8
Revises: c9f2a1e4b7d3
Create Date: 2026-04-07 16:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ef529a7422d8"
down_revision: str | Sequence[str] | None = "c9f2a1e4b7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("colors", schema=None) as batch_op:
        batch_op.alter_column(
            "hex_code",
            existing_type=sa.String(length=7),
            type_=sa.String(length=9),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("colors", schema=None) as batch_op:
        batch_op.alter_column(
            "hex_code",
            existing_type=sa.String(length=9),
            type_=sa.String(length=7),
            existing_nullable=False,
        )
