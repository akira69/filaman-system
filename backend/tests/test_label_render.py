import struct
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
import qrcode
from PIL import Image, ImageStat
from sqlalchemy import select

from app.api.v1.labels import _label_values, _mono1, _resolve_label_text
from app.core.security import generate_token_secret, hash_token
from app.models import (
    Color,
    Device,
    Filament,
    FilamentColor,
    LabelPreset,
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
