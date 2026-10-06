from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image, ImageChops

from app.models import Filament, Manufacturer, Spool


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


def test_v1_logo_preserves_alpha_on_white():
    from app.services.label_basic_renderer import render_basic_label

    logo = Image.new("RGBA", (20, 10), (0, 0, 0, 0))
    logo.paste((0, 0, 0, 255), (10, 0, 20, 10))
    content = BytesIO()
    logo.save(content, format="PNG")
    settings = {
        "label": {"width": 40, "marginMm": 0},
        **{key: {"show": False} for key in ("title", "title2", "info", "info2", "qr")},
    }
    image = render_basic_label(_spool(), 400, 300, "http://test/spools/7", [], settings, logo_content=content.getvalue())
    assert image.getpixel((5, 5)) == (255, 255, 255)
    assert image.getpixel((20, 5)) == (0, 0, 0)


@pytest.mark.parametrize("preset", ["default", "v1", "v2"])
def test_accented_glyphs_are_distinct_in_every_basic_path(preset):
    from app.services.label_basic_renderer import render_basic_label
    from app.services.label_v2_renderer import render_v2_label

    images = []
    for letter in "üöäßéè□":
        if preset == "v2":
            design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [
                {"type": "text", "x": 0, "y": 0, "w": 30, "h": 20, "template": letter, "fontSizeMm": 3},
            ]}
            image = render_v2_label(design, 400, {}, [], "http://test", None, {}, False)
        else:
            settings = None if preset == "default" else {
                "label": {"width": 40}, "title": {"template": letter},
                **{key: {"show": False} for key in ("logo", "title2", "info", "info2", "qr")},
            }
            image = render_basic_label(_spool(designation=letter), 400, 300, "http://test", [], settings)
        images.append(image.tobytes())
    assert len(set(images)) == 7


def test_bundled_font_has_real_bold_weight():
    from app.services.label_font import label_font

    regular, bold = label_font(30), label_font(30, bold=True)
    assert regular.getname()[1] == "Regular"
    assert bold.getname()[1] == "Bold"
    assert bytes(regular.getmask("Müller")) != bytes(bold.getmask("Müller"))


def test_v2_numeric_font_weight_changes_rendered_text():
    from app.services.label_v2_renderer import render_v2_label

    element = {"type": "text", "x": 0, "y": 0, "w": 40, "h": 20, "template": "Müller", "fontWeight": 400}
    design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [element]}
    regular = render_v2_label(design, 400, {}, [], "http://test", None, {}, False)
    element["fontWeight"] = 700
    bold = render_v2_label(design, 400, {}, [], "http://test", None, {}, False)
    assert regular.tobytes() != bold.tobytes()


def test_thermal_qr_has_integer_modules_and_quiet_zone():
    from app.services.label_basic_renderer import render_qr_image

    # 19-byte URL uses EC-M version 2: 25 modules plus 8 quiet modules.
    image = render_qr_image("http://test/spools/7", 119, thermal=True).convert("L")
    # 3 dots/module; 99-dot QR centered with 10 dots of extra padding.
    assert image.size == (119, 119)
    assert image.crop((0, 0, 119, 22)).getextrema() == (255, 255)
    assert image.crop((0, 97, 119, 119)).getextrema() == (255, 255)
    assert image.crop((22, 22, 43, 25)).getextrema() == (0, 0)
    for y in range(25):
        for x in range(25):
            assert image.crop((22+x*3, 22+y*3, 25+x*3, 25+y*3)).getextrema() in ((0, 0), (255, 255))
    with pytest.raises(HTTPException) as rejected:
        render_qr_image("http://test/spools/7", 32, thermal=True)
    assert rejected.value.status_code == 422


def test_basic_label_has_fixed_fields_color_and_exact_qr():
    import qrcode

    from app.services.label_basic_renderer import render_basic_label

    width, height = 480, 320
    target = "http://test/spools/7"
    image = render_basic_label(_spool(), width, height, target, ["legacy", "#e02020", "#2040e0"])
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
        render_basic_label(without_remaining, width, height, target, ["legacy", "#e02020", "#2040e0"]),
    ).getbbox() is not None


def test_basic_label_fits_long_and_unicode_text():
    from app.services.label_basic_renderer import render_basic_label

    long = _spool(designation="Ä" * 1000)
    assert render_basic_label(long, 240, 160, "http://test/spools/7", []).size == (240, 160)
    long.filament.designation = "PLA 🚀"
    assert render_basic_label(long, 240, 160, "http://test/spools/7", []).size == (240, 160)
    long.filament.designation = "PLA\x01"
    with pytest.raises(HTTPException):
        render_basic_label(long, 240, 160, "http://test/spools/7", [])


def test_basic_label_png_round_trip_is_rgb():
    from app.services.label_basic_renderer import render_basic_label

    output = BytesIO()
    render_basic_label(_spool(), 480, 320, "http://test/spools/7", []).save(output, format="PNG")
    assert Image.open(BytesIO(output.getvalue())).mode == "RGB"


def test_basic_label_rejects_oversized_qr_content():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 40},
        "logo": {"show": False},
        "title": {"show": False},
        "title2": {"show": False},
        "info": {"show": False},
        "info2": {"show": False},
        "qr": {"linkMode": "url", "urlTemplate": "https://example.test/" + "x" * 5000},
    }

    with pytest.raises(HTTPException) as rejected:
        render_basic_label(
            _spool(), 240, 160, "http://test/spools/7", [], settings=settings
        )
    assert rejected.value.status_code == 422


def test_basic_short_label_omits_border_that_does_not_fit():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 40, "height": 10, "marginMm": 6, "border": True},
        **{key: {"show": False} for key in ("logo", "title", "title2", "info", "info2", "qr")},
    }
    image = render_basic_label(_spool(), 576, 144, "http://test/spools/7", [], settings=settings)
    assert image.size == (576, 144)
    assert image.getextrema() == ((255, 255),) * 3


@pytest.mark.parametrize("key, identifier", [
    ("external_id", "batch__04"),
    ("external_id", "*batch==04@@__*"),
    ("extra.spool.batch__id", "LOT-7"),
])
def test_basic_v1_preserves_literal_field_markup(key, identifier):
    from PIL import ImageDraw

    from app.services.label_basic_renderer import render_basic_label
    from app.services.label_font import label_font

    settings = {
        "label": {"width": 40, "marginMm": 0},
        **{key: {"show": False} for key in ("logo", "title", "title2", "info2", "qr")},
        "info": {"template": "**{" + key + "}**", "sizeMm": 3, "fitToWidth": False},
    }
    image = render_basic_label(
        _spool(), 400, 300, "http://test/spools/7", [], settings,
        {key: identifier, "extra.spool.batchid": "OTHER"},
    )
    expected = Image.new("RGB", (400, 300), "white")
    ImageDraw.Draw(expected).text(
        (4, 4), identifier, font=label_font(30), fill="black"
    )
    assert ImageChops.difference(image, expected).getbbox() is None
