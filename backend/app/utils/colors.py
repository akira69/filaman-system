from __future__ import annotations

from string import hexdigits
from typing import Any


def normalize_hex_color(value: Any) -> str:
    """Normalize a color value to `#RRGGBB` or `#AARRGGBB`.

    Accepts optional `#` prefixes and 3/4-digit shorthand values.
    Stored values are normalized to uppercase with a leading `#`.
    """
    if value is None:
        raise ValueError("hex_code is required")

    raw = str(value).strip().lstrip("#")
    if not raw:
        raise ValueError("hex_code is required")

    if len(raw) in (3, 4):
        raw = "".join(ch * 2 for ch in raw)

    if len(raw) not in (6, 8) or any(ch not in hexdigits for ch in raw):
        raise ValueError("hex_code must use #RRGGBB or #AARRGGBB format")

    return f"#{raw.upper()}"


def visible_rgb_hex(value: Any) -> str:
    """Return the visible RGB portion for display/printing.

    SpoolmanDB encodes alpha-aware colors as `#AARRGGBB`. For CSS swatches or
    device payloads that expect opaque RGB, we drop the leading alpha bytes.
    """
    normalized = normalize_hex_color(value)
    raw = normalized[1:]
    if len(raw) == 8:
        raw = raw[2:]
    return f"#{raw}"
