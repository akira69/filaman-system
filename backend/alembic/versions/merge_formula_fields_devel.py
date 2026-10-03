"""Merge formula fields with the upstream migration line.

Revision ID: merge_formula_devel_20261003
Revises: f1e2d3c4b5a6, merge_labels_tags_20260916
"""

from collections.abc import Sequence

revision: str = "merge_formula_devel_20261003"
down_revision: str | Sequence[str] | None = (
    "f1e2d3c4b5a6",
    "merge_labels_tags_20260916",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
