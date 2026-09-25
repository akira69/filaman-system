"""Rasterize saved version 2 label geometry for the scale's image API."""

import re
from io import BytesIO
from math import ceil, floor, isfinite
from pathlib import Path
from urllib.parse import urlsplit

import qrcode
from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont, ImageMath, UnidentifiedImageError


def _mm(value: object, maximum: float) -> float:
    if not isinstance(value, (int, float)) or not isfinite(value) or not 0 <= value <= maximum:
        raise HTTPException(status_code=422, detail="Preset design has invalid geometry")
    return float(value)


def _position(value: object, element_size: float, label_size: float) -> float:
    if (not isinstance(value, (int, float)) or not isfinite(value)
            or not 0.1 - element_size <= value <= label_size - 0.1):
        raise HTTPException(status_code=422, detail="Preset design has invalid geometry")
    return float(value)


def _color(value: object, *, allow_empty: bool = False) -> str | None:
    if allow_empty and value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise HTTPException(status_code=422, detail="Preset design has an invalid color")
    return value


def resolve_v2_text(template: str, values: dict[str, str]) -> str:
    def replace_ranges(text, edits):
        parts, cursor = [], 0
        for start, end, replacement in sorted(edits, key=lambda edit: (edit[0], -edit[1])):
            if start >= cursor:
                parts.extend((text[cursor:start], replacement))
                cursor = end
        return "".join(parts) + text[cursor:]

    # Match templateFieldRanges: explicit conditions retain their named field;
    # legacy optional braces inherit the first nested field's condition.
    template = template.replace("\\n", "\n")
    stack, edits = [], []
    for match in re.finditer(r"\[if=\{([^{}\n]+)\}\]|\[/if\]|\{|\}", template, re.IGNORECASE):
        part = match.group()
        if part == "{" or match[1] is not None:
            stack.append((match.start(), match.end(), part != "{", match[1].strip() if match[1] is not None else None))
            continue
        if not stack or stack[-1][2] != (part != "}"):
            continue
        start, inner_start, explicit, condition = stack.pop()
        token = not explicit and condition is None
        key = condition if condition is not None else template[inner_start:match.start()].strip()
        value = values.get(key, "")
        if token or value in {"", "?"}:
            edits.append((start, match.end(), value if token and value != "?" else ""))
        else:
            edits.extend(((start, inner_start, ""), (match.start(), match.end(), "")))
        if stack and stack[-1][3] is None:
            stack[-1] = (*stack[-1][:3], key)
    expanded = replace_ranges(template, edits)
    expanded = re.sub(r"\^\^([\s\S]*?)\^\^", lambda match: match.group(1).upper(), expanded)

    # Preserve malformed tags just as templateMarkupMatches does in the browser.
    stack, edits = [], []
    tags = r"\[(?:(font)=[^\]\n]+|(size)=\d{1,3}%?|([bi]))\]|\[/(font|size|b|i)\]"
    for match in re.finditer(tags, expanded, re.IGNORECASE):
        if match[4]:
            opening = stack.pop() if stack else None
            if opening and opening[0] == match[4].lower():
                if opening[0] in {"b", "i"}:
                    edits.extend(((opening[1], opening[2], ""), (match.start(), match.end(), "")))
            else:
                stack.clear()
        else:
            stack.append(((match[1] or match[2] or match[3]).lower(), match.start(), match.end()))
    expanded = replace_ranges(expanded, edits)
    expanded = re.sub(r"\[/?size(?:=\d{1,3}%?)?\]", "", expanded, flags=re.IGNORECASE)
    return re.sub(r"\*{1,3}|==|__|@@", "", expanded)


def v2_qr_target(element: dict, fallback: str, spool_id: str) -> str:
    if element.get("linkMode") == "url":
        try:
            candidate = urlsplit(str(element.get("urlTemplate", "")))
            if candidate.scheme in {"http", "https"} and candidate.hostname:
                host = candidate.netloc.rsplit("@", 1)[-1]
                return f"{candidate.scheme}://{host}{candidate.path.rstrip('/')}/spools/{spool_id}"
        except ValueError:
            pass
    return fallback


def render_v2_label(
    design: dict, width: int, values: dict[str, str], colors: list[str],
    qr_url: str, logo_path: Path, assets: dict[str, bytes],
    colored: bool,
) -> Image.Image:
    label = design.get("label")
    elements = design.get("elements")
    if design.get("version") != 2 or not isinstance(label, dict) or not isinstance(elements, list) or len(elements) > 100:
        raise HTTPException(status_code=422, detail="Preset design is invalid")
    width_mm = _mm(label.get("widthMm"), 300)
    height_mm = _mm(label.get("heightMm"), 200)
    if width_mm < 20 or height_mm < 10:
        raise HTTPException(status_code=422, detail="Preset design has invalid dimensions")
    scale = width / width_mm
    height = round(height_mm * scale)
    if height > 2048:
        raise HTTPException(status_code=422, detail="Preset is too tall for the requested width")
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    if label.get("border"):
        inset = round(_mm(label.get("marginMm", 0), 6) * scale)
        draw.rectangle((inset, inset, width - inset - 1, height - inset - 1), outline="black", width=max(1, round(0.3 * scale)))

    if any(not isinstance(item, dict) or not isinstance(item.get("z", 0), int) for item in elements):
        raise HTTPException(status_code=422, detail="Preset design has an invalid element")
    for element in sorted(elements, key=lambda item: item.get("z", 0)):
        if not isinstance(element, dict) or element.get("type") not in {"text", "qr", "manufacturerLogo", "image", "swatch", "shape"}:
            raise HTTPException(status_code=422, detail="Preset design has an unsupported element")
        w_mm = _mm(element.get("w"), width_mm)
        h_mm = _mm(element.get("h"), height_mm)
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
                    radius = round(_mm(element.get("radiusMm", 0), min(width_mm, height_mm)) * scale)
                    painter.rounded_rectangle(box, radius=radius, fill=fill, outline=stroke, width=line_width)
            else:
                raise HTTPException(status_code=422, detail="Preset design has an unsupported shape")
        elif kind == "swatch":
            if colors:
                for index, color in enumerate(colors):
                    painter.rectangle((index * w // len(colors), 0, (index + 1) * w // len(colors), h), fill=color)
        elif kind == "text":
            content = resolve_v2_text(str(element.get("template", ""))[:8000], values)
            font_size = max(1, round(_mm(element.get("fontSizeMm", 3.2), 20) * scale))
            font = ImageFont.load_default(size=font_size)
            if element.get("fitToWidth"):
                while font_size > 2 and any(painter.textlength(line, font=font) > w for line in content.splitlines()):
                    font_size -= 1
                    font = ImageFont.load_default(size=font_size)
            align = element.get("align", "left")
            for line_number, line in enumerate(content.splitlines() or [""]):
                line_y = line_number * round(font_size * 1.15)
                if line_y >= h:
                    break
                line_width = painter.textlength(line, font=font)
                line_x = max(0, round((w - line_width) * (0.5 if align == "center" else 1 if align == "right" else 0)))
                painter.text((line_x, line_y), line, font=font, fill=_color(element.get("color", "#000000")))
        elif kind == "qr":
            target = v2_qr_target(element, qr_url, values["id"])
            qr = qrcode.make(target).convert("RGBA").resize((min(w, h), min(w, h)), Image.Resampling.NEAREST)
            layer.paste(qr, (0, 0))
        elif kind in {"manufacturerLogo", "image"}:
            source: bytes | Path | None = logo_path if kind == "manufacturerLogo" else assets.get(str(element.get("assetId", "")))
            if kind == "image" and source is None:
                raise HTTPException(status_code=422, detail="Preset image is unavailable")
            try:
                if source is not None:
                    if isinstance(source, Path) and source.stat().st_size > 2_000_000:
                        raise OSError("Logo is too large")
                    with Image.open(BytesIO(source) if isinstance(source, bytes) else source) as original:
                        if original.mode == "I;16":
                            samples = original.convert("I")
                            gray = samples.point(lambda sample: sample * (255 / 65535) + 0.5).convert("L")
                            gray.info.pop("transparency", None)
                            picture = gray.convert("RGBA")
                            if "transparency" in original.info:
                                alpha = ImageMath.lambda_eval(
                                    lambda images: (images["samples"] != original.info["transparency"]) * 255,
                                    samples=samples,
                                ).convert("L")
                                picture.putalpha(alpha)
                        else:
                            picture = original.convert("RGBA")
                    crop = element.get("crop")
                    if isinstance(crop, dict):
                        cx, cy, cw, ch = (_mm(crop.get(key), 1) for key in ("x", "y", "w", "h"))
                        if cw <= 0 or ch <= 0 or cx + cw > 1 or cy + ch > 1:
                            raise HTTPException(status_code=422, detail="Preset image crop is invalid")
                        left, top = floor(cx * picture.width), floor(cy * picture.height)
                        right = max(left + 1, ceil((cx + cw) * picture.width))
                        bottom = max(top + 1, ceil((cy + ch) * picture.height))
                        picture = picture.crop((left, top, right, bottom))
                    fit = min(w / picture.width, h / picture.height)
                    picture = picture.resize((max(1, round(picture.width * fit)), max(1, round(picture.height * fit))), Image.Resampling.LANCZOS)
                    layer.paste(picture, ((w - picture.width) // 2, (h - picture.height) // 2))
            except (OSError, UnidentifiedImageError):
                if kind == "image":
                    raise HTTPException(status_code=422, detail="Preset image is unavailable") from None
        image.paste(layer, (x, y), layer)
    return image if colored else image.convert("L").convert("RGB")
