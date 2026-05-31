from __future__ import annotations

from string import hexdigits
from typing import Any


def normalize_hex_color(value: Any) -> str:
    """Normalize a color value to CSS-compatible `#RRGGBB` or `#RRGGBBAA`.

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
        raise ValueError("hex_code must use #RRGGBB or #RRGGBBAA format")

    return f"#{raw.upper()}"


def normalize_spoolmandb_hex_color(value: Any) -> str:
    """Normalize SpoolmanDB color data to `#RRGGBB` or `#RRGGBBAA`.

    SpoolmanDB documents 8-digit colors as a 6-digit RGB value plus alpha,
    but some existing entries look like legacy `AARRGGBB` values. Convert
    those known shapes so stored values remain CSS-compatible.
    """
    normalized = normalize_hex_color(value)
    raw = normalized[1:]

    if len(raw) == 8 and _looks_like_legacy_argb(raw):
        raw = raw[2:] + raw[:2]
        return f"#{raw}"

    return normalized


def visible_rgb_hex(value: Any) -> str:
    """Return the visible RGB portion for display/printing.

    For device payloads that expect opaque RGB, drop the trailing alpha bytes.
    """
    normalized = normalize_hex_color(value)
    raw = normalized[1:]
    if len(raw) == 8:
        raw = raw[:6]
    return f"#{raw}"


def _looks_like_legacy_argb(raw: str) -> bool:
    """Detect SpoolmanDB values that appear to be `AARRGGBB`.

    Current SpoolmanDB schema allows RGB plus optional alpha. A few historical
    entries use a leading alpha byte (`00FFFFFF`, `3C8AD77F`). Keep this narrow
    to avoid rewriting valid CSS-style values such as `00D4D488`.
    """
    alpha = raw[:2]
    suffix = raw[-2:]
    if alpha == "00" and suffix == "FF":
        return True
    return alpha == "3C"
