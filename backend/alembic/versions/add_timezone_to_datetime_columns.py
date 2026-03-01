"""add_timezone_to_datetime_columns

Revision ID: add_timezone_aware
Revises: add_oidc_tables
Create Date: 2026-03-01 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_timezone_aware'
down_revision: Union[str, None] = 'add_oidc_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# All DateTime columns that need timezone=True, grouped by table.
# Format: (table_name, column_name, nullable)
DATETIME_COLUMNS = [
    # TimestampMixin (created_at, updated_at) on every table
    ('colors', 'created_at', False),
    ('colors', 'updated_at', False),
    ('devices', 'created_at', False),
    ('devices', 'updated_at', False),
    ('devices', 'last_used_at', True),
    ('devices', 'last_seen_at', True),
    ('devices', 'deleted_at', True),
    ('locations', 'created_at', False),
    ('locations', 'updated_at', False),
    ('manufacturers', 'created_at', False),
    ('manufacturers', 'updated_at', False),
    ('permissions', 'created_at', False),
    ('permissions', 'updated_at', False),
    ('roles', 'created_at', False),
    ('roles', 'updated_at', False),
    ('spool_statuses', 'created_at', False),
    ('spool_statuses', 'updated_at', False),
    ('users', 'created_at', False),
    ('users', 'updated_at', False),
    ('users', 'last_login_at', True),
    ('users', 'deleted_at', True),
    ('filaments', 'created_at', False),
    ('filaments', 'updated_at', False),
    ('oauth_identities', 'created_at', False),
    ('oauth_identities', 'updated_at', False),
    ('oauth_identities', 'token_expires_at', True),
    ('oauth_identities', 'last_used_at', True),
    ('printers', 'created_at', False),
    ('printers', 'updated_at', False),
    ('printers', 'deleted_at', True),
    ('user_api_keys', 'created_at', False),
    ('user_api_keys', 'updated_at', False),
    ('user_api_keys', 'last_used_at', True),
    ('user_sessions', 'created_at', False),
    ('user_sessions', 'last_used_at', True),
    ('user_sessions', 'expires_at', True),
    ('user_sessions', 'revoked_at', True),
    ('filament_colors', 'created_at', False),
    ('filament_printer_profiles', 'created_at', False),
    ('filament_printer_profiles', 'updated_at', False),
    ('filament_ratings', 'created_at', False),
    ('filament_ratings', 'updated_at', False),
    ('printer_ams_units', 'created_at', False),
    ('printer_ams_units', 'updated_at', False),
    ('spools', 'created_at', False),
    ('spools', 'updated_at', False),
    ('spools', 'purchase_date', True),
    ('spools', 'stocked_in_at', True),
    ('spools', 'last_used_at', True),
    ('printer_slots', 'created_at', False),
    ('printer_slots', 'updated_at', False),
    ('spool_events', 'created_at', False),
    ('spool_events', 'event_at', False),
    ('printer_slot_assignments', 'inserted_at', True),
    ('printer_slot_assignments', 'updated_at', False),
    ('printer_slot_events', 'created_at', False),
    ('printer_slot_events', 'event_at', False),
    ('installed_plugins', 'installed_at', True),
    ('oidc_settings', 'created_at', False),
    ('oidc_settings', 'updated_at', False),
    ('oidc_auth_states', 'created_at', False),
    ('oidc_auth_states', 'used_at', True),
]


def upgrade() -> None:
    """Make all DateTime columns timezone-aware.

    For PostgreSQL: alters column type to TIMESTAMP WITH TIME ZONE.
    For SQLite/MySQL: no-op since these engines store datetimes as text/DATETIME
    without real timezone distinction. The application layer now writes
    timezone-aware values (with Z suffix).
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table, column, nullable in DATETIME_COLUMNS:
            # Use raw SQL for PostgreSQL to convert existing naive UTC values
            op.execute(
                sa.text(
                    f'ALTER TABLE {table} '
                    f'ALTER COLUMN {column} '
                    f'TYPE TIMESTAMP WITH TIME ZONE '
                    f"USING {column} AT TIME ZONE 'UTC'"
                )
            )
    # SQLite and MySQL: no schema change needed.
    # SQLite stores datetimes as TEXT, MySQL DATETIME has no timezone variant.
    # The application now writes timezone-aware ISO strings (ending in Z).


def downgrade() -> None:
    """Revert DateTime columns back to timezone-naive.

    For PostgreSQL: alters column type back to TIMESTAMP WITHOUT TIME ZONE.
    For SQLite/MySQL: no-op.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table, column, nullable in DATETIME_COLUMNS:
            op.execute(
                sa.text(
                    f'ALTER TABLE {table} '
                    f'ALTER COLUMN {column} '
                    f'TYPE TIMESTAMP WITHOUT TIME ZONE'
                )
            )
