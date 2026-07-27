import pytest
from app.models.filament import Filament, Manufacturer
from app.models.system_extra_field import SystemExtraField
from app.services.spoolman_extra_field_mapping import SpoolmanFieldError
from app.services.spoolman_import_repair_service import (
    SpoolmanImportRepairService,
    SpoolmanRepairError,
)
from sqlalchemy import select


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
        "imported_records": 1,
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
    pressure = next(
        item for item in preview["mappings"] if item["key"] == "pressure_advance"
    )
    dry = next(item for item in preview["mappings"] if item["key"] == "dry")
    assert pressure["confidence"] == "low"
    assert pressure["confidence_reason"] == "legacy_scalar"
    assert pressure["conversion_examples"] == [{"source": "0.025", "converted": 0.025}]
    assert dry["conversion_examples"] == [{"source": "true", "converted": True}]
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


async def test_offline_repair_can_create_record_local_definition(db_session):
    filament = await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "spoolman_extra": {"drying_temperature": "55"},
        },
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    approved = [{**preview["mappings"][0], "action": "local"}]

    result = await service.execute("offline", preview["preview_fingerprint"], approved)

    assert result["definitions_created"] == 0
    assert result["local_definitions_created"] == 1
    await db_session.refresh(filament)
    assert filament.custom_fields["drying_temperature"] == 55
    assert (
        filament.custom_field_definitions["drying_temperature"]["field_type"]
        == "number"
    )
    assert await db_session.scalar(select(SystemExtraField)) is None


async def test_offline_repair_can_explicitly_preserve_value(db_session):
    filament = await _legacy_filament(
        db_session,
        {"spoolman_id": 12, "spoolman_extra": {"dry": "true"}},
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    approved = [{**preview["mappings"][0], "action": "preserve"}]

    result = await service.execute("offline", preview["preview_fingerprint"], approved)

    assert result["records_updated"] == 0
    assert result["values_promoted"] == 0
    await db_session.refresh(filament)
    assert filament.custom_fields["spoolman_extra"] == {"dry": "true"}


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
    assert preview["mappings"][0]["status"] == "no_promotable"

    result = await service.execute(
        "offline",
        preview["preview_fingerprint"],
        [],
    )

    assert result["values_promoted"] == 0
    await db_session.refresh(filament)
    assert filament.custom_fields["pressure_advance"] == 0.04
    assert filament.custom_fields["spoolman_extra"]["pressure_advance"] == "0.025"


async def test_repair_blocks_system_storage_when_retained_value_is_incompatible(
    db_session,
):
    retained = await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "pressure_advance": "not a number",
            "spoolman_extra": {"notes": "keep"},
        },
    )
    repairable = Filament(
        manufacturer_id=retained.manufacturer_id,
        designation="Repairable retained value",
        material_type="PLA",
        diameter_mm=1.75,
        custom_fields={
            "spoolman_id": 13,
            "spoolman_extra": {"pressure_advance": "0.025"},
        },
    )
    db_session.add(repairable)
    await db_session.commit()
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    pressure = next(
        item for item in preview["mappings"] if item["key"] == "pressure_advance"
    )

    assert pressure["status"] == "ready"
    assert pressure["promotable_occurrences"] == 1
    assert pressure["system_conflict"]["count"] == 1
    with pytest.raises(SpoolmanRepairError, match="incompatible retained"):
        await service.execute(
            "offline",
            preview["preview_fingerprint"],
            [{**pressure, "action": "system"}],
        )

    result = await service.execute(
        "offline",
        preview["preview_fingerprint"],
        [{**pressure, "action": "local"}],
    )
    assert result["local_definitions_created"] == 1
    assert result["values_promoted"] == 1
    await db_session.refresh(repairable)
    assert repairable.custom_fields["pressure_advance"] == 0.025


async def test_repair_rejects_overlapping_system_definition_paths(db_session):
    await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "spoolman_extra": {"pressure_advance": "0.025"},
        },
    )
    db_session.add(
        SystemExtraField(
            target_type="filament",
            key="pressure_advance.calibrated",
            label="Calibrated pressure advance",
            field_type="checkbox",
        )
    )
    await db_session.commit()
    service = SpoolmanImportRepairService(db_session)

    preview = await service.preview("offline")
    mapping = preview["mappings"][0]
    assert mapping["status"] == "conflict"
    assert mapping["conflicting_key"] == "pressure_advance.calibrated"

    with pytest.raises(SpoolmanRepairError, match="not repairable"):
        await service.execute(
            "offline",
            preview["preview_fingerprint"],
            [mapping],
        )


def test_repair_date_conversion_accepts_date_or_datetime_only():
    mapping = {"field_type": "date", "source_field_type": "datetime"}

    assert (
        SpoolmanImportRepairService._convert_approved('"2026-07-27T15:45:30Z"', mapping)
        == "2026-07-27"
    )
    assert (
        SpoolmanImportRepairService._convert_approved('"2026-07-28"', mapping)
        == "2026-07-28"
    )
    with pytest.raises(SpoolmanFieldError, match="ISO-8601"):
        SpoolmanImportRepairService._convert_approved('"someday"', mapping)


def test_repair_choice_mapping_requires_options():
    with pytest.raises(SpoolmanRepairError, match="at least one choice"):
        SpoolmanImportRepairService._validate_approved(
            {
                "target_type": "filament",
                "key": "profile",
                "label": "Profile",
                "field_type": "dropdown",
                "options": [],
                "action": "system",
            }
        )


async def test_repair_rejects_edited_mapping_that_converts_no_values(db_session):
    await _legacy_filament(
        db_session,
        {
            "spoolman_id": 12,
            "spoolman_extra": {"material_profile": '"PLA"'},
        },
    )
    service = SpoolmanImportRepairService(db_session)
    preview = await service.preview("offline")
    mapping = preview["mappings"][0]

    with pytest.raises(SpoolmanRepairError, match="no values compatible"):
        await service.execute(
            "offline",
            preview["preview_fingerprint"],
            [
                {
                    **mapping,
                    "field_type": "dropdown",
                    "options": ["PETG"],
                    "action": "system",
                }
            ],
        )

    assert await db_session.scalar(select(SystemExtraField)) is None


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

    assert second_preview["summary"]["imported_records"] == 1
    assert second_preview["summary"]["records_scanned"] == 0
    assert second_preview["summary"]["promotable"] == 0


async def test_preview_distinguishes_typed_imports_from_no_imports(db_session):
    filament = await _legacy_filament(
        db_session,
        {"spoolman_id": 12, "dry": True},
    )
    service = SpoolmanImportRepairService(db_session)

    typed_preview = await service.preview("offline")

    assert typed_preview["summary"]["imported_records"] == 1
    assert typed_preview["summary"]["records_scanned"] == 0
    assert typed_preview["mappings"] == []

    filament.custom_fields = {"dry": True}
    await db_session.commit()
    no_import_preview = await service.preview("offline")

    assert no_import_preview["summary"]["imported_records"] == 0
    assert no_import_preview["summary"]["records_scanned"] == 0
    assert no_import_preview["mappings"] == []


async def test_preview_samples_are_bounded_without_changing_stored_data(db_session):
    long_value = "x" * 500
    filament = await _legacy_filament(
        db_session,
        {"spoolman_id": 12, "spoolman_extra": {"notes": long_value}},
    )
    service = SpoolmanImportRepairService(db_session)

    preview = await service.preview("offline")

    assert len(preview["mappings"][0]["samples"][0]) == 200
    assert preview["mappings"][0]["samples"][0].endswith("...")
    await db_session.refresh(filament)
    assert filament.custom_fields["spoolman_extra"]["notes"] == long_value


async def test_preview_includes_up_to_three_distinct_real_conversion_examples(
    db_session,
):
    first = await _legacy_filament(
        db_session,
        {"spoolman_id": 1, "spoolman_extra": {"temperature": "[190,230]"}},
    )
    for spoolman_id, value in enumerate(
        ("[195,235]", "[200,240]", "[205,245]"),
        start=2,
    ):
        db_session.add(
            Filament(
                manufacturer_id=first.manufacturer_id,
                designation=f"Legacy PLA {spoolman_id}",
                material_type="PLA",
                diameter_mm=1.75,
                custom_fields={
                    "spoolman_id": spoolman_id,
                    "spoolman_extra": {"temperature": value},
                },
            )
        )
    await db_session.commit()

    preview = await SpoolmanImportRepairService(db_session).preview("offline")
    mapping = preview["mappings"][0]

    assert mapping["confidence"] == "high"
    assert mapping["promotable_occurrences"] == 4
    assert mapping["conversion_examples"] == [
        {"source": "[190,230]", "converted": {"min": 190, "max": 230}},
        {"source": "[195,235]", "converted": {"min": 195, "max": 235}},
        {"source": "[200,240]", "converted": {"min": 200, "max": 240}},
    ]


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
