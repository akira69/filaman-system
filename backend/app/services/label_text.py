"""Plain-text template resolution and bounded Pillow text layout."""

import re
from datetime import date, datetime

# Match the browser template output ceiling, including expanded field values.
_MAX_TEXT_LENGTH = 12000


def resolve_label_text(template: str, values: dict[str, object], *, preserve_swatches: bool = False,
                       raw_values: dict[str, object] | None = None) -> str:
    return "".join(run if isinstance(run, str) else f"{{color_swatch[{run}]}}" if preserve_swatches else ""
                   for run in resolve_label_runs(template, values, raw_values=raw_values))


def resolve_label_runs(template: str, values: dict[str, object], *,
                       raw_values: dict[str, object] | None = None) -> list[str | int]:
    protected: list[str | int] = []
    remaining = _MAX_TEXT_LENGTH

    def protect(raw: object) -> str:
        nonlocal remaining
        if isinstance(raw, int):
            protected.append(raw)
            return f"\0{len(protected) - 1}\0"
        text = str(raw)[:remaining]
        remaining -= len(text)

        def keep(match: re.Match) -> str:
            protected.append(match.group())
            return f"\0{len(protected) - 1}\0"

        return re.sub(
            r"[\0{}]|\*{1,3}|==|__|@@|\^\^|\[/?(?:b|i|size(?:=\d{1,3}%?)?|font(?:=[^\]\n]+)?)\]",
            keep,
            text,
            flags=re.IGNORECASE,
        )

    def value(token: str) -> str | int:
        key = token.strip()
        if swatch := re.fullmatch(r"color[-_]swatch(?:\[(\d{1,3})\])?", key, re.IGNORECASE):
            return max(1, min(40, int(swatch.group(1) or 1)))
        missing = object()
        raw = values.get(key, missing)
        date_only = False
        if raw is missing and (match := re.fullmatch(r"(.*)\|date", key, re.IGNORECASE)):
            base = match.group(1).strip()
            raw = (raw_values or {}).get(base, values.get(base, missing))
            date_only = True
        if raw is missing:
            return ""
        if raw is None or raw == "":
            return ""
        if date_only:
            try:
                parsed = raw.date() if isinstance(raw, datetime) else raw
                if not isinstance(parsed, date):
                    parsed = date.fromisoformat(str(raw)[:10])
                raw = parsed.strftime("%x")
            except ValueError:
                pass
        return str(raw)[:_MAX_TEXT_LENGTH]

    expanded = template[:_MAX_TEXT_LENGTH].replace("\0", "�").replace("\\n", "\n")
    conditional = re.compile(
        r"\[if=\{([^{}\n]+)\}\]((?:(?!\[if=).)*?)\[/if\]",
        re.IGNORECASE | re.DOTALL,
    )
    while conditional.search(expanded):
        expanded = conditional.sub(
            lambda match: match.group(2) if value(match.group(1)) else "", expanded
        )
    def substitute(match: re.Match) -> str:
        if match.group(4) is not None:
            return protect(value(match.group(4)))
        raw = value(match.group(2))
        return match.group(1) + protect(raw) + match.group(3) if raw else ""

    expanded = re.sub(r"\{([^{}]*)\{([^{}]+)\}([^{}]*)\}|\{([^{}]+)\}", substitute, expanded)
    expanded = re.sub(
        r"\^\^([\s\S]*?)\^\^", lambda match: match.group(1).upper(), expanded
    )
    expanded = re.sub(
        r"\[/?(?:b|i|size(?:=\d{1,3}%?)?|font(?:=[^\]\n]+)?)\]",
        "",
        expanded,
        flags=re.IGNORECASE,
    )
    expanded = re.sub(r"\*{1,3}|==|__|@@", "", expanded)
    runs: list[str | int] = []
    budget = _MAX_TEXT_LENGTH
    for part in re.split(r"(\0\d+\0)", expanded):
        run = protected[int(part[1:-1])] if re.fullmatch(r"\0\d+\0", part) else part
        if isinstance(run, str):
            run = run[:budget]
            budget -= len(run)
            if not run:
                continue
            if runs and isinstance(runs[-1], str):
                runs[-1] += run
                continue
        runs.append(run)
    return runs


def clip_label_line(text, font, width, suffix=""):
    """Limit the glyph mask before Pillow allocates it, not only the output box."""
    if font.getlength(text) <= width:
        return text
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if font.getlength(text[:middle] + suffix) <= width:
            low = middle
        else:
            high = middle - 1
    return text[:low if suffix else low + 1] + suffix


def wrap_label_lines(text, font, width):
    """Match legacy word wrapping without breaking unspaced field values."""
    lines = []
    for raw_line in text.splitlines():
        line = ""
        for word in raw_line.split():
            candidate = f"{line} {word}" if line else word
            if line and font.getlength(candidate) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return lines
