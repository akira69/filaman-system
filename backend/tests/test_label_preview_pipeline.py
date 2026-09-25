from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from app.api.v1 import labels
from app.models import (
    Filament,
    LabelAsset,
    LabelPreset,
    Manufacturer,
    Spool,
    SpoolStatus,
)
from app.models.label_preset import label_preset_name_key
from PIL import Image
from sqlalchemy import select


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
    assert payload["pixelRatio"] == pytest.approx(320 / (40 * 96 / 25.4))
    image = Image.open(BytesIO(response.content))
    assert image.size == (384, 80)
    assert image.getpixel((20, 20)) == (255, 0, 0)
    assert image.getpixel((383, 20)) == (255, 255, 255)


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
