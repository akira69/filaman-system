"""Cancel queued print requests when their explicit preset is deleted.

Revision ID: label_request_preset_cascade
Revises: label_print_request_sequence
"""

import sqlalchemy as sa
from alembic import op

revision = "label_request_preset_cascade"
down_revision = "label_print_request_sequence"
branch_labels = None
depends_on = None

_FK_NAME = "fk_label_print_requests_preset_id_label_presets"
_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
}


def _replace_preset_foreign_key(ondelete: str) -> None:
    bind = op.get_bind()
    foreign_key = next(
        constraint
        for constraint in sa.inspect(bind).get_foreign_keys("label_print_requests")
        if constraint["constrained_columns"] == ["preset_id"]
    )
    options = {}
    if bind.dialect.name == "sqlite":
        options = {
            "recreate": "always",
            "table_kwargs": {"sqlite_autoincrement": True},
        }
    with op.batch_alter_table(
        "label_print_requests",
        naming_convention=_NAMING_CONVENTION,
        **options,
    ) as batch_op:
        batch_op.drop_constraint(
            foreign_key["name"] or _FK_NAME,
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            _FK_NAME,
            "label_presets",
            ["preset_id"],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    _replace_preset_foreign_key("CASCADE")


def downgrade() -> None:
    _replace_preset_foreign_key("SET NULL")
