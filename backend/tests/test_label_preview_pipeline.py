import json
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from PIL import Image, ImageChops, ImageDraw
from sqlalchemy import select

from app.api.v1 import labels
from app.models import (
    Filament,
    LabelAsset,
    LabelPreset,
    Manufacturer,
    Spool,
    SpoolStatus,
    SystemExtraField,
)
from app.models.label_preset import label_preset_name_key


@pytest.fixture(autouse=True)
def chromium_renderer(monkeypatch):
    monkeypatch.setattr(labels.app_settings, "label_renderer", "chromium")


@pytest_asyncio.fixture
async def preview_spool(db_session, admin_user):
    manufacturer = Manufacturer(name="Shared preview")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(manufacturer_id=manufacturer.id, designation="Preview PLA", material_type="PLA", diameter_mm=1.75, raw_material_weight_g=1000, custom_fields={"nozzle": {"min": 190, "max": 220}})
    db_session.add(filament)
    await db_session.flush()
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament=filament, status=status, initial_total_weight_g=1200, remaining_weight_g=850)
    db_session.add(spool)
    preset = LabelPreset(user_id=admin_user.id, preset_type="spool", name="Shared", name_key=label_preset_name_key("Shared"), data={"version": 2, "design": {"version": 2, "label": {"widthMm": 40, "heightMm": 10, "marginMm": 6, "border": False}, "elements": [{"id": "text", "type": "text", "x": 0, "y": 0, "w": 40, "h": 10, "template": "{filament.raw_material_weight_g}"}]}})
    db_session.add(preset)
    await db_session.commit()
    return spool, preset


@pytest.mark.asyncio
async def test_saved_null_preset_is_invalid_not_default(auth_client, preview_spool, db_session):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = None
    await db_session.commit()
    listing = await client.get("/api/v1/labels/presets")
    assert listing.status_code == 200
    assert listing.json()[0]["width_mm"] is None
    assert listing.json()[0]["height_mm"] is None
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&renderer=basic")
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
@pytest.mark.parametrize("renderer", ["basic", "chromium"])
@pytest.mark.parametrize("orientation,base", [("original", "http://test"), ("portrait", "https://labels.example/" + "long/" * 16)])
async def test_thermal_qr_final_raster_has_whole_modules(auth_client, preview_spool, db_session, renderer, orientation, base):
    import qrcode

    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        "version": 2, "label": {"widthMm": 40, "heightMm": 30},
        "elements": [{"id": "qr", "type": "qr", "x": 2.13, "y": 3.17, "w": 14.83, "h": 14.83,
                      "mode": "logo", "linkMode": "url", "urlTemplate": base}],
    }}
    await db_session.commit()
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&renderer={renderer}&format=mono1&dpi=203&width=385&align=right&orientation={orientation}")
    assert response.status_code == 200, response.text
    lighter = await client.get(str(response.request.url) + "&threshold=128")
    assert lighter.status_code == 200
    assert lighter.content == response.content  # QR dots are binary, not antialiased gray.
    height = int(response.headers["x-image-height"])
    # Invert wire bits: Pillow's one-bit representation uses white=1.
    image = Image.frombytes("1", (385, height), response.content.translate(bytes(range(255, -1, -1)))).convert("L")
    content_width = int(response.headers["x-content-width"])
    image = image.crop((385-content_width, 0, 385, height))
    if orientation == "portrait":
        image = image.transpose(Image.Transpose.ROTATE_270)
    assert image.size == (320, 240)
    black = image.point(lambda p: 255-p)
    left, top, right, bottom = black.getbbox()
    reference = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M)
    reference.add_data(base.rstrip("/") + f"/spools/{spool.id}")
    reference.make(fit=True)
    modules = reference.modules_count
    pitch = (right-left) // modules
    assert pitch >= 1
    assert right-left == bottom-top == modules*pitch
    # Every module is a solid pitch-by-pitch square, never a fractional rescale.
    for y in range(modules):
        for x in range(modules):
            assert image.crop((left+x*pitch, top+y*pitch, left+(x+1)*pitch, top+(y+1)*pitch)).getextrema() in ((0, 0), (255, 255))
    for box in ((left-4*pitch, top-4*pitch, right+4*pitch, top),
                (left-4*pitch, bottom, right+4*pitch, bottom+4*pitch),
                (left-4*pitch, top, left, bottom), (right, top, right+4*pitch, bottom)):
        assert image.crop(box).getextrema() == (255, 255)


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
@pytest.mark.parametrize("renderer", ["basic", "chromium"])
async def test_thermal_qr_rejects_too_small_box_but_png_keeps_original(auth_client, preview_spool, db_session, renderer):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        "version": 2, "label": {"widthMm": 40, "heightMm": 30},
        "elements": [{"id": "qr", "type": "qr", "x": 2, "y": 3, "w": 3, "h": 3, "mode": "logo"}],
    }}
    await db_session.commit()
    path = f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&renderer={renderer}&dpi=203"
    assert (await client.get(path + "&format=mono1")).status_code == 422
    first = await client.get(path + "&threshold=1")
    second = await client.get(path + "&threshold=255")
    assert first.status_code == second.status_code == 200
    assert first.content == second.content


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
async def test_chromium_png_preserves_automatic_white_outline_outside_qr(auth_client, preview_spool, db_session):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        "version": 2, "label": {"widthMm": 40, "heightMm": 30},
        "elements": [
            {"id": "qr", "type": "qr", "x": 5, "y": 5, "w": 15, "h": 15, "z": 0, "mode": "simple"},
            {"id": "background", "type": "shape", "shape": "rectangle", "x": 0, "y": 0,
             "w": 40, "h": 30, "z": 10, "fill": "#000000", "stroke": "", "strokeWidthMm": 0},
        ],
    }}
    await db_session.commit()
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&renderer=chromium&dpi=203&format=png")
    assert response.status_code == 200
    image = Image.open(BytesIO(response.content)).convert("RGB")
    assert image.getpixel((32, 80)) == (255, 255, 255)
    assert image.getpixel((16, 80)) == (0, 0, 0)


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
@pytest.mark.parametrize("renderer", ["basic", "chromium"])
async def test_thermal_qr_white_space_covers_other_layers(auth_client, preview_spool, db_session, renderer):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        "version": 2, "label": {"widthMm": 40, "heightMm": 30},
        "elements": [
            {"id": "qr", "type": "qr", "x": 2, "y": 3, "w": 15, "h": 15, "z": 0},
            {"id": "over", "type": "shape", "shape": "rectangle", "x": 2.2, "y": 3.2,
             "w": 1, "h": 1, "z": 10, "fill": "#000000", "stroke": "", "strokeWidthMm": 0},
        ],
    }}
    await db_session.commit()
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&renderer={renderer}&dpi=203&format=mono1")
    assert response.status_code == 200
    image = Image.frombytes("1", (576, 240), response.content.translate(bytes(range(255, -1, -1))))
    assert image.getpixel((20, 28)) == 255
    assert image.crop((16, 24, 136, 144)).getextrema() == (0, 255)


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
@pytest.mark.parametrize("renderer", ["basic", "chromium"])
@pytest.mark.parametrize("kind", ["default", "v1-left", "v1-right", "v1-columns", "v1-wrap", "v2"])
async def test_thermal_label_sample_matrix(auth_client, preview_spool, db_session, monkeypatch, tmp_path, renderer, kind):
    client, _ = auth_client
    spool, preset = preview_spool
    manufacturer_id = spool.filament.manufacturer_id
    spool.filament.designation = "Grün üöäßéè"
    from app.services.label_font import label_font

    logo = Image.new("RGBA", (280, 40), (0, 0, 0, 0))
    ImageDraw.Draw(logo).text((0, 0), "TEST FILAMENT", font=label_font(32, True), fill="black")
    logo.save(tmp_path / f"{manufacturer_id}_label.png")
    monkeypatch.setattr(labels, "MANUFACTURER_LOGO_DIR", tmp_path)
    if kind.startswith("v1"):
        preset.data = {"settings": {
            "label": {"width": 40, "height": 30, "marginMm": 1},
            "logo": {"show": True, "spaceMm": 5},
            "title": {"template": "{filament.name}", "sizeMm": 3},
            "info": {"template": "ID: {id}\nHinzugefügt éè\n850 g", "sizeMm": 2},
            "qr": {"sizeMm": 14, "position": "left" if kind == "v1-left" else "right", "mode": "logo"},
        }}
        if kind == "v1-columns":
            preset.data["settings"]["info"] = {"template": "ID: {id}\nPLA", "sizeMm": 1.8, "vAlign": "top"}
            preset.data["settings"]["info2"] = {"show": True, "template": "850 g\nGrün", "sizeMm": 1.8, "vAlign": "bottom", "vsep": True}
            preset.data["settings"]["qr"].update(sizeMm=10, vAlign="center")
        elif kind == "v1-wrap":
            preset.data["settings"]["info"] = {"template": "Farbe: Grün matt\nHinzugefügt am 06.10.2026", "sizeMm": 2, "vAlign": "top"}
            preset.data["settings"]["qr"]["vAlign"] = "top"
    else:
        preset.data = {"version": 2, "design": {
            "version": 2, "label": {"widthMm": 40, "heightMm": 30},
            "elements": [
                {"id": "logo", "type": "manufacturerLogo", "x": 2, "y": 0, "w": 30, "h": 5},
                {"id": "text", "type": "text", "x": 2, "y": 5, "w": 36, "h": 5,
                 "template": "{filament.name}", "fontSizeMm": 3, "fontWeight": 700},
                *[{"id": f"qr{i}", "type": "qr", "x": x, "y": 12, "w": 13.8, "h": 13.8,
                   "mode": "logo"} for i, x in enumerate((2, 22))],
            ],
        }}
    await db_session.commit()
    path = f"/api/v1/labels/spool/{spool.id}/render?preset_id={0 if kind == 'default' else preset.id}&renderer={renderer}&dpi=203&width=576"
    png = await client.get(path)
    mono = await client.get(path + "&format=mono1")
    light = await client.get(path + "&format=mono1&threshold=128")
    assert png.status_code == mono.status_code == light.status_code == 200
    assert png.headers["x-renderer"] == mono.headers["x-renderer"] == renderer
    assert mono.headers["x-content-width"] == ("480" if kind == "default" else "320")
    height = 320 if kind == "default" else 240
    assert mono.headers["x-image-height"] == str(height)
    assert len(mono.content) == 72 * height
    assert all(low & ~high == 0 for low, high in zip(light.content, mono.content))
    Image.open(BytesIO(png.content)).save(tmp_path / f"{kind}-{renderer}-png.png")
    image = Image.frombytes("1", (576, height), mono.content.translate(bytes(range(255, -1, -1))))
    image.save(tmp_path / f"{kind}-{renderer}-mono1.png")
    (tmp_path / f"{kind}-{renderer}-mono1.bin").write_bytes(mono.content)
    (tmp_path / f"{kind}-{renderer}-headers.json").write_text(json.dumps(dict(mono.headers), indent=2))
    if kind.startswith("v1"):
        box = (8, 80, 120, 232) if kind == "v1-left" else (232, 80, 312, 232) if kind == "v1-columns" else (200, 80, 312, 232)
        slot = image.crop(box).convert("L")
        left, top, right, bottom = ImageChops.invert(slot).getbbox()
        pitch = 2 if kind == "v1-columns" else 3
        assert right - left == bottom - top == 25 * pitch
        assert min(left, top, slot.width - right, slot.height - bottom) >= 4 * pitch
        for row in range(25):
            for column in range(25):
                assert slot.crop((left + column * pitch, top + row * pitch,
                                  left + (column + 1) * pitch, top + (row + 1) * pitch)).getextrema() in ((0, 0), (255, 255))
        light_image = Image.frombytes("1", (576, height), light.content.translate(bytes(range(255, -1, -1))))
        assert light_image.crop(box).tobytes() == image.crop(box).tobytes()
    if kind == "v2":
        # Fractional DOM slots may center a dot differently; the modules and
        # minimum quiet zone must remain identical, not the extra whitespace.
        codes = []
        for box in ((16, 96, 126, 206), (176, 96, 286, 206)):
            slot = image.crop(box).convert("L")
            left, top, right, bottom = ImageChops.invert(slot).getbbox()
            assert right-left == bottom-top == 75  # EC-M v2, 25 modules * 3 dots
            assert min(left, top, 110-right, 110-bottom) >= 12
            codes.append(slot.crop((left, top, right, bottom)).tobytes())
        assert codes[0] == codes[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [1, 2])
async def test_basic_range_tokens_use_system_definitions(auth_client, preview_spool, db_session, version):
    client, _ = auth_client
    spool, preset = preview_spool
    spool.filament.custom_fields = {"drying": {"min": 40, "max": 50}}
    spool.filament.custom_field_definitions = {
        "drying": {"field_type": "range", "config": {"unit": "wrong"}},
    }
    db_session.add(SystemExtraField(
        target_type="filament", key="drying", label="Drying", field_type="range",
        config={"unit": "°C", "decimal_places": 1},
    ))

    async def render(template):
        if version == 2:
            preset.data = {"version": 2, "design": {
                "version": 2, "label": {"widthMm": 40, "heightMm": 30},
                "elements": [{"type": "text", "x": 1, "y": 1, "w": 38, "h": 10, "template": template}],
            }}
        else:
            preset.data = {"settings": {
                "label": {"width": 40, "height": 30}, "title": {"template": template},
                **{key: {"show": False} for key in ("logo", "title2", "info", "info2", "qr")},
            }}
        await db_session.commit()
        response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id={preset.id}")
        assert response.status_code == 200
        return response.content

    actual = await render("Dry: {extra.filament.drying}")
    expected = await render("Dry: 40.0–50.0 °C")
    assert actual == expected


@pytest.mark.asyncio
async def test_render_uses_shared_preview_with_native_data(auth_client, preview_spool, monkeypatch):
    client, _ = auth_client
    spool, preset = preview_spool
    output = BytesIO()
    Image.new("RGB", (320, 80), "red").save(output, format="PNG")
    browser = AsyncMock(return_value=output.getvalue())
    monkeypatch.setattr(labels, "render_preview_png", browser, raising=False)
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&dpi=203&width=384&color=color")
    assert response.status_code == 200
    assert browser.call_count == 1
    payload = browser.call_args.args[0]
    assert payload["spool"]["initial_total_weight_g"] == 1200
    assert payload["spool"]["filament"]["raw_material_weight_g"] == 1000
    assert payload["spool"]["filament"]["custom_fields"]["nozzle"] == {"min": 190, "max": 220}
    assert payload["spool"]["status"]["label"]
    assert payload["preset"] == preset.data
    assert (payload["pixelWidth"], payload["pixelHeight"]) == (320, 80)
    assert "x-row-bytes" not in response.headers
    assert "x-bit-order" not in response.headers
    image = Image.open(BytesIO(response.content))
    assert image.size == (384, 80)
    assert image.getpixel((20, 20)) == (255, 0, 0)
    assert image.getpixel((383, 20)) == (255, 255, 255)


@pytest.mark.asyncio
async def test_dpi_converts_both_physical_dimensions_independently(
    auth_client, preview_spool, db_session, monkeypatch,
):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {
        "version": 2,
        "design": {
            **preset.data["design"],
            "label": {"widthMm": 20, "heightMm": 200},
        },
    }
    await db_session.commit()
    output = BytesIO()
    Image.new("RGB", (1, 1), "white").save(output, format="PNG")
    browser = AsyncMock(return_value=output.getvalue())
    monkeypatch.setattr(labels, "render_preview_png", browser)

    response = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render"
        f"?preset_id={preset.id}&dpi=203&width=576&format=mono1"
    )

    assert response.status_code == 200
    assert browser.call_args.args[0]["pixelWidth"] == 160
    assert browser.call_args.args[0]["pixelHeight"] == 1598
    assert response.headers["x-image-height"] == "1598"


@pytest.mark.asyncio
async def test_oversized_logo_is_rejected_before_browser_decode(auth_client, preview_spool, monkeypatch, tmp_path):
    import struct
    import zlib

    client, _ = auth_client
    spool, _preset = preview_spool
    # PNG IHDR declares 80MP; generating its pixels would defeat the memory test.
    output = BytesIO()
    Image.new("L", (1, 1)).save(output, format="PNG")
    content = bytearray(output.getvalue())
    content[16:24] = struct.pack(">II", 10000, 8000)
    content[29:33] = struct.pack(">I", zlib.crc32(content[12:29]))
    (tmp_path / f"{spool.filament.manufacturer_id}_label.png").write_bytes(content)
    monkeypatch.setattr(labels, "MANUFACTURER_LOGO_DIR", Path(tmp_path))
    browser = AsyncMock()
    monkeypatch.setattr(labels, "render_preview_png", browser, raising=False)
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id=0")
    assert response.status_code == 422
    browser.assert_not_called()


@pytest.mark.asyncio
async def test_repeated_images_share_the_render_pixel_budget(
    auth_client, preview_spool, db_session, admin_user, monkeypatch,
):
    client, _ = auth_client
    spool, preset = preview_spool
    output = BytesIO()
    Image.new("RGB", (1000, 1000), "black").save(output, format="PNG")
    content = output.getvalue()
    db_session.add(LabelAsset(
        id="repeated", user_id=admin_user.id, display_name="Repeated.png", sha256="a" * 64,
        media_type="image/png", width=1000, height=1000, byte_size=len(content), content=content,
    ))
    preset.data = {"version": 2, "design": {
        **preset.data["design"], "elements": [
            {"id": str(index), "type": "image", "assetId": "repeated", "x": index, "y": 0, "w": 1, "h": 1}
            for index in range(13)
        ],
    }}
    await db_session.commit()
    browser = AsyncMock(return_value=content)
    monkeypatch.setattr(labels, "render_preview_png", browser)
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}")
    assert response.status_code == 422
    assert "12 megapixel" in response.json()["detail"]
    browser.assert_not_called()
    basic = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id={preset.id}"
    )
    assert basic.status_code == 422
    assert "12 megapixel" in basic.json()["detail"]


@pytest.mark.asyncio
async def test_qr_canvases_share_the_render_pixel_budget(
    auth_client, preview_spool, db_session, monkeypatch,
):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        **preset.data["design"], "elements": [
            {"id": str(index), "type": "qr", "x": 0, "y": 0, "w": 10, "h": 10}
            for index in range(12)
        ],
    }}
    await db_session.commit()
    browser = AsyncMock()
    monkeypatch.setattr(labels, "render_preview_png", browser)
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}")
    assert response.status_code == 422
    assert "12 megapixel" in response.json()["detail"]
    browser.assert_not_called()


@pytest.mark.parametrize("width", [None, "", " "])
def test_legacy_empty_dimensions_match_preview_normalization(width):
    assert labels._label_size({"label": {"width": width, "height": 40}}) == (20, 40)
    assert labels._label_size({"label": {}}) == (60, 40)


@pytest.mark.asyncio
@pytest.mark.usefixtures("label_render_runtime")
async def test_maximum_height_capture_has_exact_pixels(auth_client, preview_spool, db_session):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        **preset.data["design"], "label": {"widthMm": 35, "heightMm": 70, "marginMm": 0, "border": False},
    }}
    await db_session.commit()
    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}&width=1024")
    assert response.status_code == 200, response.text
    assert Image.open(BytesIO(response.content)).size == (1024, 2048)


@pytest.mark.asyncio
@pytest.mark.parametrize("element_type", [[], {}])
async def test_unknown_unhashable_element_types_are_rejected(auth_client, preview_spool, db_session, monkeypatch, element_type):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"version": 2, "design": {
        **preset.data["design"], "elements": [*preset.data["design"]["elements"], {"type": element_type}],
    }}
    await db_session.commit()
    browser = AsyncMock()
    monkeypatch.setattr(labels, "render_preview_png", browser)
    response = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id={preset.id}"
    )
    assert response.status_code == 422
    browser.assert_not_called()


@pytest.mark.asyncio
async def test_basic_renderer_approximately_renders_saved_v2_presets(
    auth_client, preview_spool, db_session, monkeypatch,
):
    from fastapi import HTTPException

    client, _ = auth_client
    spool, preset = preview_spool
    preset.selected = True
    await db_session.commit()
    browser = AsyncMock(side_effect=HTTPException(503, "Chromium unavailable"))
    monkeypatch.setattr(labels, "render_preview_png", browser)

    default = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id=0&color=color"
    )
    assert default.status_code == 200
    assert default.headers["x-preset-id"] == "0"
    assert Image.open(BytesIO(default.content)).mode == "RGB"
    browser.assert_not_called()
    mono = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id=0"
        "&format=mono1&dpi=203&width=576&align=right&orientation=portrait"
    )
    assert mono.status_code == 200
    assert mono.headers["x-image-width"] == "576"
    assert mono.headers["x-image-height"] == "480"
    assert mono.headers["x-content-width"] == "320"
    assert mono.headers["x-row-bytes"] == "72"
    assert len(mono.content) == 72 * 480
    assert all(mono.content[row * 72:row * 72 + 32] == bytes(32) for row in range(480))

    for suffix in (f"renderer=basic&preset_id={preset.id}", "renderer=basic"):
        rendered = await client.get(f"/api/v1/labels/spool/{spool.id}/render?{suffix}")
        assert rendered.status_code == 200
        assert rendered.headers["x-preset-id"] == str(preset.id)
        assert Image.open(BytesIO(rendered.content)).size == (576, 144)
        browser.assert_not_called()

    monkeypatch.setattr(labels.app_settings, "label_renderer", "basic")
    configured = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?preset_id=0&color=color"
    )
    assert configured.status_code == 200
    overridden = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=chromium&preset_id=0"
    )
    assert overridden.status_code == 503
    assert "retry-after" not in overridden.headers
    assert (await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id=999999"
    )).status_code == 404
    assert (await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?renderer=basic&preset_id=0"
        "&format=mono1&color=color"
    )).status_code == 422
    assert preset.selected is True


@pytest.mark.asyncio
async def test_basic_renderer_approximately_renders_saved_legacy_presets(
    auth_client, preview_spool, db_session,
):
    client, _ = auth_client
    spool, preset = preview_spool
    preset.data = {"settings": {
        "label": {"width": 40, "height": 30, "marginMm": 0, "border": True},
        "logo": {"show": False},
        "title": {"show": True, "template": "{filament.name}"},
        "title2": {"show": False},
        "info": {"show": False},
        "info2": {"show": False},
        "qr": {"show": False},
    }}
    await db_session.commit()

    response = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render"
        f"?renderer=basic&preset_id={preset.id}&dpi=203&width=576&color=color"
    )

    assert response.status_code == 200
    assert response.headers["x-content-width"] == "320"
    assert response.headers["x-image-height"] == "240"
    assert Image.open(BytesIO(response.content)).convert("RGB").getpixel((0, 0)) == (0, 0, 0)
