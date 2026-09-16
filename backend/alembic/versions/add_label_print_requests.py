"""Persist print prompts across backend workers.

Revision ID: add_label_print_requests
Revises: e8a1c4d2b907
"""

import sqlalchemy as sa
from alembic import op

revision = "add_label_print_requests"
down_revision = "e8a1c4d2b907"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "label_print_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("spool_id", sa.Integer(), sa.ForeignKey("spools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("preset_id", sa.Integer(), sa.ForeignKey("label_presets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_label_print_requests_pending", "label_print_requests", ["claimed_at", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_label_print_requests_pending", table_name="label_print_requests")
    op.drop_table("label_print_requests")
