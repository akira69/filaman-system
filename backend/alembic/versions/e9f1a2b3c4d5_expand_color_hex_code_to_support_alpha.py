"""expand color hex_code to support alpha values

Revision ID: e9f1a2b3c4d5
Revises: b37af859a415
Create Date: 2026-04-07 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f1a2b3c4d5'
down_revision: Union[str, Sequence[str], None] = 'b37af859a415'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('colors', schema=None) as batch_op:
        batch_op.alter_column(
            'hex_code',
            existing_type=sa.String(length=7),
            type_=sa.String(length=9),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('colors', schema=None) as batch_op:
        batch_op.alter_column(
            'hex_code',
            existing_type=sa.String(length=9),
            type_=sa.String(length=7),
            existing_nullable=False,
        )
