"""Pure conversion helpers for Spoolman extra fields."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from datetime import datetime
from typing import Any


class SpoolmanFieldError(ValueError):
    """A Spoolman field definition or value cannot be mapped safely."""


_TYPE_MAP = {
    "text": "text",
    "integer": "number",
    "float": "number",
    "integer_range": "range",
    "float_range": "range",
    "datetime": "datetime",
    "boolean": "checkbox",
}
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def decode_spoolman_value(raw: Any, field_type: str | None = None) -> Any:
    """Decode Spoolman's JSON-in-a-string value, including legacy cleaned text."""
    if not isinstance(raw, str):
        return raw
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    # Older FilaMan imports stripped the JSON quotes from text values. A value
    # such as "true" is then indistinguishable from a JSON boolean unless the
    # authoritative field definition tells us it is text.
    if field_type in {"text", "datetime"} and not isinstance(value, str):
        return raw
    return value


def convert_spoolman_value(
    raw: Any,
    field_type: str,
    choices: list[str] | None = None,
    multi_choice: bool | None = None,
) -> Any:
    """Convert one Spoolman wire value to FilaMan's native JSON shape."""
    value = decode_spoolman_value(raw, field_type)

    if field_type in {"text", "datetime"}:
        if not isinstance(value, str):
            raise SpoolmanFieldError("expected a string")
        if field_type == "datetime":
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as exc:
                raise SpoolmanFieldError("expected an ISO-8601 datetime") from exc
        return value

    if field_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise SpoolmanFieldError("expected an integer")
        return value

    if field_type == "float":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise SpoolmanFieldError("expected a number")
        return value

    if field_type in {"integer_range", "float_range"}:
        if not isinstance(value, list) or len(value) != 2:
            raise SpoolmanFieldError("expected a two-item range")
        for item in value:
            valid_number = isinstance(item, int | float) and not isinstance(item, bool)
            if item is not None and not valid_number:
                raise SpoolmanFieldError("range endpoints must be numbers or null")
            if (
                field_type == "integer_range"
                and item is not None
                and not isinstance(item, int)
            ):
                raise SpoolmanFieldError("range endpoints must be integers or null")
        return {"min": value[0], "max": value[1]}

    if field_type == "boolean":
        if not isinstance(value, bool):
            raise SpoolmanFieldError("expected a boolean")
        return value

    if field_type == "choice":
        multi = isinstance(value, list)
        if multi_choice is True and not multi:
            raise SpoolmanFieldError("expected multiple choices")
        if multi_choice is False and multi:
            raise SpoolmanFieldError("expected one choice")
        selected = value if multi else [value]
        if not all(isinstance(item, str) for item in selected):
            raise SpoolmanFieldError("expected a string choice")
        if choices is not None and any(item not in choices for item in selected):
            raise SpoolmanFieldError("value is not in the configured choices")
        return value

    raise SpoolmanFieldError(f"unsupported Spoolman field type: {field_type}")


def map_spoolman_definition(
    definition: dict[str, Any], target_type: str
) -> dict[str, Any]:
    """Map a Spoolman field definition to a native SystemExtraField candidate."""
    if target_type not in {"filament", "spool"}:
        raise SpoolmanFieldError(f"unsupported target: {target_type}")

    key = definition.get("key")
    label = definition.get("name")
    source_type = definition.get("field_type")
    if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", key):
        raise SpoolmanFieldError("invalid field key")
    if not isinstance(label, str) or not label.strip():
        raise SpoolmanFieldError("invalid field name")

    options: list[str] | None = None
    if source_type == "choice":
        choices = definition.get("choices")
        if (
            not isinstance(choices, list)
            or not choices
            or not all(isinstance(item, str) for item in choices)
        ):
            raise SpoolmanFieldError("choice field has invalid choices")
        options = list(choices)
        native_type = (
            "multiselect" if definition.get("multi_choice") is True else "dropdown"
        )
    else:
        native_type = _TYPE_MAP.get(source_type)
        if native_type is None:
            raise SpoolmanFieldError(f"unsupported Spoolman field type: {source_type}")

    config: dict[str, Any] = {}
    if source_type in {"integer", "integer_range"}:
        config["decimal_places"] = 0
    unit = definition.get("unit")
    if (
        source_type in {"integer", "float", "integer_range", "float_range"}
        and isinstance(unit, str)
        and unit
    ):
        config["unit"] = unit

    default_value = None
    if definition.get("default_value") is not None:
        converted = convert_spoolman_value(
            definition["default_value"],
            source_type,
            options,
            definition.get("multi_choice"),
        )
        default_value = _serialize_default(converted)
        if len(default_value) > 500:
            raise SpoolmanFieldError(
                "default value exceeds FilaMan's 500-character limit"
            )

    return {
        "target_type": target_type,
        "key": key,
        "label": label.strip(),
        "field_type": native_type,
        "options": options,
        "config": config or None,
        "default_value": default_value,
        "source_field_type": source_type,
        "order": definition.get("order", 0)
        if isinstance(definition.get("order", 0), int)
        else 0,
    }


def definitions_compatible(candidate: dict[str, Any], existing: Any) -> bool:
    """Return whether an existing FilaMan definition can safely receive values."""
    existing_type = getattr(existing, "field_type", None)
    wanted_type = candidate["field_type"]
    if wanted_type == "number":
        type_matches = existing_type in {"number", "integer", "float"}
    else:
        type_matches = existing_type == wanted_type
    if not type_matches:
        return False

    if wanted_type in {"dropdown", "multiselect"}:
        existing_options = set(getattr(existing, "options", None) or [])
        if not set(candidate.get("options") or []).issubset(existing_options):
            return False

    wanted_unit = (candidate.get("config") or {}).get("unit")
    existing_config = getattr(existing, "config", None) or {}
    existing_unit = existing_config.get("unit")
    if wanted_unit != existing_unit:
        return False

    source_type = candidate.get("source_field_type")
    if (
        source_type in {"float", "float_range"}
        and existing_config.get("decimal_places") == 0
    ):
        return False
    if wanted_type in {"number", "range"} and any(
        existing_config.get(key) is not None for key in ("min_bound", "max_bound")
    ):
        return False
    return True


def infer_definition(
    target_type: str, key: str, raw_values: Iterable[Any]
) -> dict[str, Any]:
    """Suggest a conservative native definition from legacy stored values."""
    values = [decode_spoolman_value(value) for value in raw_values]
    if not values:
        raise SpoolmanFieldError("no values to infer")
    if not re.fullmatch(r"[A-Za-z0-9_]{1,100}", key):
        return _inferred_result(target_type, key, "text", "unresolved", None, values)

    source_type: str | None = None
    confidence = "low"
    options: list[str] | None = None

    if all(isinstance(value, bool) for value in values):
        source_type, confidence = "boolean", "low"
    elif all(
        isinstance(value, int) and not isinstance(value, bool) for value in values
    ):
        source_type, confidence = "integer", "low"
    elif all(
        isinstance(value, int | float) and not isinstance(value, bool)
        for value in values
    ):
        source_type, confidence = "float", "low"
    elif all(_is_numeric_range(value) for value in values):
        endpoints = [item for value in values for item in value if item is not None]
        source_type = (
            "integer_range"
            if all(isinstance(item, int) for item in endpoints)
            else "float_range"
        )
        confidence = "medium"
    elif all(
        isinstance(value, list) and all(isinstance(item, str) for item in value)
        for value in values
    ):
        source_type, confidence = "choice", "medium"
        options = sorted({item for value in values for item in value})
    elif all(isinstance(value, str) for value in values):
        if all(_is_datetime(value) for value in values):
            source_type, confidence = "datetime", "medium"
        else:
            source_type, confidence = "text", "low"

    if source_type is None:
        return _inferred_result(target_type, key, "text", "unresolved", None, values)

    result = _inferred_result(
        target_type, key, source_type, confidence, options, values
    )
    if source_type == "choice":
        result["field_type"] = "multiselect"
        result["source_field_type"] = "choice"
    return result


def fingerprint(value: Any) -> str:
    """Create a stable fingerprint for preview/execute drift detection."""
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _serialize_default(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    return json.dumps(value, separators=(",", ":"))


def _is_numeric_range(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(
            item is None
            or (isinstance(item, int | float) and not isinstance(item, bool))
            for item in value
        )
    )


def _is_datetime(value: str) -> bool:
    if _ISO_DATE.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _inferred_result(
    target_type: str,
    key: str,
    source_type: str,
    confidence: str,
    options: list[str] | None,
    values: list[Any],
) -> dict[str, Any]:
    if source_type == "choice":
        native_type = "multiselect"
    else:
        native_type = _TYPE_MAP[source_type]
    config = (
        {"decimal_places": 0} if source_type in {"integer", "integer_range"} else None
    )
    return {
        "target_type": target_type,
        "key": key,
        "label": key.replace("_", " ").strip().title(),
        "field_type": native_type,
        "source_field_type": source_type,
        "options": options,
        "config": config,
        "default_value": None,
        "confidence": confidence,
        "samples": values[:5],
        "occurrences": len(values),
    }
