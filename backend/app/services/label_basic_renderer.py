"""Small fixed-layout renderer for browserless label installations."""

import qrcode
from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont

from app.models import Spool
from app.utils.colors import visible_rgb_hex


def render_basic_label(
    spool: Spool,
    label_width: int,
    label_height: int,
    qr_url: str,
    colors: list[str],
) -> Image.Image:
    filament = spool.filament
    values = [
        filament.manufacturer.name,
        filament.designation,
        filament.material_type,
        filament.manufacturer_color_name or "",
    ]
    try:
        display_text = "".join(values)
        display_text.encode("latin-1")
    except UnicodeEncodeError as exc:
        raise HTTPException(422, "Basic labels support printable Latin-1 text only") from exc
    if any(ord(character) < 32 or 127 <= ord(character) < 160 for character in display_text):
        raise HTTPException(422, "Basic labels support printable Latin-1 text only")

    image = Image.new("RGB", (label_width, label_height), "white")
    draw = ImageDraw.Draw(image)
    margin = max(4, label_width // 40)
    qr_size = label_height // 2
    text_width = label_width - qr_size - margin * 3

    def line(value: str, y: int, size: int) -> int:
        size = max(8, size)
        font = ImageFont.load_default(size=size)
        while size > 8 and draw.textlength(value, font=font) > text_width:
            size -= 1
            font = ImageFont.load_default(size=size)
        if draw.textlength(value, font=font) > text_width:
            while value and draw.textlength(value + "...", font=font) > text_width:
                value = value[:-1]
            value += "..."
        draw.text((margin, y), value, fill="black", font=font)
        return y + size + max(2, label_width // 120)

    y = margin
    y = line(values[0], y, label_width // 20)
    y = line(values[1], y, label_width // 16)
    y = line(values[2], y, label_width // 22)
    if values[3]:
        y = line(values[3], y, label_width // 24)
    if spool.remaining_weight_g is not None:
        y = line(f"{round(spool.remaining_weight_g)} g remaining", y, label_width // 26)
    valid_colors = []
    for color in colors:
        try:
            valid_colors.append(visible_rgb_hex(color))
        except ValueError:
            pass
    if valid_colors:
        swatch_width = min(text_width, label_width // 4)
        segment = max(1, swatch_width // len(valid_colors))
        for index, hex_code in enumerate(valid_colors):
            draw.rectangle(
                (margin + index * segment, y, margin + (index + 1) * segment - 1,
                 y + max(8, label_width // 50)),
                fill=hex_code,
            )

    footer_y = label_height - margin * 3
    draw.line((margin, footer_y, label_width - margin, footer_y), fill="black", width=2)
    draw.text(
        (margin, footer_y + margin), f"Spool #{spool.id}", fill="black",
        font=ImageFont.load_default(size=max(8, label_width // 35)),
    )
    qr = qrcode.make(qr_url).convert("RGB").resize((qr_size, qr_size), Image.Resampling.NEAREST)
    image.paste(qr, (label_width - qr_size - margin, margin))
    return image
