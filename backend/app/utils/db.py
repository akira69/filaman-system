"""Database-agnostic utility functions."""

from typing import Any

from sqlalchemy import Column, String, func
from sqlalchemy.sql import expression


def _dialect_name(dialect: Any) -> str:
    """Extract dialect name string (sqlite, postgresql, mysql)."""
    if dialect is None:
        return "sqlite"
    return getattr(dialect, "name", "sqlite")


def json_extract(column: Column, path: str, dialect: Any = None) -> expression.ColumnElement:
    """
    Database-agnostic JSON extract function.
    
    Supports SQLite, PostgreSQL, and MySQL.
    
    Args:
        column: The JSON/JSONB column
        path: JSON path (e.g., '$.key')
        dialect: SQLAlchemy dialect (if None, defaults to SQLite)
    
    Returns:
        SQLAlchemy expression for JSON extraction
    """
    name = _dialect_name(dialect)
    if name == "postgresql":
        # PostgreSQL: column->>'key'
        key = path.removeprefix("$.")
        return column[key].astext
    elif name == "mysql":
        # MySQL: JSON_EXTRACT(column, '$.key')
        return column.op('JSON_EXTRACT')(path)
    else:
        # SQLite: json_extract(column, '$.key')
        return func.json_extract(column, path)


def json_extract_cast_string(column: Column, path: str, dialect: Any = None) -> expression.ColumnElement:
    """
    Database-agnostic JSON extract cast to string.
    
    Args:
        column: The JSON/JSONB column
        path: JSON path (e.g., '$.key')
        dialect: SQLAlchemy dialect
    
    Returns:
        SQLAlchemy expression for JSON extraction cast to string
    """
    name = _dialect_name(dialect)
    if name == "postgresql":
        # PostgreSQL: column->>'key' (already returns text)
        key = path.removeprefix("$.")
        return column[key].astext
    elif name == "mysql":
        # MySQL: CAST(JSON_EXTRACT(...) AS CHAR)
        return func.cast(column.op('JSON_EXTRACT')(path), String())
    else:
        # SQLite: CAST(json_extract(...) AS TEXT)
        return func.cast(func.json_extract(column, path), String())
