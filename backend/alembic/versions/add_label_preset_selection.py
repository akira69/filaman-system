"""add selected spool label preset marker"""

import sqlalchemy as sa
from alembic import op

revision = "add_label_preset_selection"
down_revision = "add_label_print_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("label_presets") as batch_op:
        batch_op.add_column(
            sa.Column("selected_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("label_presets") as batch_op:
        batch_op.drop_column("selected_at")
