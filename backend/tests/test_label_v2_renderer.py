from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from app.api.v1.labels import _label_values
from app.models import Color, Filament, FilamentColor, Manufacturer, Spool
from app.services.label_text import resolve_label_text
from app.services.label_v2_renderer import render_v2_label


def test_inline_swatch_runs_are_trusted_and_field_data_stays_literal():
    from app.services.label_text import resolve_label_runs
    assert resolve_label_runs("{COLOR-SWATCH[999]} {name}", {"name": "{color_swatch[8]}"}) == [40, " {color_swatch[8]}"]
    assert resolve_label_runs("{Missing: {missing}}[if={id}]{color_swatch[8]}[/if]", {"id": "7"}) == [8]


def test_inline_swatch_is_visible_and_native_long_words_wrap():
    from PIL import ImageChops
    design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [
        {"type": "text", "x": 0, "y": 0, "w": 38, "h": 5, "fontSizeMm": 3, "template": "{color_swatch[8]}"},
        {"type": "text", "x": 0, "y": 5, "w": 10, "h": 25, "fontSizeMm": 3, "wrap": True,
         "template": "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"},
    ]}
    image = render_v2_label(design, 400, {}, ["#FF0000"], "http://test", None, {}, True)
    assert image.getpixel((20, 15)) == (255, 0, 0)
    assert ImageChops.invert(image.crop((0, 100, 100, 280))).getbbox() is not None


@pytest.mark.parametrize("valign,factor", [("top", 1), ("center", 0.5), ("bottom", 0)])
def test_migrated_empty_rows_reflow_without_mutating_design(valign, factor):
    import copy

    from PIL import ImageChops

    from app.services.label_basic_renderer import render_qr_image
    from app.services.label_preset_v1 import convert_label_preset_data
    source = {"settings": {"title": {"template": "{missing}", "marginMm": 1},
        "qr": {"sizeMm": 10, "vAlign": valign}, "info": {"template": "INFO", "vAlign": "top"}}}
    design = convert_label_preset_data(source, "spool")["design"]
    before = copy.deepcopy(design)
    image = render_v2_label(design, 600, {"id": "7"}, [], "http://test", None, {}, False)
    assert design == before
    info = ImageChops.invert(image.crop((0, 0, 300, 400))).getbbox()
    assert info[1] < 40  # absent logo and title must not leave blank rows
    qr = next(e for e in design["elements"] if e["type"] == "qr")
    shift = design["elements"][0]["h"] + 0.5 + 4 + 2 + 25.4 / 96
    x, y = round(qr["x"] * 10), round((qr["y"] - shift * factor) * 10)
    expected = render_qr_image("http://test", 100)
    assert ImageChops.difference(image.crop((x, y, x + 100, y + 100)), expected).getbbox() is None


def test_typed_fields_keep_raw_dates_and_literal_modifier_keys():
    spool = Spool(id=7, filament=Filament(manufacturer=Manufacturer(name="Maker")))
    spool.custom_fields = {"tags": ["Dry", "Tested"], "temp": 215.0, "ready": True, "failed": False,
        "date": "2026-09-07T14:30:00Z", "date|date": "literal"}
    definitions = {"spool": {"tags": {"field_type": "multiselect"},
        "temp": {"field_type": "number", "config": {"unit": "°C", "decimal_places": 1}},
        "ready": {"field_type": "checkbox"}, "failed": {"field_type": "checkbox"},
        "date": {"field_type": "datetime"}}}
    values, raw = _label_values(spool, [], definitions)
    assert [values[f"extra.spool.{key}"] for key in ("tags", "temp", "ready", "failed", "date")] == [
        "Dry, Tested", "215.0 °C", "✓", "✗", "09/07/26, 14:30"]
    assert raw["extra.spool.date"] == "2026-09-07T14:30:00Z"
    assert resolve_label_text("{extra.spool.date|date}", values, raw_values=raw) == "literal"
    del values["extra.spool.date|date"]
    assert resolve_label_text("{extra.spool.date|date}", values, raw_values=raw) == "09/07/26"


@pytest.mark.parametrize("number,expected", [(1234567, "1234567"), (1.23456789, "1.23456789")])
def test_numeric_extra_fields_without_precision_preserve_value(number, expected):
    spool = Spool(id=7, filament=Filament(manufacturer=Manufacturer(name="Maker")))
    spool.custom_fields = {"measurement": number}
    definitions = {"spool": {"measurement": {"field_type": "number", "config": {"unit": "mm"}}}}
    values, raw = _label_values(spool, [], definitions)
    assert values["extra.spool.measurement"] == f"{expected} mm"
    assert raw["extra.spool.measurement"] == number


def test_fitted_title_reflows_but_native_title_does_not():
    from PIL import ImageChops
    for legacy in (False, True):
        title = {"type": "text", "x": 1, "y": 1, "w": 38, "h": 8, "fontSizeMm": 8,
                 "fitToWidth": True, "template": "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
        if legacy:
            title["legacyTextRole"] = "title"
        design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [title,
            {"type": "shape", "shape": "rectangle", "fill": "#FF0000", "x": 1, "y": 10, "w": 38, "h": 1}]}
        image = render_v2_label(design, 400, {}, [], "http://test", None, {}, True)
        bbox = ImageChops.subtract(image.getchannel("R"), image.getchannel("G")).getbbox()
        assert (bbox[1] < 100) if legacy else (bbox[1] == 100)
        assert ImageChops.invert(image).getbbox()


def test_checkbox_marks_are_not_the_fonts_missing_glyph():
    from PIL import ImageChops
    def raster(template):
        return render_v2_label({"version": 2, "label": {"widthMm": 20, "heightMm": 10}, "elements": [
            {"type": "text", "template": template, "x": 0, "y": 0, "w": 20, "h": 10, "fontSizeMm": 5}]},
            200, {}, [], "http://test", None, {}, False)
    assert ImageChops.difference(raster("✓"), raster("✗")).getbbox()
    assert ImageChops.difference(raster("✓"), raster("\uffff")).getbbox()


@pytest.mark.parametrize("size", [(20, 10), (1, 1000), (1000, 1)])
def test_converted_logo_preserves_alpha_and_thin_images(size):
    from io import BytesIO

    from PIL import Image, ImageChops

    from app.services.label_preset_v1 import convert_label_preset_data
    logo = Image.new("RGBA", size, (0, 0, 0, 0))
    logo.paste((0, 0, 0, 255), (size[0] // 2, 0, size[0], size[1]))
    output = BytesIO()
    logo.save(output, format="PNG")
    design = convert_label_preset_data({"settings": {"label": {"width": 40, "height": 30, "marginMm": 0},
        "logo": {"spaceMm": 6}, **{key: {"show": False} for key in ("title", "title2", "info", "info2", "qr")}}}, "spool")["design"]
    image = render_v2_label(design, 400, {}, [], "http://test", output.getvalue(), {}, False)
    assert image.size == (400, 300)
    assert ImageChops.invert(image).getbbox()
    if size == (20, 10):
        assert image.getpixel((5, 5)) == (255, 255, 255)
        assert image.getpixel((80, 5)) == (0, 0, 0)


def test_template_sentinel_is_not_a_protected_value():
    assert resolve_label_text("\0" + "0" + "\0", {}) == "�0�"


def test_template_budget_preserves_leading_fields():
    assert resolve_label_text("{id} {Notes: {notes}}", {"id": "7", "notes": "x" * 12000}).startswith("7 Notes: x")


def test_template_expansion_budget_is_applied_before_protection(monkeypatch):
    from app.services import label_text

    original_sub = label_text.re.sub
    protected_chars = 0

    def bounded_sub(pattern, replacement, text, *args, **kwargs):
        nonlocal protected_chars
        if callable(replacement) and replacement.__name__ == "keep":
            protected_chars += len(text)
            assert protected_chars <= 12000
        return original_sub(pattern, replacement, text, *args, **kwargs)

    monkeypatch.setattr(label_text.re, "sub", bounded_sub)
    assert resolve_label_text("[if={a}]" + "{Lot: {a}}" * 30 + "[/if]", {"a": "{" * 1000}).startswith("Lot: {")


@pytest.mark.parametrize("template,values", [("W" * 8000, {}), ("{external_id}", {"external_id": "W" * 20000})], ids=["literal", "expanded-field"])
def test_v2_clips_text_before_allocating_glyph_masks(monkeypatch, template, values):
    from PIL import Image, ImageChops

    fill = Image.core.fill

    def bounded_fill(mode, size, *args):
        assert size[0] * size[1] < 4_000_000, "unbounded glyph allocation"
        return fill(mode, size, *args)

    monkeypatch.setattr(Image.core, "fill", bounded_fill)
    design = {"version": 2, "label": {"widthMm": 20, "heightMm": 20}, "elements": [
        {"type": "text", "x": 0, "y": 0, "w": 20, "h": 20, "fontSizeMm": 20, "template": template},
    ]}
    image = render_v2_label(design, 1024, values, [], "http://test", None, {}, False)
    assert image.size == (1024, 1024)
    assert ImageChops.invert(image).getbbox() is not None


@pytest.mark.parametrize("alignment,left", [("left", 10), ("center", 160), ("right", 310)])
def test_v2_logo_honors_manual_size_and_alignment(alignment, left):
    from io import BytesIO

    from PIL import Image, ImageChops

    logo = BytesIO()
    Image.new("RGBA", (40, 10), "black").save(logo, format="PNG")
    design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [
        {"type": "manufacturerLogo", "x": 1, "y": 1, "w": 38, "h": 6, "manualSizeMm": 2, "align": alignment},
    ]}
    image = render_v2_label(design, 400, {}, [], "http://test", logo.getvalue(), {}, False)
    assert ImageChops.invert(image).getbbox() == (left, 30, left + 80, 50)


def test_v2_text_renders_explicit_conditions():
    assert resolve_label_text(
        "[if={id}]ID: {id}[/if] [if={missing}]missing[/if]",
        {"id": "7", "missing": ""},
    ) == "ID: 7 "


def test_v2_text_renders_date_modifier():
    assert resolve_label_text(
        "{stocked_in_at|date}",
        {"stocked_in_at": datetime(2026, 9, 7, 14, 30, tzinfo=UTC)},
    ) == "09/07/26"


def test_v2_text_prefers_a_literal_key_that_ends_with_date_modifier_syntax():
    assert resolve_label_text(
        "{extra.spool.inspection|date}",
        {"extra.spool.inspection|date": "Literal field value"},
    ) == "Literal field value"


def test_v2_text_does_not_treat_field_data_as_template_markup():
    assert resolve_label_text(
        "^^{external_id}^^",
        {"external_id": "batch__04"},
    ) == "BATCH__04"


@pytest.mark.parametrize("identifier", ["batch{A}", "batch{id}", "batch__{A}"])
def test_v2_optional_field_preserves_literal_braces(identifier):
    assert resolve_label_text(
        "{Lot: {external_id}}", {"external_id": identifier, "id": "7"}
    ) == f"Lot: {identifier}"


def test_v2_short_label_omits_border_that_does_not_fit():
    image = render_v2_label(
        {"version": 2, "label": {"widthMm": 40, "heightMm": 10, "marginMm": 6, "border": True}, "elements": []},
        576, {"id": "7"}, [], "http://test/spools/7", None, {}, False,
    )
    assert image.size == (576, 144)
    assert image.getextrema() == ((255, 255),) * 3


def test_v2_swatch_skips_legacy_colors_and_uses_visible_rgb():
    image = render_v2_label(
        {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [
            {"type": "swatch", "x": 0, "y": 0, "w": 40, "h": 30, "z": 0},
        ]},
        400, {"id": "7"}, ["legacy", "#FF000000", "#00FF00"], "http://test/spools/7", None, {}, True,
    )
    assert image.getpixel((100, 150)) == (255, 0, 0)
    assert image.getpixel((300, 150)) == (0, 255, 0)


def test_v2_text_strips_unsupported_rich_text_markup():
    assert resolve_label_text(
        "[b]**Bold**[/b] [i]*italic*[/i] [font=Fraunces]^^blue^^[/font] "
        "[size=120%]__under__[/size] ==inverse== @@color@@",
        {},
    ) == "Bold italic BLUE under inverse color"


def test_v2_text_receives_fields_used_by_shipped_spool_presets():
    spool = Spool(
        id=7,
        filament_id=3,
        status_id=1,
        stocked_in_at=datetime(2026, 9, 7, 14, 30, tzinfo=UTC),
        filament=Filament(
            id=3,
            manufacturer_id=2,
            manufacturer=Manufacturer(id=2, name="FilaWorks"),
            designation="Aurora",
            material_type="PLA",
            diameter_mm=1.75,
            custom_fields={
                "settings_extruder_temp": 215,
                "settings_bed_temp": 60,
                "storage": {"inspection": "2026-09-08T12:00:00Z"},
            },
        ),
    )

    assert resolve_label_text(
        "[if={stocked_in_at}]Stocked in:[/if] {stocked_in_at|date}",
        _label_values(spool, [])[0],
    ) == "Stocked in: 09/07/26"
    assert resolve_label_text(
        "{filament.extruder_temp}/{filament.bed_temp} "
        "{extra.filament.storage.inspection|date}",
        _label_values(spool, [])[0],
    ) == "215/60 09/08/26"


def test_label_values_use_linked_color_names_when_manufacturer_name_is_missing():
    filament = Filament(
        id=3,
        manufacturer_id=2,
        manufacturer=Manufacturer(id=2, name="FilaWorks"),
        designation="Aurora",
        material_type="PLA",
        diameter_mm=1.75,
        filament_colors=[
            FilamentColor(position=1, display_name_override="Ocean", color=Color(name="Blue", hex_code="#0000FF")),
            FilamentColor(position=2, color=Color(name="Green", hex_code="#00FF00")),
        ],
    )

    values, _ = _label_values(Spool(id=7, filament_id=3, filament=filament), [])

    assert values["filament.color"] == "Ocean"
    assert values["filament.colors"] == "Ocean, Green"


def test_v2_label_rejects_oversized_qr_content():
    design = {
        "version": 2,
        "label": {"widthMm": 40, "heightMm": 30},
        "elements": [{
            "type": "qr", "x": 1, "y": 1, "w": 20, "h": 20, "z": 0,
            "linkMode": "url", "urlTemplate": "https://example.test/" + "x" * 5000,
        }],
    }

    with pytest.raises(HTTPException) as rejected:
        render_v2_label(
            design, 400, {"id": "7"}, [], "http://test/spools/7", None, {}, False
        )
    assert rejected.value.status_code == 422


@pytest.mark.parametrize("level, expected", [
    ("spool", ("250", "80", "plastic")),
    ("filament", ("200", "60", "cardboard")),
    ("manufacturer", ("190", "55", "metal")),
])
def test_label_values_resolve_physical_spool_fields(level, expected):
    manufacturer = Manufacturer(name="Maker", spool_outer_diameter_mm=190, spool_width_mm=55, spool_material="metal")
    filament = Filament(manufacturer=manufacturer, designation="PLA", material_type="PLA", diameter_mm=1.75)
    spool = Spool(id=7, filament=filament)
    if level in {"spool", "filament"}:
        filament.spool_outer_diameter_mm, filament.spool_width_mm, filament.spool_material = 200, 60, "cardboard"
    if level == "spool":
        spool.spool_outer_diameter_mm, spool.spool_width_mm, spool.spool_material = 250, 80, "plastic"
    values, _ = _label_values(spool, [])
    assert tuple(values[f"filament.{key}"] for key in (
        "spool_outer_diameter_mm", "spool_width_mm", "spool_material",
    )) == expected


@pytest.mark.parametrize("raw, expected", [
    ({"min": 40, "max": 50}, "40.0–50.0 °C"),
    ({"min": 0}, "0.0– °C"),
    ({"max": 50}, "–50.0 °C"),
    (None, ""),
])
def test_label_values_preserve_defined_nested_ranges(raw, expected):
    filament = Filament(manufacturer=Manufacturer(name="Maker"), designation="PLA", material_type="PLA", diameter_mm=1.75)
    spool = Spool(id=7, filament=filament)
    for entity in (spool, filament):
        entity.custom_fields = {"drying": {"temperature": raw}, "other": {"min": 2}}
        entity.custom_field_definitions = {
            "drying.temperature": {"field_type": "range", "config": {"unit": "°C", "decimal_places": 1}},
        }
    values, _ = _label_values(spool, [])
    for source in ("spool", "filament"):
        assert values[f"extra.{source}.drying.temperature"] == expected
        assert values[f"extra.{source}.other.min"] == "2"


def test_v2_migrated_qr_is_clipped_to_short_label():
    from PIL import ImageChops

    from app.services.label_basic_renderer import render_qr_image

    design = {"version": 2, "label": {"widthMm": 60, "heightMm": 10}, "elements": [
        {"type": "qr", "x": 1, "y": -4, "w": 18, "h": 18, "z": 0, "legacyVAlign": "center"},
    ]}
    image = render_v2_label(design, 600, {"id": "7"}, [], "http://test/spools/7", None, {}, False)
    expected = render_qr_image("http://test/spools/7", 180).crop((0, 40, 180, 140))
    assert image.size == (600, 100)
    assert ImageChops.difference(image.crop((10, 0, 190, 100)), expected).getbbox() is None
    design["elements"][0].update(w=41, h=41)
    with pytest.raises(HTTPException) as rejected:
        render_v2_label(design, 600, {"id": "7"}, [], "http://test/spools/7", None, {}, False)
    assert rejected.value.status_code == 422


@pytest.mark.parametrize("thermal", [False, True])
def test_v2_qr_stays_opaque_above_overlapping_content(thermal):
    from PIL import ImageChops

    from app.services.label_basic_renderer import render_qr_image

    design = {"version": 2, "label": {"widthMm": 40, "heightMm": 30}, "elements": [
        {"type": "qr", "x": 1, "y": 1, "w": 20, "h": 20, "z": 0},
        {"type": "shape", "shape": "rectangle", "fill": "#000000", "x": 0, "y": 0, "w": 40, "h": 30, "z": 99},
    ]}
    image = render_v2_label(design, 400, {"id": "7"}, [], "http://test/spools/7", None, {}, False, thermal=thermal)
    expected = render_qr_image("http://test/spools/7", 200, thermal=thermal)
    assert ImageChops.difference(image.crop((10, 10, 210, 210)), expected).getbbox() is None


@pytest.mark.parametrize("box", [
    {"x": 0, "y": 0, "w": 0, "h": 40},
    {"x": 0, "y": 0, "w": 20, "h": 0},
    {"x": 20, "y": 40, "w": 0, "h": 0},
])
def test_v2_accepts_zero_sized_legacy_text_at_label_edges(box):
    design = {"version": 2, "label": {"widthMm": 20, "heightMm": 40}, "elements": [
        {"type": "text", "template": "{id}", "legacyTextRole": "info", **box},
        {"type": "qr", "x": 0, "y": 0, "w": 20, "h": 20, "z": 1},
    ]}
    image = render_v2_label(design, 400, {"id": "7"}, [], "http://test/spools/7", None, {}, False)
    assert image.size == (400, 800)
    assert image.crop((0, 0, 400, 400)).getextrema() == ((0, 255),) * 3
    design["elements"][0]["x"] = 21
    with pytest.raises(HTTPException) as rejected:
        render_v2_label(design, 400, {"id": "7"}, [], "http://test/spools/7", None, {}, False)
    assert rejected.value.status_code == 422
