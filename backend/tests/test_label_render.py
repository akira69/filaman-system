import struct
import hashlib
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
import qrcode
from PIL import Image, ImageStat
from sqlalchemy import select

from app.api.v1.labels import _label_values, _mono1, _resolve_label_text
from app.main import app
from app.services import label_v2_renderer
from app.core.security import generate_token_secret, hash_token
from app.models import (
    Color,
    Device,
    Filament,
    FilamentColor,
    LabelPreset,
    LabelAsset,
    LabelPrintRequest,
    Manufacturer,
    Spool,
    SpoolStatus,
    UserApiKey,
)
from app.models.label_preset import label_preset_name_key


def test_mono1_pads_partial_row_with_white():
    image = Image.new("RGB", (9, 1), "white")
    image.putpixel((0, 0), (0, 0, 0))
    assert _mono1(image) == b"\x80\x00"


def test_render_openapi_describes_binary_responses():
    content = app.openapi()["paths"]["/api/v1/labels/spool/{spool_id}/render"]["get"]["responses"]["200"]["content"]
    assert set(content) == {"image/png", "application/octet-stream"}


def test_v2_optional_template_tokens_omit_missing_fields():
    assert label_v2_renderer.resolve_v2_text(
        "{filament.type}{ {filament.subtype}} {{filament.color}} {{missing}}",
        {"filament.type": "PLA", "filament.subtype": "Silk", "filament.color": "White"},
    ) == "PLA Silk White "
    assert label_v2_renderer.resolve_v2_text(
        "**{filament.type}** =={filament.type}== __{filament.type}__",
        {"filament.type": "PLA"},
    ) == "PLA PLA PLA"


def test_v2_qr_url_keeps_spool_route():
    assert label_v2_renderer.v2_qr_target(
        {"linkMode": "url", "urlTemplate": "https://labels.example/base/"},
        "https://filaman.example/spools/7", "7",
    ) == "https://labels.example/base/spools/7"


def test_saved_preset_tokens_resolve_for_scale():
    filament = SimpleNamespace(
        id=9, designation="Pearl", material_type="PLA", material_subgroup="Silk",
        manufacturer_color_name="White", raw_material_weight_g=1000,
        manufacturer_id=2, manufacturer=SimpleNamespace(name="Maker"),
        diameter_mm=1.75, custom_fields={"settings_bed_temp": 60},
    )
    spool = SimpleNamespace(
        id=7, filament_id=9, filament=filament, stocked_in_at=datetime(2026, 9, 1),
        custom_fields={"dry": "yes"}, remaining_weight_g=850,
    )
    values = _label_values(spool, ["#FFFFFF"])
    assert _resolve_label_text(
        "**{filament.type} {filament.subtype}** {filament.color_hex} "
        "{filament.weight} {extra.filament.settings_bed_temp} "
        "{extra.spool.dry} {stocked_in_at} {missing}", values,
    ) == "PLA Silk #FFFFFF 1000 60 yes 2026-09-01 "


@pytest.mark.asyncio
async def test_spool_label_render_formats(auth_client, db_session):
    client, _ = auth_client
    manufacturer = Manufacturer(name="Test Labels")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Bright PLA",
        material_type="PLA",
        diameter_mm=1.75,
    )
    db_session.add(filament)
    await db_session.flush()
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament_id=filament.id, status_id=status.id)
    db_session.add(spool)
    await db_session.commit()

    path = f"/api/v1/labels/spool/{spool.id}/render?width=480"
    png = await client.get(path + "&format=png")
    mono = await client.get(path + "&format=mono1")

    assert png.status_code == mono.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png.content[16:24]) == (480, 320)
    assert mono.headers["content-type"] == "application/octet-stream"
    assert mono.headers["x-image-width"] == "480"
    assert mono.headers["x-image-height"] == "320"
    assert mono.headers["x-row-bytes"] == "60"
    assert mono.headers["x-bit-order"] == "msb-black-1"
    assert len(mono.content) == 60 * 320
    assert any(mono.content)

    assert (await client.get(path.replace(str(spool.id), "999999") + "&format=png")).status_code == 404
    assert (await client.get(path + "&format=mono1&width=99999")).status_code == 422


@pytest.mark.asyncio
async def test_spool_label_render_requires_auth(client):
    response = await client.get("/api/v1/labels/spool/1/render?format=mono1&width=576")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_scale_device_needs_spool_read_scope(client, db_session):
    secret = generate_token_secret()
    device = Device(name="Scale", device_type="scale", token_hash=hash_token(secret), scopes=[])
    db_session.add(device)
    await db_session.commit()
    headers = {"Authorization": f"Device dev.{device.id}.{secret}"}
    path = "/api/v1/labels/spool/999/render?format=mono1&width=576"

    assert (await client.get(path, headers=headers)).status_code == 403
    device.scopes = ["spools:read"]
    await db_session.commit()
    from app.core.middleware import invalidate_auth_caches
    invalidate_auth_caches()
    assert (await client.get(path, headers=headers)).status_code == 404
    assert (await client.get("/api/v1/labels/presets", headers=headers)).status_code == 403


@pytest.mark.asyncio
async def test_pc_print_request_is_claimed_once(auth_client, db_session):
    client, csrf_token = auth_client
    manufacturer = Manufacturer(name="PC Print")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Print Me",
        material_type="PETG",
        diameter_mm=1.75,
    )
    db_session.add(filament)
    await db_session.flush()
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament_id=filament.id, status_id=status.id)
    db_session.add(spool)
    await db_session.commit()

    pending_path = "/api/v1/labels/print-requests/pending"
    assert (await client.get(pending_path)).json() is None
    response = await client.post(
        f"/api/v1/labels/spool/{spool.id}/print-request",
        headers={"X-CSRF-Token": csrf_token},
    )
    assert response.status_code == 201
    request_id = response.json()["id"]
    assert (await client.get(pending_path)).json() == {"id": request_id, "spool_id": spool.id, "preset_id": None}

    claim_path = f"/api/v1/labels/print-requests/{request_id}/claim"
    assert (await client.post(claim_path, headers={"X-CSRF-Token": csrf_token})).status_code == 204
    assert (await client.post(claim_path, headers={"X-CSRF-Token": csrf_token})).status_code == 409
    assert (await client.get(pending_path)).json() is None

    claimed_request = await db_session.get(LabelPrintRequest, request_id)
    expired = LabelPrintRequest(
        spool_id=spool.id,
        user_id=claimed_request.user_id,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=6),
    )
    db_session.add(expired)
    await db_session.commit()
    assert (await client.post(
        f"/api/v1/labels/print-requests/{expired.id}/claim",
        headers={"X-CSRF-Token": csrf_token},
    )).status_code == 409


@pytest.mark.asyncio
async def test_scale_lists_users_designer_presets_and_selects_one(
    auth_client, db_session, admin_user, normal_user, monkeypatch
):
    client, csrf_token = auth_client
    manufacturer = Manufacturer(name="Preset Labels")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Preset PLA",
        material_type="PLA",
        diameter_mm=1.75,
    )
    db_session.add(filament)
    await db_session.flush()
    color = Color(name="Red", hex_code="#FF0000")
    db_session.add(color)
    await db_session.flush()
    db_session.add(FilamentColor(filament_id=filament.id, color_id=color.id, position=1))
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament_id=filament.id, status_id=status.id)
    db_session.add(spool)
    preset = LabelPreset(
        user_id=admin_user.id,
        preset_type="spool",
        name="Small",
        name_key=label_preset_name_key("Small"),
        data={"settings": {
            "label": {"width": 50, "height": 25},
            "title": {"template": "{filament.name}"},
            "info": {"template": "{filament.type}\\n{color_swatch[8]}"},
            "qr": {"linkMode": "url", "urlTemplate": "https://labels.example/base/"},
        }},
    )
    db_session.add(preset)
    await db_session.commit()

    presets = await client.get("/api/v1/labels/presets")
    assert presets.status_code == 200
    assert presets.json() == [{"id": preset.id, "name": "Small"}]
    secret = generate_token_secret()
    api_key = UserApiKey(user_id=admin_user.id, name="Scale", key_hash=hash_token(secret), scopes=["spools:read"])
    db_session.add(api_key)
    await db_session.commit()
    headers = {"Authorization": f"ApiKey uak.{api_key.id}.{secret}"}
    assert (await client.get("/api/v1/labels/presets", headers=headers)).json() == presets.json()
    print_request = await client.post(
        f"/api/v1/labels/spool/{spool.id}/print-request?preset_id={preset.id}",
        headers={**headers, "X-CSRF-Token": csrf_token},
    )
    assert print_request.status_code == 201
    assert print_request.json()["preset_id"] == preset.id
    assert (await client.get("/api/v1/labels/print-requests/pending")).json()["preset_id"] == preset.id
    qr_targets = []
    original_qr_make = qrcode.make

    def capture_qr(target):
        qr_targets.append(target)
        return original_qr_make(target)

    monkeypatch.setattr(qrcode, "make", capture_qr)
    rendered = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=png&width=500&preset_id={preset.id}"
    )
    assert rendered.status_code == 200
    assert qr_targets[-1] == f"https://labels.example/base/spools/{spool.id}"
    assert struct.unpack(">II", rendered.content[16:24]) == (500, 250)
    physical = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=mono1&width=576&dpi=203&align=right&preset_id={preset.id}"
    )
    assert physical.status_code == 200
    assert physical.headers["x-image-height"] == "200"  # 25 mm at 203 DPI
    assert physical.headers["x-content-width"] == "400"
    assert physical.headers["x-rotated"] == "0"
    assert len(physical.content) == 72 * 200
    assert all(physical.content[row * 72:(row * 72) + 22] == bytes(22) for row in range(200))
    assert any(physical.content)
    portrait = LabelPreset(
        user_id=admin_user.id, preset_type="spool", name="Portrait",
        name_key=label_preset_name_key("Portrait"),
        data={"settings": {"label": {"width": 30, "height": 40}}},
    )
    db_session.add(portrait)
    await db_session.commit()
    rotated = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=mono1&width=576&dpi=203&align=right&orientation=landscape&preset_id={portrait.id}"
    )
    assert rotated.status_code == 200
    assert rotated.headers["x-image-height"] == "240"
    assert rotated.headers["x-content-width"] == "320"
    assert rotated.headers["x-rotated"] == "1"
    assert len(rotated.content) == 72 * 240
    assert any(rotated.content)
    assert all(rotated.content[row * 72:(row * 72) + 32] == bytes(32) for row in range(240))
    colored = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=png&width=500&preset_id={preset.id}&color=color",
        headers=headers,
    )
    assert colored.status_code == 200
    mono_mean = ImageStat.Stat(Image.open(BytesIO(rendered.content)).convert("RGB")).mean
    color_mean = ImageStat.Stat(Image.open(BytesIO(colored.content)).convert("RGB")).mean
    assert mono_mean[0] == mono_mean[1] == mono_mean[2]
    assert color_mean[0] > color_mean[1]
    assert (await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=mono1&color=color",
        headers=headers,
    )).status_code == 422
    assert (await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=png&preset_id=999999"
    )).status_code == 404
    other_secret = generate_token_secret()
    other_key = UserApiKey(user_id=normal_user.id, name="Other scale", key_hash=hash_token(other_secret), scopes=["spools:read"])
    db_session.add(other_key)
    await db_session.commit()
    client.cookies.clear()
    other_headers = {"Authorization": f"ApiKey uak.{other_key.id}.{other_secret}"}
    assert (await client.get("/api/v1/labels/print-requests/pending", headers=other_headers)).json() is None
    assert (await client.get(f"/api/v1/labels/spool/{spool.id}/render?preset_id={preset.id}", headers=other_headers)).status_code == 404


@pytest.mark.asyncio
async def test_scale_renders_version_two_designer_preset(auth_client, db_session, admin_user):
    client, _ = auth_client
    manufacturer = Manufacturer(name="V2 Labels")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="PLA for V2",
        material_type="PLA",
        diameter_mm=1.75,
    )
    db_session.add(filament)
    await db_session.flush()
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament_id=filament.id, status_id=status.id)
    db_session.add(spool)
    preset = LabelPreset(
        user_id=admin_user.id, preset_type="spool", name="V2 layout",
        name_key=label_preset_name_key("V2 layout"),
        data={"version": 2, "design": {
            "version": 2,
            "label": {"widthMm": 40, "heightMm": 30, "marginMm": 0, "border": False},
            "elements": [
                {"id": "band", "type": "shape", "x": 1, "y": 1, "w": 38, "h": 5,
                 "z": 0, "shape": "rectangle", "fill": "#000000", "stroke": "",
                 "strokeWidthMm": 0, "radiusMm": 0},
                {"id": "name", "type": "text", "x": 1, "y": 8, "w": 28, "h": 6,
                 "z": 1, "template": "{filament.name}\n{filament.type}", "fontFamily": "Roboto Condensed",
                 "fontSizeMm": 3, "fontWeight": 400, "italic": False,
                 "underline": False, "align": "left", "color": "#000000", "wrap": False,
                 "fitToWidth": True},
            ],
        }},
    )
    db_session.add(preset)
    await db_session.commit()

    response = await client.get(
        f"/api/v1/labels/spool/{spool.id}/render?format=png&width=576&dpi=203"
        f"&align=right&preset_id={preset.id}"
    )
    assert response.status_code == 200
    assert response.headers["x-content-width"] == "320"
    image = Image.open(BytesIO(response.content)).convert("RGB")
    assert image.size == (576, 240)
    assert image.getpixel((268, 16)) == (0, 0, 0)
    assert image.getpixel((10, 16)) == (255, 255, 255)
    assert min(image.getpixel((x, y))[0] for y in range(64, 112) for x in range(264, 450)) < 128

    clipped = dict(preset.data["design"]["elements"][0], x=-2)
    preset.data = {"version": 2, "design": {**preset.data["design"], "elements": [clipped]}}
    await db_session.commit()
    clipped_response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?width=576&dpi=203&align=right&preset_id={preset.id}")
    assert clipped_response.status_code == 200
    assert Image.open(BytesIO(clipped_response.content)).convert("RGB").getpixel((260, 16)) == (0, 0, 0)

    invalid = dict(preset.data["design"]["elements"][0], fill="not-a-color")
    preset.data = {"version": 2, "design": {**preset.data["design"], "elements": [invalid]}}
    await db_session.commit()
    bad_response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?width=576&preset_id={preset.id}")
    assert bad_response.status_code == 422


@pytest.mark.asyncio
async def test_scale_renders_version_two_uploaded_image(auth_client, db_session, admin_user):
    client, _ = auth_client
    manufacturer = Manufacturer(name="Image Labels")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(manufacturer_id=manufacturer.id, designation="PLA", material_type="PLA", diameter_mm=1.75)
    db_session.add(filament)
    await db_session.flush()
    status = await db_session.scalar(select(SpoolStatus).where(SpoolStatus.key == "active"))
    spool = Spool(filament_id=filament.id, status_id=status.id)
    db_session.add(spool)
    source = BytesIO()
    Image.new("RGB", (8, 8), "black").save(source, format="PNG")
    content = source.getvalue()
    asset_id = "12345678-1234-1234-1234-123456789abc"
    db_session.add(LabelAsset(
        id=asset_id, user_id=admin_user.id, display_name="Black.png",
        sha256=hashlib.sha256(content).hexdigest(), media_type="image/png",
        width=8, height=8, byte_size=len(content), content=content,
    ))
    preset = LabelPreset(
        user_id=admin_user.id, preset_type="spool", name="Image V2",
        name_key=label_preset_name_key("Image V2"), data={"version": 2, "design": {
            "version": 2, "label": {"widthMm": 40, "heightMm": 30},
            "elements": [{"id": "image", "type": "image", "x": 0, "y": 0, "w": 10, "h": 10,
                          "z": 0, "assetId": asset_id, "objectFit": "contain"}],
        }},
    )
    db_session.add(preset)
    await db_session.commit()

    response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?width=400&preset_id={preset.id}")
    assert response.status_code == 200
    assert Image.open(BytesIO(response.content)).convert("RGB").getpixel((50, 50)) == (0, 0, 0)

    cropped = dict(preset.data["design"]["elements"][0], crop={"x": 0, "y": 0, "w": 0.01, "h": 0.01})
    preset.data = {"version": 2, "design": {**preset.data["design"], "elements": [cropped]}}
    await db_session.commit()
    crop_response = await client.get(f"/api/v1/labels/spool/{spool.id}/render?width=400&preset_id={preset.id}")
    assert crop_response.status_code == 200
    assert Image.open(BytesIO(crop_response.content)).convert("RGB").getpixel((50, 50)) == (0, 0, 0)

    preset.data = {"version": 2, "design": {**preset.data["design"], "elements": [
        {**preset.data["design"]["elements"][0], "assetId": "missing"},
    ]}}
    await db_session.commit()
    missing = await client.get(f"/api/v1/labels/spool/{spool.id}/render?width=400&preset_id={preset.id}")
    assert missing.status_code == 422
