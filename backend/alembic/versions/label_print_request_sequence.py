"""Keep SQLite print request IDs unique after expired requests are removed."""

from alembic import op

revision = "label_print_request_sequence"
down_revision = "add_label_preset_selection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        # Rebuild existing installations, preserving rows, foreign keys and indexes.
        with op.batch_alter_table(
            "label_print_requests", recreate="always", table_kwargs={"sqlite_autoincrement": True}
        ):
            pass


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table(
            "label_print_requests", recreate="always", table_kwargs={"sqlite_autoincrement": False}
        ):
            pass
