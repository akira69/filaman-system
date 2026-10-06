"""Small fixed-layout renderer for browserless label installations."""

from urllib.parse import urlsplit

import qrcode
from fastapi import HTTPException
from PIL import Image, ImageDraw
from qrcode.exceptions import DataOverflowError

from app.models import Spool
from app.services.label_font import label_font
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
