"""Best-effort Pillow renderer for saved version 2 label designs."""

import re
from io import BytesIO
from math import ceil, floor

from fastapi import HTTPException
from PIL import Image, ImageDraw, UnidentifiedImageError

from app.services.label_basic_renderer import (
    label_qr_target,
    label_swatch_colors,
    render_qr_image,
)
from app.services.label_font import label_font
from app.services.label_text import (
    clip_label_line,
    resolve_label_runs,
)


def _range(value: object, minimum: float, maximum: float) -> float:
    if (
        not isinstance(value, (int, float))
        or not minimum <= value <= maximum
    ):
        raise HTTPException(
            status_code=422, detail="Preset design has invalid geometry"
        )
    return float(value)


def _mm(value: object, maximum: float) -> float:
    return _range(value, 0, maximum)


def _position(value: object, element_size: float, label_size: float) -> float:
    # Match frontend clampElementPosition, including zero-sized legacy text.
    overlap = min(0.1, element_size)
    return _range(value, overlap - element_size, label_size - overlap)


def _color(value: object, *, allow_empty: bool = False) -> str | None:
    if allow_empty and value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise HTTPException(
            status_code=422, detail="Preset design has an invalid color"
        )
    return value


def _run_width(run, font):
    return font.getlength("0") * (run + 0.4) if isinstance(run, int) else font.getlength(run)


def _text_lines(runs, font, width, wrap, break_words):
    lines, line, used = [], [], 0
    for run in runs:
        parts = [run] if isinstance(run, int) else re.split(r"(\n|[^\S\n]+)", run)
        for part in parts:
            if part == "\n":
                lines.append(line)
                line, used = [], 0
                continue
            if part == "":
                continue
            size = _run_width(part, font)
            if wrap and line and used + size > width and not (isinstance(part, str) and part.isspace()):
                lines.append(line)
                line, used = [], 0
            if wrap and not line and isinstance(part, str) and part.isspace():
                continue
            if wrap and break_words and isinstance(part, str) and size > width:
                while part and _run_width(part, font) > width:
                    # clip_label_line retains one overflowing glyph for painting;
                    # wrapping must instead carry that glyph to the next line.
                    count = max(1, len(clip_label_line(part, font, width)) - 1)
                    lines.append([part[:count]])
                    part = part[count:]
                size = _run_width(part, font)
            line.append(part)
            used += size
    if line:
        lines.append(line)
    return lines


def _text_layout(element, scale, values, raw_values):
    runs = resolve_label_runs(str(element.get("template", ""))[:8000], values, raw_values=raw_values)
    size = max(1, round(_mm(element.get("fontSizeMm", 3.2), 20) * scale))
    bold = element.get("fontWeight") in (600, 700, "bold")
    role = element.get("legacyTextRole")
    spacing = 1.4 if role == "info" else 1 if role == "title" else 1.15
    minimum = max(1, round(_mm(element.get("minFontSizeMm", 2 if element.get("wrap") else 0.265), 20) * scale))
    width, height = max(1, round(element["w"] * scale)), max(1, round(element["h"] * scale))
    while True:
        font = label_font(size, bold)
        lines = _text_lines(runs, font, width, element.get("wrap"), role != "info")
        line_height = max(1, round(size * spacing))
        if not element.get("fitToWidth") or size <= minimum or (
            all(sum(_run_width(run, font) for run in line) <= width for line in lines)
            and (not element.get("wrap") or len(lines) * line_height <= height)
        ):
            return font, lines, line_height
        size -= 1


def _legacy_layout(elements, scale, values, raw_values, has_logo):
    """Flow only migrated rows, using original geometry for neighbor selection."""
    result = [dict(element, hidden=False) for element in elements]

    def shift_after(source, shift):
        for original, target in zip(elements, result):
            if original["y"] <= source["y"] or original is source:
                continue
            factor = {"bottom": 0, "center": 0.5}.get(original.get("legacyVAlign"), 1) if original["type"] == "qr" else 1
            target["y"] -= shift * factor
            if original.get("legacyTextRole") == "info" or original["type"] == "shape" and original["h"] > original["w"]:
                target["h"] += shift

    for index, element in enumerate(elements):
        if not has_logo and element["type"] == "manufacturerLogo" and element.get("collapseWhenEmpty"):
            divider = next((i for i, item in enumerate(elements) if item.get("legacyLogoDivider")), None)
            shift = element["h"] + 0.5
            result[index]["hidden"] = True
            if divider is not None:
                result[divider]["hidden"] = True
                shift += 0.5 + elements[divider]["h"]
            shift_after(element, shift)
        if element.get("legacyTextRole") != "title":
            continue
        _, lines, line_height = _text_layout(element, scale, values, raw_values)
        empty = not any(isinstance(run, int) or run.strip() for line in lines for run in line)
        below = index + 1 if element.get("legacyDividerBelow") and index + 1 < len(elements) and elements[index + 1]["type"] == "shape" else None
        if empty:
            result[index]["hidden"] = True
            shift = element["h"] + 2 * element.get("legacyTitleMarginMm", 0)
            if below is not None:
                result[below]["hidden"] = True
                shift += elements[below]["h"]
        elif not element.get("wrap"):
            result[index]["h"] = line_height / scale
            shift = element["h"] - result[index]["h"]
        else:
            shift = 0
        shift_after(element, shift)
    return result


def render_v2_label(
    design: dict,
    width: int,
    values: dict[str, str],
    colors: list[str],
    qr_url: str,
    logo_content: bytes | None,
    assets: dict[str, bytes],
    colored: bool,
    thermal: bool = False,
    height: int | None = None,
    raw_values: dict[str, object] | None = None,
) -> Image.Image:
    label = design.get("label")
    elements = design.get("elements")
    if (
        design.get("version") != 2
        or not isinstance(label, dict)
        or not isinstance(elements, list)
        or len(elements) > 100
    ):
        raise HTTPException(status_code=422, detail="Preset design is invalid")
    width_mm = _mm(label.get("widthMm"), 300)
    height_mm = _mm(label.get("heightMm"), 200)
    if width_mm < 20 or height_mm < 10:
        raise HTTPException(
            status_code=422, detail="Preset design has invalid dimensions"
        )
    scale = width / width_mm
    height = height if height is not None else round(height_mm * scale)
    if height > 2048:
        raise HTTPException(
            status_code=422, detail="Preset is too tall for the requested width"
        )
    image = Image.new("RGB", (width, height), "white")
    colors = label_swatch_colors(colors)
    draw = ImageDraw.Draw(image)
    if label.get("border"):
        inset = round(_mm(label.get("marginMm", 0), 6) * scale)
        if 2 * inset < min(width, height):
            draw.rectangle(
                (inset, inset, width - inset - 1, height - inset - 1),
                outline="black",
                width=max(1, round(0.3 * scale)),
            )

    if any(
        not isinstance(item, dict) or not isinstance(item.get("z", 0), int)
        for item in elements
    ):
        raise HTTPException(
            status_code=422, detail="Preset design has an invalid element"
        )
    for element in elements:
        legacy_qr = element.get("type") == "qr" and element.get("legacyVAlign") in ("top", "center", "bottom")
        w_mm = _mm(element.get("w"), 40 if legacy_qr else width_mm)
        h_mm = _mm(element.get("h"), 40 if legacy_qr else height_mm)
        _position(element.get("x"), w_mm, width_mm)
        _position(element.get("y"), h_mm, height_mm)
        if element.get("legacyTextRole") == "title":
            _range(element.get("legacyTitleMarginMm", 0), -1, 4)
    elements = _legacy_layout(elements, scale, values, raw_values, logo_content is not None)
    for element in sorted(elements, key=lambda item: (item.get("type") == "qr", item.get("z", 0))):
        if element.get("hidden"):
            continue
        if element.get("type") not in {
            "text",
            "qr",
            "manufacturerLogo",
            "image",
            "swatch",
            "shape",
        }:
            raise HTTPException(
                status_code=422, detail="Preset design has an unsupported element"
            )
        w_mm, h_mm = element["w"], element["h"]
        x, y = round(element["x"] * scale), round(element["y"] * scale)
        if element["type"] != "qr" and (y >= height or y + h_mm * scale <= 0):
            continue
        w = max(1, round(w_mm * scale))
        h = max(1, round(h_mm * scale))
        if h > 4096:
            raise HTTPException(422, "Migrated preset layout exceeds the render budget")
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        painter = ImageDraw.Draw(layer)
        kind = element["type"]
        if kind == "shape":
            fill = _color(element.get("fill", ""), allow_empty=True)
            stroke = _color(element.get("stroke", ""), allow_empty=True)
            line_width = round(_mm(element.get("strokeWidthMm", 0), 10) * scale)
            shape = element.get("shape")
            if shape == "line":
                if stroke and line_width:
                    painter.line((0, h // 2, w, h // 2), fill=stroke, width=line_width)
            elif shape in {"rectangle", "square", "circle"}:
                box = (0, 0, w - 1, h - 1)
                if shape == "circle":
                    painter.ellipse(box, fill=fill, outline=stroke, width=line_width)
                else:
                    radius = round(
                        _mm(element.get("radiusMm", 0), min(width_mm, height_mm))
                        * scale
                    )
                    painter.rounded_rectangle(
                        box, radius=radius, fill=fill, outline=stroke, width=line_width
                    )
            else:
                raise HTTPException(
                    status_code=422, detail="Preset design has an unsupported shape"
                )
        elif kind == "swatch":
            if colors:
                for index, color in enumerate(colors):
                    painter.rectangle(
                        (
                            index * w // len(colors),
                            0,
                            (index + 1) * w // len(colors),
                            h,
                        ),
                        fill=color,
                    )
        elif kind == "text":
            font, lines, line_height = _text_layout(element, scale, values, raw_values)
            role = element.get("legacyTextRole")
            align = element.get("align", "left")
            valign = element.get("verticalAlign", "top")
            start_y = (h - len(lines) * line_height) * (0.5 if valign == "middle" else 1 if valign == "bottom" else 0)
            ascent, descent = font.getmetrics()
            color = _color(element.get("color", "#000000"))
            for number, runs in enumerate(lines):
                line_y = start_y + number * line_height
                if line_y >= h:
                    break
                if line_y + line_height <= 0:
                    continue
                line_width = sum(_run_width(run, font) for run in runs)
                line_x = max(0, round((w - line_width) * (0.5 if align == "center" else 1 if align == "right" else 0)))
                baseline = line_y + (line_height - ascent - descent) / 2 + ascent
                for run in runs:
                    if line_x >= w:
                        break
                    if isinstance(run, int):
                        gap = font.getlength("0") * 0.2
                        sw = font.getlength("0") * run
                        sh = font.size * 0.82
                        swatch_colors = colors or ["#9AA0A6"]
                        for index, swatch_color in enumerate(swatch_colors):
                            painter.rectangle((line_x + gap + index * sw / len(swatch_colors), baseline - sh,
                                               line_x + gap + (index + 1) * sw / len(swatch_colors), baseline),
                                              fill=swatch_color)
                        line_x += sw + gap * 2
                        continue
                    run = clip_label_line(run, font, w - line_x, "..." if role == "title" and not element.get("fitToWidth") else "")
                    # Space Grotesk has no check/cross glyphs; draw their meaning.
                    for part in re.split(r"([✓✗])", run):
                        advance = font.getlength(part)
                        if part in ("✓", "✗"):
                            left, top = line_x, baseline - font.size * 0.75
                            right, bottom = left + advance * 0.85, baseline
                            stroke = max(1, round(font.size / 12))
                            if part == "✓":
                                painter.line((left, top + font.size * 0.4, left + advance * 0.3, bottom, right, top), fill=color, width=stroke)
                            else:
                                painter.line((left, top, right, bottom), fill=color, width=stroke)
                                painter.line((left, bottom, right, top), fill=color, width=stroke)
                        else:
                            painter.text((line_x, baseline), part, font=font, fill=color, anchor="ls")
                        line_x += advance
        elif kind == "qr":
            target = label_qr_target(
                element.get("linkMode"),
                str(element.get("urlTemplate", "")),
                qr_url,
                values["id"],
            )
            qr = render_qr_image(target, min(w, h), "RGBA", thermal)
            if thermal and (x < 0 or y < 0 or x + qr.width > width or y + qr.height > height):
                raise HTTPException(422, "Thermal QR box must fit inside the label")
            painter.rectangle((0, 0, w, h), fill="white")
            layer.paste(qr, (0, 0))
        elif kind in {"manufacturerLogo", "image"}:
            source = (
                logo_content
                if kind == "manufacturerLogo"
                else assets.get(str(element.get("assetId", "")))
            )
            if kind == "image" and source is None:
                raise HTTPException(
                    status_code=422, detail="Preset image is unavailable"
                )
            try:
                if source is not None:
                    with Image.open(BytesIO(source)) as original:
                        picture = original.convert("RGBA")
                    crop = element.get("crop")
                    if isinstance(crop, dict):
                        cx, cy, cw, ch = (
                            _mm(crop.get(key), 1) for key in ("x", "y", "w", "h")
                        )
                        if cw <= 0 or ch <= 0 or cx + cw > 1 or cy + ch > 1:
                            raise HTTPException(
                                status_code=422, detail="Preset image crop is invalid"
                            )
                        left, top = (
                            floor(cx * picture.width),
                            floor(cy * picture.height),
                        )
                        right = max(left + 1, ceil((cx + cw) * picture.width))
                        bottom = max(top + 1, ceil((cy + ch) * picture.height))
                        picture = picture.crop((left, top, right, bottom))
                    logo_height = h
                    if kind == "manufacturerLogo" and element.get("manualSizeMm") is not None:
                        logo_height = min(h, max(1, round(_mm(element["manualSizeMm"], 20) * scale)))
                    ratio = min(w / picture.width, logo_height / picture.height)
                    picture = picture.resize((max(1, round(picture.width * ratio)),
                                              max(1, round(picture.height * ratio))), Image.Resampling.LANCZOS)
                    align = element.get("align", "center") if kind == "manufacturerLogo" else "center"
                    offset = round((w - picture.width) * (0 if align == "left" else 1 if align == "right" else 0.5))
                    layer.paste(picture, (offset, (h - picture.height) // 2))
            except (OSError, UnidentifiedImageError):
                if kind == "image":
                    raise HTTPException(
                        status_code=422, detail="Preset image is unavailable"
                    ) from None
        image.paste(layer, (x, y), layer)
    return image if colored else image.convert("L").convert("RGB")
