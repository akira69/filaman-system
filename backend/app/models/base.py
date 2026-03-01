from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, JSON, TypeDecorator, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class TZDateTime(TypeDecorator):
    """A DateTime type that ensures timezone-aware datetimes.

    Stores as DateTime(timezone=True) in the database.
    On read, naive datetimes (from pre-migration data) are
    automatically tagged as UTC.
    """

    impl = DateTime
    cache_ok = True

    def __init__(self):
        super().__init__(timezone=True)

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

class Base(DeclarativeBase):
    type_annotation_map = {
        dict[str, Any]: JSON,
        list[str]: JSON,
    }


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        TZDateTime(), default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TZDateTime(), default=func.now(), onupdate=func.now(), nullable=False
    )
