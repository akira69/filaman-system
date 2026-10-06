"""Small fixed-layout renderer for browserless label installations."""

import re
from io import BytesIO
from math import isfinite
from urllib.parse import urlsplit

import qrcode
from fastapi import HTTPException
from PIL import Image, ImageDraw
from qrcode.exceptions import DataOverflowError

from app.models import Spool
from app.services.label_font import label_font
from app.services.label_text import (
    clip_label_line,
    resolve_label_text,
    wrap_label_lines,
)
from app.utils.colors import visible_rgb_hex

_MAX_QR_CONTENT = 2048


def label_qr_target(
    link_mode: object,
    template: str,
    fallback: str,
    spool_id: str,
) -> str:
    if link_mode == "url":
        try:
            candidate = urlsplit(template)
            if candidate.scheme in {"http", "https"} and candidate.hostname:
                host = candidate.netloc.rsplit("@", 1)[-1]
                return f"{candidate.scheme}://{host}{candidate.path.rstrip('/')}/spools/{spool_id}"
        except ValueError:
            pass
    return fallback


def render_qr_image(target: str, size: int, mode: str = "RGB", thermal: bool = False) -> Image.Image:
    if len(target) > _MAX_QR_CONTENT:
        raise HTTPException(422, "QR content is too long")
    try:
        if thermal:
            qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
            qr.add_data(target)
            qr.make(fit=True)
            qr.box_size = size // (qr.modules_count + 8)
            if qr.box_size < 1:
                raise HTTPException(422, "QR box is too small for whole modules and a quiet zone")
            code = qr.make_image().convert(mode)
            image = Image.new(mode, (size, size), "white")
            padding = (size - code.width) // 2
            image.paste(code, (padding, padding))
            return image
        return qrcode.make(target).convert(mode).resize(
            (size, size), Image.Resampling.NEAREST
        )
    except (DataOverflowError, ValueError) as exc:
        raise HTTPException(422, "QR content is too long") from exc


def _number(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return min(high, max(low, number)) if isfinite(number) else default


def label_swatch_colors(colors: list[str]) -> list[str]:
    valid_colors = []
    for color in colors:
        try:
            valid_colors.append(visible_rgb_hex(color))
        except ValueError:
            pass
    return valid_colors


def render_basic_label(
    spool: Spool,
    label_width: int,
    label_height: int,
    qr_url: str,
    colors: list[str],
    settings: dict | None = None,
    values: dict[str, str] | None = None,
    logo_content: bytes | None = None,
    colored: bool = False,
    thermal: bool = False,
) -> Image.Image:
    filament = spool.filament
    display_values = [
        filament.manufacturer.name,
        filament.designation,
        filament.material_type,
        filament.manufacturer_color_name or "",
    ]
    display_text = "".join(display_values)
    if any(
        ord(character) < 32 or 127 <= ord(character) < 160 for character in display_text
    ):
        raise HTTPException(422, "Basic labels support printable text only")

    colors = label_swatch_colors(colors)

    image = Image.new("RGB", (label_width, label_height), "white")
    draw = ImageDraw.Draw(image)

    if settings is not None:
        label = settings.get("label") or {}
        width_mm = _number(label.get("width"), 60, 20, 300)
        margin = max(
            0, round(label_width * _number(label.get("marginMm"), 1, 0, 6) / width_mm)
        )
        if label.get("border") and 2 * margin < min(label_width, label_height):
            draw.rectangle(
                (margin, margin, label_width - margin - 1, label_height - margin - 1),
                outline="black",
                width=2,
            )
        scale = label_width / width_mm
        inset = margin + (round(0.6 * scale) if label.get("border") else 0)
        qr_config = settings.get("qr") or {}
        qr_show = qr_config.get("show", True) is not False
        qr_size = (
            min(
                round(
                    scale * _number(qr_config.get("sizeMm"), 18, 8, 40)
                ),
                max(label_width, label_height),
            )
            if qr_show
            else 0
        )
        qr_left = qr_config.get("position") == "left"
        if thermal and qr_show and not (0 < qr_size <= min(label_width, label_height) - 2 * inset):
            raise HTTPException(422, "Thermal QR box must fit inside the label")
        text_x = inset
        text_width = max(1, label_width - inset * 2)
        token_values = values or {}

        def resolved(template: str) -> str:
            return resolve_label_text(template, token_values, preserve_swatches=True)

        def section(
            config: dict, default: str, fallback_mm: float, bold: bool = False,
            box_height: int | None = None,
        ) -> None:
            nonlocal y
            if config.get("show", True) is False:
                return
            template = str(config.get("template", default))[:8000]
            size = max(
                1,
                round(
                    label_width
                    * _number(config.get("sizeMm"), fallback_mm, 1, 20)
                    / width_mm
                ),
            )
            content = resolved(template)
            if not content.strip() or text_width <= 0:
                return
            font = label_font(size, bold)
            lines = []
            for raw_line in content.splitlines():
                swatch = "{color_swatch" in raw_line
                text = re.sub(r"\{color_swatch(?:\[\d+\])?\}", "", raw_line).strip()
                if box_height is not None:  # Legacy information wraps at words.
                    wrapped = wrap_label_lines(text, font, text_width) or [""]
                    lines.extend((line, False) for line in wrapped[:-1])
                    lines.append((wrapped[-1], swatch))
                else:
                    lines.append((text, swatch))
            if box_height is None and config.get("fitToWidth", True):
                while size > 2 and any(draw.textlength(line, font=font) > text_width for line, _ in lines):
                    size -= 1
                    font = label_font(size, bold)
            line_height = max(1, round(size * (1.4 if box_height is not None else 1)))
            content_height = len(lines) * line_height
            height = max(1, box_height if box_height is not None else min(label_height, content_height))
            layer = Image.new("RGB", (text_width, height), "white")
            painter = ImageDraw.Draw(layer)
            align = config.get("align", config.get("hAlign", "left"))
            factor = 0.5 if align == "center" else 1 if align == "right" else 0
            valign = config.get("vAlign", "bottom")
            line_y = (height - content_height) * (0.5 if valign == "center" else 1 if valign == "bottom" else 0) if box_height is not None else 0
            ascent, descent = font.getmetrics()
            for text, swatch in lines:
                if line_y >= height:
                    break
                if line_y + line_height <= 0:
                    line_y += line_height
                    continue
                text = clip_label_line(text, font, text_width, "..." if box_height is None else "")
                offset = max(0, round((text_width - painter.textlength(text, font=font)) * factor))
                painter.text((offset, line_y + (line_height - ascent - descent) / 2 + ascent),
                             text, fill="black", font=font, anchor="ls")
                if swatch and colors:
                    segment = max(1, min(text_width, label_width // 4) // len(colors))
                    for index, hex_code in enumerate(colors):
                        painter.rectangle((index * segment, line_y + line_height // 2,
                                           (index + 1) * segment - 1, line_y + line_height - 1),
                                          fill=hex_code if colored else "black")
                line_y += line_height
            if box_height is None:
                row_margin = round(_number(config.get("marginMm"), 0, -1, 4) * scale)
                if config.get("dividerAbove"):
                    divider()
                y += row_margin
                image.paste(layer, (text_x, y))
                y += content_height + row_margin
                if config.get("dividerBelow"):
                    divider()
            else:
                image.paste(layer, (text_x, y))

        def divider():
            nonlocal y
            thickness = max(1, round(scale * 25.4 / 96))
            draw.rectangle((inset, y, label_width - inset - 1, y + thickness - 1), fill="black")
            y += thickness

        y = inset
        logo_config = settings.get("logo") or {}
        if logo_config.get("show", True) and logo_content is not None:
            try:
                with Image.open(BytesIO(logo_content)) as source:
                    logo = source.convert("RGBA")
                    slot_height = max(1, round(_number(logo_config.get("spaceMm"), 6, 2, 20) * scale))
                    logo_height = slot_height if logo_config.get("scaleToFit", True) else min(
                        slot_height, max(1, round(_number(logo_config.get("manualSizeMm"), 6, 2, 20) * scale))
                    )
                    ratio = min(text_width / logo.width, logo_height / logo.height)
                    logo = logo.resize((max(1, round(logo.width * ratio)), max(1, round(logo.height * ratio))),
                                       Image.Resampling.LANCZOS)
                align = logo_config.get("align", "left")
                offset = (
                    (text_width - logo.width) // (2 if align == "center" else 1)
                    if align in {"center", "right"}
                    else 0
                )
                image.paste(logo, (text_x + offset, y + (slot_height - logo.height) // 2), logo)
                y += slot_height + round(0.5 * scale)
            except OSError:
                section({"template": "{filament.manufacturer}", "sizeMm": 3}, "", 3)
        section({"dividerBelow": True, **(settings.get("title") or {})}, "{filament.name}", 4, True)
        section(settings.get("title2") or {"show": False}, "", 3.5, True)
        info = settings.get("info") or {}
        info2 = settings.get("info2") or {"show": False}
        info_template = "{filament.type}\n{filament.color}\nDiameter: {filament.diameter} mm"
        has_info = info.get("show", True) is not False and bool(str(info.get("template", info_template)).strip())
        has_info2 = info2.get("show", False) is not False
        separator = has_info2 and info2.get("vsep", False)
        y = min(label_height - inset - round(3 * scale),
                y + round(_number(info.get("marginMm"), 0, -1, 4) * scale))
        remaining_height = max(1, label_height - inset - y)
        slots = (["info"] if has_info else []) + (["separator"] if separator else []) + (["info2"] if has_info2 else []) + (["qr"] if qr_show else [])
        gap = round(1.5 * scale)
        separator_width = max(1, round(scale * 25.4 / 96))
        info_count = int(has_info) + int(has_info2)
        info_width = max(0, (label_width - 2 * inset - qr_size - (separator_width if separator else 0)
                             - max(0, len(slots) - 1) * gap) // max(1, info_count))
        cursor = label_width - inset if qr_left else inset
        qr_x = inset
        for slot in slots:
            slot_width = qr_size if slot == "qr" else separator_width if slot == "separator" else info_width
            if qr_left:
                cursor -= slot_width
            text_x, text_width = cursor, slot_width
            if slot == "qr":
                qr_x = cursor
            elif slot == "separator":
                draw.rectangle((cursor, y, cursor + slot_width - 1, y + remaining_height - 1), fill="black")
            else:
                section(info if slot == "info" else info2, info_template if slot == "info" else "", 2.5,
                        box_height=remaining_height)
            cursor += -gap if qr_left else slot_width + gap
        if qr_show and qr_size > 0:
            target = label_qr_target(
                qr_config.get("linkMode"),
                resolved(str(qr_config.get("urlTemplate", ""))).strip(),
                qr_url,
                str(spool.id),
            )
            qr = render_qr_image(target, qr_size, thermal=thermal)
            valign = qr_config.get("vAlign", "bottom")
            qr_y = y + round((remaining_height - qr_size) * (0 if valign == "top" else 0.5 if valign == "center" else 1))
            if thermal and (qr_x < 0 or qr_y < 0 or qr_x + qr_size > label_width or qr_y + qr_size > label_height):
                raise HTTPException(422, "Thermal QR box must fit inside the label")
            image.paste(qr, (qr_x, qr_y))
        return image if colored else image.convert("L").convert("RGB")

    margin = max(4, label_width // 40)
    qr_size = label_height // 2
    text_width = label_width - qr_size - margin * 3

    def line(value: str, y: int, size: int) -> int:
        size = max(8, size)
        font = label_font(size)
        while size > 8 and draw.textlength(value, font=font) > text_width:
            size -= 1
            font = label_font(size)
        if draw.textlength(value, font=font) > text_width:
            while value and draw.textlength(value + "...", font=font) > text_width:
                value = value[:-1]
            value += "..."
        draw.text((margin, y), value, fill="black", font=font)
        return y + size + max(2, label_width // 120)

    y = margin
    y = line(display_values[0], y, label_width // 20)
    y = line(display_values[1], y, label_width // 16)
    y = line(display_values[2], y, label_width // 22)
    if display_values[3]:
        y = line(display_values[3], y, label_width // 24)
    if spool.remaining_weight_g is not None:
        y = line(f"{round(spool.remaining_weight_g)} g remaining", y, label_width // 26)
    if colors:
        swatch_width = min(text_width, label_width // 4)
        segment = max(1, swatch_width // len(colors))
        for index, hex_code in enumerate(colors):
            draw.rectangle(
                (
                    margin + index * segment,
                    y,
                    margin + (index + 1) * segment - 1,
                    y + max(8, label_width // 50),
                ),
                fill=hex_code,
            )

    footer_y = label_height - margin * 3
    draw.line((margin, footer_y, label_width - margin, footer_y), fill="black", width=2)
    draw.text(
        (margin, footer_y + margin),
        f"Spool #{spool.id}",
        fill="black",
        font=label_font(max(8, label_width // 35)),
    )
    qr = render_qr_image(qr_url, qr_size, thermal=thermal)
    image.paste(qr, (label_width - qr_size - margin, margin))
    return image
