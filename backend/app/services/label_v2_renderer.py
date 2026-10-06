"""Best-effort Pillow renderer for saved version 2 label designs."""

import re
from io import BytesIO
from math import ceil, floor

from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

from app.services.label_basic_renderer import (
    label_qr_target,
    label_swatch_colors,
    render_qr_image,
)
from app.services.label_font import label_font
from app.services.label_text import (
    clip_label_line,
    resolve_label_text,
    wrap_label_lines,
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
    for element in sorted(elements, key=lambda item: (item.get("type") == "qr", item.get("z", 0))):
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
        # Migrated QR boxes may overhang short labels; Pillow clips the paste.
        legacy_qr = element["type"] == "qr" and element.get("legacyVAlign") in ("top", "center", "bottom")
        w_mm = _mm(element.get("w"), 40 if legacy_qr else width_mm)
        h_mm = _mm(element.get("h"), 40 if legacy_qr else height_mm)
        x = round(_position(element.get("x"), w_mm, width_mm) * scale)
        y = round(_position(element.get("y"), h_mm, height_mm) * scale)
        w = max(1, round(w_mm * scale))
        h = max(1, round(h_mm * scale))
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
            content = resolve_label_text(str(element.get("template", ""))[:8000], values)
            font_size = max(1, round(_mm(element.get("fontSizeMm", 3.2), 20) * scale))
            bold = element.get("fontWeight") in (600, 700, "bold")
            font = label_font(font_size, bold)
            role = element.get("legacyTextRole")
            spacing = 1.4 if role == "info" else 1 if role == "title" else 1.15

            lines = wrap_label_lines(content, font, w) if element.get("wrap") else content.splitlines()
            if element.get("fitToWidth"):
                minimum = max(1, round(_mm(element.get("minFontSizeMm", 2 if element.get("wrap") else 0.265), 20) * scale))
                while font_size > minimum and (
                    any(font.getlength(line) > w for line in lines)
                    or element.get("wrap") and len(lines) * max(1, round(font_size * spacing)) > h
                ):
                    font_size -= 1
                    font = label_font(font_size, bold)
                    lines = wrap_label_lines(content, font, w) if element.get("wrap") else content.splitlines()
            align = element.get("align", "left")
            line_height = max(1, round(font_size * spacing))
            valign = element.get("verticalAlign", "top")
            start_y = (h - len(lines) * line_height) * (0.5 if valign == "middle" else 1 if valign == "bottom" else 0)
            ascent, descent = font.getmetrics()
            for line_number, line in enumerate(lines):
                line_y = start_y + line_number * line_height
                if line_y >= h:
                    break
                if line_y + line_height <= 0:
                    continue
                line = clip_label_line(line, font, w, "..." if role == "title" and not element.get("fitToWidth") else "")
                line_width = painter.textlength(line, font=font)
                line_x = max(
                    0,
                    round(
                        (w - line_width)
                        * (0.5 if align == "center" else 1 if align == "right" else 0)
                    ),
                )
                painter.text(
                    (line_x, line_y + (line_height - ascent - descent) / 2 + ascent),
                    line,
                    font=font,
                    fill=_color(element.get("color", "#000000")),
                    anchor="ls",
                )
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
                    picture = ImageOps.contain(
                        picture,
                        (w, logo_height),
                        Image.Resampling.LANCZOS,
                    )
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
