from sqlalchemy import select

from app.models.filament import Filament, Manufacturer
from app.models.system_extra_field import SystemExtraField
from app.services.spoolman_import_repair_service import SpoolmanImportRepairService


async def _legacy_filament(db_session, custom_fields):
    manufacturer = Manufacturer(name="Repair Test")
    db_session.add(manufacturer)
    await db_session.flush()
    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Legacy PLA",
        material_type="PLA",
        diameter_mm=1.75,
        custom_fields=custom_fields,
    )
    db_session.add(filament)
    await db_session.commit()
    return filament


async def test_offline_preview_is_non_mutating(db_session):
    filament = await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "spoolman_extra": {"pressure_advance": "0.025", "dry": "true"},
        },
    )
    service = SpoolmanImportRepairService(db_session)

    preview = await service.preview("offline")

    assert preview["summary"] == {
        "records_scanned": 1,
        "fields_found": 2,
        "promotable": 2,
        "collisions": 0,
        "invalid": 0,
        "unresolved": 0,
    }
    assert {item["field_type"] for item in preview["mappings"]} == {
        "number",
        "checkbox",
    }
    await db_session.refresh(filament)
    assert filament.custom_fields == {
        "spoolman_id": 12,
        "spoolman_extra": {"pressure_advance": "0.025", "dry": "true"},
    }


async def test_offline_execute_promotes_only_approved_values(db_session):
    filament = await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "spoolman_extra": {"pressure_advance": "0.025", "notes": "keep me"},
        },
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    approved = [
        item for item in preview["mappings"] if item["key"] == "pressure_advance"
    ]

    result = await service.execute(
        "offline",
        preview["preview_fingerprint"],
        approved,
    )

    assert result["definitions_created"] == 1
    assert result["records_updated"] == 1
    assert result["values_promoted"] == 1
    await db_session.refresh(filament)
    assert filament.custom_fields == {
        "spoolman_id": 12,
        "pressure_advance": 0.025,
        "spoolman_extra": {"notes": "keep me"},
    }
    definition = await db_session.scalar(
        select(SystemExtraField).where(SystemExtraField.key == "pressure_advance")
    )
    assert definition is not None
    assert definition.field_type == "number"
    assert definition.source is None


async def test_repair_never_overwrites_top_level_value(db_session):
    filament = await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "pressure_advance": 0.04,
            "spoolman_extra": {"pressure_advance": "0.025"},
        },
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    assert preview["summary"]["collisions"] == 1

    result = await service.execute(
        "offline",
        preview["preview_fingerprint"],
        preview["mappings"],
    )

    assert result["values_promoted"] == 0
    await db_session.refresh(filament)
    assert filament.custom_fields["pressure_advance"] == 0.04
    assert filament.custom_fields["spoolman_extra"]["pressure_advance"] == "0.025"


async def test_repair_is_idempotent(db_session):
    await _legacy_filament(
        db_session,
        {"spoolman_id": 12, "spoolman_extra": {"dry": "true"}},
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    await service.execute(
        "offline", preview["preview_fingerprint"], preview["mappings"]
    )

    second_preview = await service.preview("offline")

    assert second_preview["summary"]["records_scanned"] == 0
    assert second_preview["summary"]["promotable"] == 0


async def test_offline_repair_admin_api_requires_preview_and_approval(
    auth_client, db_session
):
    client, csrf = auth_client
    await _legacy_filament(
        db_session,
        {"spoolman_id": 44, "spoolman_extra": {"dry": "true"}},
    )

    preview_response = await client.post(
        "/api/v1/admin/system/spoolman-import/repair/preview",
        json={"mode": "offline"},
        headers={"X-CSRF-Token": csrf},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["summary"]["promotable"] == 1

    missing_approval = await client.post(
        "/api/v1/admin/system/spoolman-import/repair/execute",
        json={
            "mode": "offline",
            "preview_fingerprint": preview["preview_fingerprint"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert missing_approval.status_code == 422

    execute_response = await client.post(
        "/api/v1/admin/system/spoolman-import/repair/execute",
        json={
            "mode": "offline",
            "preview_fingerprint": preview["preview_fingerprint"],
            "approved_mappings": preview["mappings"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert execute_response.status_code == 200
    assert execute_response.json()["values_promoted"] == 1
