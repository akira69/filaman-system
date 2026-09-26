from io import BytesIO

import pytest
from app.models import Filament, Manufacturer, Spool
from fastapi import HTTPException
from PIL import Image, ImageChops


def _spool(**filament_values):
    manufacturer = Manufacturer(name=filament_values.pop("manufacturer", "Müller"))
    filament = Filament(
        manufacturer=manufacturer,
        manufacturer_id=1,
        designation=filament_values.pop("designation", "Sehr langes glänzendes PLA"),
        material_type=filament_values.pop("material_type", "PLA"),
        diameter_mm=1.75,
        manufacturer_color_name=filament_values.pop("color_name", "Grün"),
        **filament_values,
    )
    return Spool(id=7, filament=filament, filament_id=1, status_id=1, remaining_weight_g=850)


def test_basic_label_has_fixed_fields_color_and_exact_qr():
    import qrcode
    from app.services.label_basic_renderer import render_basic_label

    width, height = 480, 320
    target = "http://test/spools/7"
    image = render_basic_label(_spool(), width, height, target, ["#e02020", "#2040e0"])
    assert image.mode == "RGB"
    assert image.size == (width, height)
    assert image.getbbox() == (0, 0, width, height)
    assert any(r > g * 1.5 for r, g, _b in image.getdata())
    assert any(b > r * 1.5 for r, _g, b in image.getdata())

    margin, qr_size = max(4, width // 40), height // 2
    actual = image.crop((width - qr_size - margin, margin, width - margin, margin + qr_size))
    expected = qrcode.make(target).convert("RGB").resize((qr_size, qr_size), Image.Resampling.NEAREST)
    assert ImageChops.difference(actual, expected).getbbox() is None

    without_remaining = _spool()
    without_remaining.remaining_weight_g = None
    assert ImageChops.difference(
        image,
        render_basic_label(without_remaining, width, height, target, ["#e02020", "#2040e0"]),
    ).getbbox() is not None


def test_basic_label_fits_long_text_and_rejects_non_latin1():
    from app.services.label_basic_renderer import render_basic_label

    long = _spool(designation="Ä" * 1000)
    assert render_basic_label(long, 240, 160, "http://test/spools/7", []).size == (240, 160)
    long.filament.designation = "PLA 🚀"
    with pytest.raises(HTTPException) as rejected:
        render_basic_label(long, 240, 160, "http://test/spools/7", [])
    assert rejected.value.status_code == 422
    assert "Latin-1" in rejected.value.detail
    long.filament.designation = "PLA\x01"
    with pytest.raises(HTTPException):
        render_basic_label(long, 240, 160, "http://test/spools/7", [])


def test_basic_label_png_round_trip_is_rgb():
    from app.services.label_basic_renderer import render_basic_label

    output = BytesIO()
    render_basic_label(_spool(), 480, 320, "http://test/spools/7", []).save(output, format="PNG")
    assert Image.open(BytesIO(output.getvalue())).mode == "RGB"
