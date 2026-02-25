"""add_capabilities_to_installed_plugins

Add capabilities JSON column to installed_plugins table.

Revision ID: add_plugin_capabilities
Revises: remove_ams_fields
Create Date: 2026-02-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_plugin_capabilities'
down_revision: Union[str, Sequence[str], None] = 'remove_ams_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('installed_plugins') as batch_op:
        batch_op.add_column(sa.Column('capabilities', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('installed_plugins') as batch_op:
        batch_op.drop_column('capabilities')
