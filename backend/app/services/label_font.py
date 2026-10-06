"""Bundled Latin-1-capable font for browserless labels."""

from pathlib import Path

from PIL import ImageFont


def label_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    weight = "Bold" if bold else "Regular"
    path = Path(__file__).resolve().parents[1] / "assets/fonts" / f"SpaceGrotesk-{weight}.ttf"
    return ImageFont.truetype(str(path), size=size)
