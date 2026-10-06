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


def test_v1_header_uses_full_width_regardless_of_qr_side():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 40, "height": 30, "marginMm": 1},
        "logo": {"show": False},
        "title": {"template": "A FULL WIDTH HEADER", "sizeMm": 3, "dividerBelow": False},
        "info": {"show": False},
        "qr": {"sizeMm": 14, "position": "right"},
    }
    right = render_basic_label(_spool(), 320, 240, "http://test/spools/7", [], settings, thermal=True)
    settings["qr"]["position"] = "left"
    left = render_basic_label(_spool(), 320, 240, "http://test/spools/7", [], settings, thermal=True)
    assert right.crop((0, 0, 320, 40)).tobytes() == left.crop((0, 0, 320, 40)).tobytes()
    assert ImageChops.invert(right.crop((0, 0, 320, 40))).getbbox()[2] > 220


@pytest.mark.parametrize("position", ["left", "right"])
@pytest.mark.parametrize("vertical", ["top", "center", "bottom"])
def test_v1_qr_matches_saved_alignment(position, vertical):
    from app.services.label_basic_renderer import render_basic_label, render_qr_image

    settings = {
        "label": {"width": 40, "height": 30, "marginMm": 1},
        **{key: {"show": False} for key in ("logo", "title", "title2", "info", "info2")},
        "qr": {"sizeMm": 14, "position": position, "vAlign": vertical},
    }
    target = "http://test/spools/7"
    actual = render_basic_label(_spool(), 320, 240, target, [], settings, thermal=True)
    expected = Image.new("RGB", (320, 240), "white")
    # With no information columns the editor anchors the QR at the opposite
    # end of its slot sequence: right mode starts at the left margin.
    x = 8 if position == "right" else 200
    y = {"top": 8, "center": 64, "bottom": 120}[vertical]
    expected.paste(render_qr_image(target, 112, thermal=True), (x, y))
    assert ImageChops.difference(actual, expected).getbbox() is None


def test_v1_information_columns_wrap_and_align_independently():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 40, "height": 30, "marginMm": 1},
        **{key: {"show": False} for key in ("logo", "title", "title2", "qr")},
        "info": {"template": "AAAA BBBB CCCC DDDD", "sizeMm": 3, "vAlign": "top"},
        "info2": {"show": True, "template": "BOTTOM", "sizeMm": 3, "vAlign": "bottom", "vsep": True},
    }
    image = ImageChops.invert(render_basic_label(_spool(), 320, 240, "http://test", [], settings))
    left = image.crop((8, 8, 145, 232)).getbbox()
    right = image.crop((175, 8, 312, 232)).getbbox()
    assert left and left[3] > 40  # Multiple lines, not a single shrunken line.
    assert right and right[1] > 180
    assert image.getpixel((159, 100)) == (255, 255, 255)  # Vertical separator.


def test_v1_tall_title_keeps_first_line_and_clips_to_label():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 40, "marginMm": 0},
        **{key: {"show": False} for key in ("logo", "title2", "info", "info2", "qr")},
        "title": {"template": "HEADER", "sizeMm": 3, "dividerBelow": False},
    }
    first_line = render_basic_label(_spool(), 320, 80, "http://test", [], settings)
    settings["title"]["template"] += "\nZ" * 3000
    tall = render_basic_label(_spool(), 320, 80, "http://test", [], settings)
    assert tall.crop((0, 0, 320, 24)).tobytes() == first_line.crop((0, 0, 320, 24)).tobytes()


def test_v1_long_unbroken_info_is_clipped_before_glyph_allocation():
    from app.services.label_basic_renderer import render_basic_label

    settings = {
        "label": {"width": 20, "height": 20, "marginMm": 0},
        **{key: {"show": False} for key in ("logo", "title", "title2", "info2", "qr")},
        "info": {"template": "W" * 8000, "sizeMm": 10},
    }
    image = render_basic_label(_spool(), 1024, 1024, "http://test", [], settings)
    assert image.size == (1024, 1024)
    assert ImageChops.invert(image).getbbox() is not None


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
    assert image.getpixel((80, 5)) == (0, 0, 0)


@pytest.mark.parametrize("size", [(1, 1000), (1000, 1)])
def test_v1_thin_logo_keeps_at_least_one_pixel(size):
    from app.services.label_basic_renderer import render_basic_label

    content = BytesIO()
    Image.new("RGBA", size, "black").save(content, format="PNG")
    settings = {
        "label": {"width": 40, "marginMm": 1},
        "logo": {"spaceMm": 5},
        **{key: {"show": False} for key in ("title", "title2", "info", "info2", "qr")},
    }
    image = render_basic_label(_spool(), 320, 240, "http://test", [], settings, logo_content=content.getvalue())
    assert image.size == (320, 240)
    assert ImageChops.invert(image).getbbox() is not None


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


@pytest.mark.parametrize("width,height,settings", [
    (320, 80, {"label": {"width": 40, "height": 10, "marginMm": 6}, "qr": {"sizeMm": 18}}),
    (160, 320, {"label": {"width": 20, "height": 40, "marginMm": 0}, "qr": {"sizeMm": 30}}),
])
def test_v1_thermal_qr_rejects_missing_or_clipped_box(width, height, settings):
    from app.services.label_basic_renderer import render_basic_label

    settings.update({key: {"show": False} for key in ("logo", "title", "title2", "info", "info2")})
    # PNG retains the best-effort legacy layout; thermal output must not silently omit/clip its QR.
    assert render_basic_label(_spool(), width, height, "http://test/spools/7", [], settings).size == (width, height)
    with pytest.raises(HTTPException) as rejected:
        render_basic_label(_spool(), width, height, "http://test/spools/7", [], settings, thermal=True)
    assert rejected.value.status_code == 422


def test_extreme_geometry_is_handled_without_float_overflow():
    from app.services.label_basic_renderer import render_basic_label
    from app.services.label_v2_renderer import render_v2_label

    settings = {"label": {"width": 10**400}, "qr": {"show": False}}
    assert render_basic_label(_spool(), 480, 320, "http://test", [], settings).size == (480, 320)
    design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30},
              "elements": [{"type": "qr", "x": 1, "y": 1, "w": 10**400, "h": 10}]}
    with pytest.raises(HTTPException) as rejected:
        render_v2_label(design, 320, {"id": "7"}, [], "http://test", None, {}, False, thermal=True)
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
    actual_ink = ImageChops.invert(image)
    expected_ink = ImageChops.invert(expected)
    assert actual_ink.crop(actual_ink.getbbox()).tobytes() == expected_ink.crop(expected_ink.getbbox()).tobytes()


@pytest.mark.parametrize("template,values,expected", [
    ("{Lot: {external_id}}", {"external_id": ""}, ""),
    ("[if={external_id}]Lot: {external_id}[/if]", {"external_id": ""}, ""),
    ("^^{filament.name}^^", {"filament.name": "Grün"}, "GRÜN"),
    ("[b]{created_at|date}[/b]", {"created_at": "2026-09-07T14:30:00Z"}, "09/07/26"),
])
def test_v1_resolves_template_semantics_like_v2(template, values, expected):
    from app.services.label_basic_renderer import render_basic_label

    settings = {"label": {"width": 40, "height": 30, "marginMm": 1},
                **{key: {"show": False} for key in ("logo", "title", "title2", "info2", "qr")},
                "info": {"template": template, "sizeMm": 3}}
    actual = render_basic_label(_spool(), 400, 300, "http://test", [], settings, values)
    settings["info"]["template"] = expected
    reference = render_basic_label(_spool(), 400, 300, "http://test", [], settings)
    assert ImageChops.difference(actual, reference).getbbox() is None
