"""Opt-in integration coverage against a real, read-only Spoolman server.

Run with:

    SPOOLMAN_TEST_URL=http://spoolman.example:7912 \
        pytest -q tests/test_spoolman_live_integration.py

The source server is only read. Every import and repair uses a fresh in-memory
FilaMan database.
"""

from __future__ import annotations

import os
from copy import deepcopy
from typing import Any

import pytest
import pytest_asyncio
from app.core.seeds import run_all_seeds
from app.models import Base
from app.models.filament import Filament
from app.models.spool import Spool
from app.models.system_extra_field import SystemExtraField
from app.services.spoolman_extra_field_mapping import convert_spoolman_value
from app.services.spoolman_import_repair_service import (
    SpoolmanImportRepairService,
    SpoolmanRepairError,
)
from app.services.spoolman_import_service import (
    ImportPreview,
    SpoolmanImportError,
    SpoolmanImportService,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

SPOOLMAN_TEST_URL = os.getenv("SPOOLMAN_TEST_URL", "").rstrip("/")

pytestmark = pytest.mark.skipif(
    not SPOOLMAN_TEST_URL,
    reason="Set SPOOLMAN_TEST_URL to run live Spoolman integration tests.",
)


@pytest_asyncio.fixture(scope="session")
async def live_spoolman_snapshot() -> ImportPreview:
    """Fetch one complete source snapshot without retaining a writable DB."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    async with session_maker() as session:
        await run_all_seeds(session)
        preview = await SpoolmanImportService(session).preview(SPOOLMAN_TEST_URL)

    await engine.dispose()
    return preview


def _use_snapshot(
    service: SpoolmanImportService,
    snapshot: ImportPreview,
) -> None:
    """Replace repeated network reads with the immutable live snapshot."""

    async def cached_preview(_base_url: str) -> ImportPreview:
        return deepcopy(snapshot)

    service.preview = cached_preview  # type: ignore[method-assign]


async def _execute_import(
    db_session,
    snapshot: ImportPreview,
    mode: str,
    field_actions: list[dict[str, str]] | None = None,
):
    service = SpoolmanImportService(db_session)
    _use_snapshot(service, snapshot)
    result = await service.execute(
        SPOOLMAN_TEST_URL,
        snapshot.extra_field_fingerprint,
        extra_field_mode=mode,
        field_actions=field_actions,
    )
    return service, result


def _source_spool(snapshot: ImportPreview, *keys: str) -> dict[str, Any]:
    for spool in snapshot.spools:
        extra = spool.get("extra")
        if isinstance(extra, dict) and all(key in extra for key in keys):
            return spool
    pytest.fail(f"Live Spoolman snapshot has no spool containing {keys!r}")


async def _imported_spool(db_session, spoolman_id: int) -> Spool:
    result = await db_session.execute(
        select(Spool).where(Spool.external_id == f"spoolman:{spoolman_id}")
    )
    return result.scalar_one()


async def _system_definitions(
    db_session,
) -> dict[tuple[str, str], SystemExtraField]:
    result = await db_session.execute(select(SystemExtraField))
    return {
        (definition.target_type, definition.key): definition
        for definition in result.scalars()
    }


def _mapped_identities(snapshot: ImportPreview) -> set[tuple[str, str]]:
    return {
        (target, definition["key"])
        for target in ("filament", "spool")
        for definition in snapshot.field_definitions[target]
    }


def _ready_mapping(
    preview: dict[str, Any],
    target_type: str,
    key: str,
) -> dict[str, Any]:
    mapping = next(
        item
        for item in preview["mappings"]
        if item["target_type"] == target_type and item["key"] == key
    )
    assert mapping["status"] == "ready"
    return mapping


async def _server_repair_preview(
    db_session,
    snapshot: ImportPreview,
    import_mode: str,
) -> tuple[SpoolmanImportRepairService, dict[str, Any]]:
    await _execute_import(db_session, snapshot, import_mode)
    repair = SpoolmanImportRepairService(db_session)
    preview = await repair.preview("server", snapshot.field_definitions)
    return repair, preview


async def _assert_promoted_tag_and_dry(
    db_session,
    snapshot: ImportPreview,
) -> tuple[dict[str, Any], Spool]:
    source = _source_spool(snapshot, "tag", "dry")
    imported = await _imported_spool(db_session, source["id"])
    assert imported.custom_fields["tag"] == convert_spoolman_value(
        source["extra"]["tag"], "text"
    )
    assert imported.custom_fields["dry"] == convert_spoolman_value(
        source["extra"]["dry"], "datetime"
    )
    return source, imported


async def test_live_connection_preview_and_pagination(
    db_session,
    live_spoolman_snapshot,
):
    service = SpoolmanImportService(db_session)

    connection = await service.test_connection(SPOOLMAN_TEST_URL)
    preview = await service.preview(SPOOLMAN_TEST_URL)

    assert connection["status"] == "ok"
    assert connection["info"]["version"]
    assert preview.summary["vendors"] > 0
    assert preview.summary["filaments"] > 50
    assert preview.summary["spools"] > 0
    assert len(preview.extra_field_fingerprint or "") == 64
    assert preview.summary == live_spoolman_snapshot.summary
    assert preview.field_definitions == live_spoolman_snapshot.field_definitions

    mapped = {(item["target_type"], item["key"]): item for item in preview.extra_fields}
    assert mapped[("filament", "bed")]["field_type"] == "range"
    assert mapped[("filament", "bed")]["config"] == {
        "decimal_places": 0,
        "unit": "°C",
    }
    assert mapped[("filament", "extruder")]["field_type"] == "range"
    assert mapped[("spool", "tag")]["field_type"] == "text"
    assert mapped[("spool", "dry")]["field_type"] == "datetime"
    assert mapped[("spool", "bed")]["field_type"] == "range"
    assert mapped[("spool", "extruder")]["field_type"] == "range"


@pytest.mark.parametrize("mode", ["legacy", "preserve", "system", "local"])
async def test_live_initial_import_storage_modes(
    db_session,
    live_spoolman_snapshot,
    mode,
):
    service, result = await _execute_import(
        db_session,
        live_spoolman_snapshot,
        mode,
    )

    assert result.errors == []
    assert result.filaments_created == live_spoolman_snapshot.summary["filaments"]
    assert result.spools_created == live_spoolman_snapshot.summary["spools"]

    definitions = await _system_definitions(db_session)
    expected_identities = _mapped_identities(live_spoolman_snapshot)
    if mode == "system":
        assert set(definitions) == expected_identities
        assert result.extra_fields_created == len(expected_identities)
    else:
        assert definitions == {}

    if mode == "local":
        assert result.extra_local_definitions == len(expected_identities)
    else:
        assert result.extra_local_definitions == 0

    source = _source_spool(live_spoolman_snapshot, "tag", "dry")
    imported = await _imported_spool(db_session, source["id"])
    custom = imported.custom_fields or {}
    nested = custom.get("spoolman_extra", {})

    if mode in {"system", "local"}:
        assert custom["tag"] == convert_spoolman_value(source["extra"]["tag"], "text")
        assert custom["dry"] == convert_spoolman_value(
            source["extra"]["dry"], "datetime"
        )
        assert "tag" not in nested
        assert "dry" not in nested
        assert result.extra_values_promoted > 0
    elif mode == "preserve":
        assert nested["tag"] == source["extra"]["tag"]
        assert nested["dry"] == source["extra"]["dry"]
        assert result.extra_values_preserved > 0
    else:
        assert (
            nested["tag"] == service._clean_dict({"tag": source["extra"]["tag"]})["tag"]
        )
        assert (
            nested["dry"] == service._clean_dict({"dry": source["extra"]["dry"]})["dry"]
        )
        assert result.extra_values_preserved > 0

    if mode == "local":
        local = imported.custom_field_definitions or {}
        assert local["tag"]["field_type"] == "text"
        assert local["dry"]["field_type"] == "datetime"
    else:
        assert imported.custom_field_definitions is None


async def test_live_initial_import_per_field_overrides(
    db_session,
    live_spoolman_snapshot,
):
    actions = [
        {"target_type": "spool", "key": "tag", "action": "local"},
        {"target_type": "spool", "key": "dry", "action": "system"},
        {"target_type": "filament", "key": "bed", "action": "system"},
        {"target_type": "filament", "key": "extruder", "action": "local"},
    ]
    _, result = await _execute_import(
        db_session,
        live_spoolman_snapshot,
        "preserve",
        actions,
    )

    assert result.errors == []
    definitions = await _system_definitions(db_session)
    assert set(definitions) == {("spool", "dry"), ("filament", "bed")}
    assert result.extra_local_definitions == 2

    source = _source_spool(live_spoolman_snapshot, "tag", "dry")
    imported = await _imported_spool(db_session, source["id"])
    custom = imported.custom_fields or {}
    local = imported.custom_field_definitions or {}
    assert custom["tag"] == convert_spoolman_value(source["extra"]["tag"], "text")
    assert local["tag"]["field_type"] == "text"
    assert custom["dry"] == convert_spoolman_value(source["extra"]["dry"], "datetime")
    assert "dry" not in local


async def test_live_initial_import_fingerprint_and_idempotency(
    db_session,
    live_spoolman_snapshot,
):
    service = SpoolmanImportService(db_session)
    _use_snapshot(service, live_spoolman_snapshot)

    with pytest.raises(SpoolmanImportError) as stale:
        await service.execute(
            SPOOLMAN_TEST_URL,
            "0" * 64,
            extra_field_mode="system",
        )
    assert stale.value.code == "preview_changed"
    assert await db_session.scalar(select(func.count()).select_from(Filament)) == 0

    first = await service.execute(
        SPOOLMAN_TEST_URL,
        live_spoolman_snapshot.extra_field_fingerprint,
        extra_field_mode="system",
    )
    filament_count = await db_session.scalar(select(func.count()).select_from(Filament))
    spool_count = await db_session.scalar(select(func.count()).select_from(Spool))

    second = await service.execute(
        SPOOLMAN_TEST_URL,
        live_spoolman_snapshot.extra_field_fingerprint,
        extra_field_mode="system",
    )

    assert first.errors == []
    assert second.errors == []
    assert second.filaments_created == 0
    assert second.filaments_skipped == live_spoolman_snapshot.summary["filaments"]
    assert second.spools_created == 0
    assert second.spools_skipped == live_spoolman_snapshot.summary["spools"]
    assert second.extra_fields_reused == len(_mapped_identities(live_spoolman_snapshot))
    assert (
        await db_session.scalar(select(func.count()).select_from(Filament))
        == filament_count
    )
    assert (
        await db_session.scalar(select(func.count()).select_from(Spool)) == spool_count
    )


async def test_live_server_repair_to_system_fields_is_idempotent(
    db_session,
    live_spoolman_snapshot,
):
    repair, preview = await _server_repair_preview(
        db_session,
        live_spoolman_snapshot,
        "legacy",
    )
    approved = [
        {**mapping, "action": "system"}
        for mapping in preview["mappings"]
        if mapping["status"] == "ready"
    ]
    tag = _ready_mapping(preview, "spool", "tag")
    dry = _ready_mapping(preview, "spool", "dry")

    assert {("spool", "tag"), ("spool", "dry")} <= {
        (item["target_type"], item["key"]) for item in approved
    }
    assert tag["confidence"] == "authoritative"
    assert tag["confidence_reason"] == "source_definition"
    assert 1 <= len(tag["conversion_examples"]) <= 3
    assert 1 <= len(dry["conversion_examples"]) <= 3
    result = await repair.execute(
        "server",
        preview["preview_fingerprint"],
        approved,
        live_spoolman_snapshot.field_definitions,
    )

    assert result["definitions_created"] == len(approved)
    assert result["values_promoted"] == preview["summary"]["promotable"]
    assert result["records_updated"] > 0
    definitions = await _system_definitions(db_session)
    assert definitions[("spool", "tag")].field_type == "text"
    assert definitions[("spool", "dry")].field_type == "datetime"

    await _assert_promoted_tag_and_dry(db_session, live_spoolman_snapshot)

    after = await repair.preview(
        "server",
        live_spoolman_snapshot.field_definitions,
    )
    after_keys = {
        (item["target_type"], item["key"])
        for item in after["mappings"]
        if item["status"] == "ready"
    }
    assert not after_keys.intersection(
        (item["target_type"], item["key"]) for item in approved
    )
    with pytest.raises(SpoolmanRepairError) as stale:
        await repair.execute(
            "server",
            preview["preview_fingerprint"],
            approved,
            live_spoolman_snapshot.field_definitions,
        )
    assert stale.value.code == "preview_changed"


async def test_live_preserved_datetime_repairs_to_date_only(
    db_session,
    live_spoolman_snapshot,
):
    repair, preview = await _server_repair_preview(
        db_session,
        live_spoolman_snapshot,
        "preserve",
    )
    dry = _ready_mapping(preview, "spool", "dry")
    approved = {
        **dry,
        "field_type": "date",
        "config": None,
        "default_value": None,
        "action": "system",
    }

    result = await repair.execute(
        "server",
        preview["preview_fingerprint"],
        [approved],
        live_spoolman_snapshot.field_definitions,
    )

    assert result["values_promoted"] == dry["promotable_occurrences"]
    definitions = await _system_definitions(db_session)
    assert definitions[("spool", "dry")].field_type == "date"

    source = _source_spool(live_spoolman_snapshot, "tag", "dry")
    imported = await _imported_spool(db_session, source["id"])
    custom = imported.custom_fields or {}
    assert (
        custom["dry"] == convert_spoolman_value(source["extra"]["dry"], "datetime")[:10]
    )
    assert custom["spoolman_extra"]["tag"] == source["extra"]["tag"]
    assert "dry" not in custom["spoolman_extra"]


async def test_live_retained_conflict_blocks_system_but_allows_local_repair(
    db_session,
    live_spoolman_snapshot,
):
    repair, _ = await _server_repair_preview(
        db_session,
        live_spoolman_snapshot,
        "legacy",
    )
    source = _source_spool(live_spoolman_snapshot, "dry")
    conflicting = await _imported_spool(db_session, source["id"])
    conflicting.custom_fields = {
        **(conflicting.custom_fields or {}),
        "dry": "not-a-datetime",
    }
    await db_session.commit()

    preview = await repair.preview(
        "server",
        live_spoolman_snapshot.field_definitions,
    )
    dry = _ready_mapping(preview, "spool", "dry")
    assert dry["system_conflict"]["count"] >= 1
    assert preview["summary"]["collisions"] >= 1

    with pytest.raises(SpoolmanRepairError) as blocked:
        await repair.execute(
            "server",
            preview["preview_fingerprint"],
            [{**dry, "action": "system"}],
            live_spoolman_snapshot.field_definitions,
        )
    assert blocked.value.code == "retained_value_conflict"

    result = await repair.execute(
        "server",
        preview["preview_fingerprint"],
        [{**dry, "action": "local"}],
        live_spoolman_snapshot.field_definitions,
    )
    assert result["definitions_created"] == 0
    assert result["local_definitions_created"] == result["values_promoted"]
    assert result["values_promoted"] > 0
    assert ("spool", "dry") not in await _system_definitions(db_session)

    await db_session.refresh(conflicting)
    assert conflicting.custom_fields["dry"] == "not-a-datetime"
    assert "dry" in conflicting.custom_fields["spoolman_extra"]


async def test_live_repair_normalizes_dropdown_and_preserves_nonchoices(
    db_session,
    live_spoolman_snapshot,
):
    repair, preview = await _server_repair_preview(
        db_session,
        live_spoolman_snapshot,
        "legacy",
    )
    tag = _ready_mapping(preview, "spool", "tag")
    source = _source_spool(live_spoolman_snapshot, "tag")
    selected_tag = convert_spoolman_value(source["extra"]["tag"], "text")
    approved = {
        **tag,
        "field_type": "dropdown",
        "source_field_type": "choice",
        "options": [selected_tag, " ", selected_tag],
        "action": "system",
    }

    result = await repair.execute(
        "server",
        preview["preview_fingerprint"],
        [approved],
        live_spoolman_snapshot.field_definitions,
    )

    definitions = await _system_definitions(db_session)
    assert definitions[("spool", "tag")].options == [selected_tag]
    assert result["values_promoted"] >= 1
    assert result["values_preserved"] >= 1

    imported = await _imported_spool(db_session, source["id"])
    assert imported.custom_fields["tag"] == selected_tag
    assert "tag" not in imported.custom_fields.get("spoolman_extra", {})


async def test_live_offline_recovery_supports_mixed_system_and_local_actions(
    db_session,
    live_spoolman_snapshot,
):
    await _execute_import(db_session, live_spoolman_snapshot, "preserve")
    repair = SpoolmanImportRepairService(db_session)
    preview = await repair.preview("offline")
    tag = _ready_mapping(preview, "spool", "tag")
    dry = _ready_mapping(preview, "spool", "dry")

    assert tag["field_type"] == "text"
    assert dry["field_type"] == "datetime"
    result = await repair.execute(
        "offline",
        preview["preview_fingerprint"],
        [
            {**tag, "action": "system"},
            {**dry, "action": "local"},
        ],
    )

    assert result["definitions_created"] == 1
    assert result["local_definitions_created"] > 0
    definitions = await _system_definitions(db_session)
    assert set(definitions) == {("spool", "tag")}

    _, imported = await _assert_promoted_tag_and_dry(
        db_session,
        live_spoolman_snapshot,
    )
    assert imported.custom_field_definitions["dry"]["field_type"] == "datetime"


async def test_live_repair_rejects_zero_conversion_definition(
    db_session,
    live_spoolman_snapshot,
):
    repair, preview = await _server_repair_preview(
        db_session,
        live_spoolman_snapshot,
        "legacy",
    )
    tag = _ready_mapping(preview, "spool", "tag")
    impossible = {
        **tag,
        "field_type": "number",
        "source_field_type": "integer",
        "config": {"decimal_places": 0},
        "options": None,
        "action": "system",
    }

    with pytest.raises(SpoolmanRepairError) as blocked:
        await repair.execute(
            "server",
            preview["preview_fingerprint"],
            [impossible],
            live_spoolman_snapshot.field_definitions,
        )
    assert blocked.value.code == "no_promotable_values"
    assert ("spool", "tag") not in await _system_definitions(db_session)


async def test_live_admin_api_initial_import_round_trip(
    auth_client,
    live_spoolman_snapshot,
):
    client, csrf = auth_client
    preview_response = await client.post(
        "/api/v1/admin/system/spoolman-import/preview",
        json={"url": SPOOLMAN_TEST_URL},
        headers={"X-CSRF-Token": csrf},
    )

    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["summary"] == live_spoolman_snapshot.summary
    assert {
        (item["target_type"], item["key"]) for item in preview["extra_fields"]
    } == _mapped_identities(live_spoolman_snapshot)

    execute_response = await client.post(
        "/api/v1/admin/system/spoolman-import/execute",
        json={
            "url": SPOOLMAN_TEST_URL,
            "extra_field_fingerprint": preview["extra_field_fingerprint"],
            "extra_field_mode": "system",
        },
        headers={"X-CSRF-Token": csrf},
    )

    assert execute_response.status_code == 200
    result = execute_response.json()
    assert result["errors"] == []
    assert result["filaments_created"] == preview["summary"]["filaments"]
    assert result["spools_created"] == preview["summary"]["spools"]
    assert result["extra_fields_created"] == len(
        _mapped_identities(live_spoolman_snapshot)
    )
    assert result["extra_values_promoted"] > 0


async def test_live_admin_api_old_request_to_new_style_repair_round_trip(
    auth_client,
    db_session,
    live_spoolman_snapshot,
):
    client, csrf = auth_client

    # Reproduce the pre-rich-field API contract exactly: an old client sends
    # only the URL and knows nothing about fingerprints, modes, or field actions.
    import_response = await client.post(
        "/api/v1/admin/system/spoolman-import/execute",
        json={"url": SPOOLMAN_TEST_URL},
        headers={"X-CSRF-Token": csrf},
    )
    assert import_response.status_code == 200
    import_result = import_response.json()
    assert import_result["errors"] == []
    assert (
        import_result["filaments_created"]
        == live_spoolman_snapshot.summary["filaments"]
    )
    assert import_result["spools_created"] == live_spoolman_snapshot.summary["spools"]
    assert import_result["extra_values_preserved"] > 0

    # The old path must leave fields in the legacy nested object, without
    # creating either reusable System definitions or record-local definitions.
    assert await _system_definitions(db_session) == {}
    source = _source_spool(live_spoolman_snapshot, "tag", "dry")
    imported = await _imported_spool(db_session, source["id"])
    nested = imported.custom_fields["spoolman_extra"]
    cleaner = SpoolmanImportService(db_session)
    assert nested["tag"] == cleaner._clean_dict({"tag": source["extra"]["tag"]})["tag"]
    assert nested["dry"] == cleaner._clean_dict({"dry": source["extra"]["dry"]})["dry"]
    assert imported.custom_field_definitions is None

    repair_preview_response = await client.post(
        "/api/v1/admin/system/spoolman-import/repair/preview",
        json={"mode": "server", "url": SPOOLMAN_TEST_URL},
        headers={"X-CSRF-Token": csrf},
    )
    assert repair_preview_response.status_code == 200
    repair_preview = repair_preview_response.json()
    tag = _ready_mapping(repair_preview, "spool", "tag")
    dry = _ready_mapping(repair_preview, "spool", "dry")
    approved = [
        {**tag, "action": "local"},
        {
            **dry,
            "field_type": "date",
            "config": None,
            "default_value": None,
            "action": "system",
        },
    ]

    execute_repair_response = await client.post(
        "/api/v1/admin/system/spoolman-import/repair/execute",
        json={
            "mode": "server",
            "url": SPOOLMAN_TEST_URL,
            "preview_fingerprint": repair_preview["preview_fingerprint"],
            "approved_mappings": approved,
        },
        headers={"X-CSRF-Token": csrf},
    )

    assert execute_repair_response.status_code == 200
    result = execute_repair_response.json()
    assert result["definitions_created"] == 1
    assert result["local_definitions_created"] > 0
    assert result["values_promoted"] == (
        tag["promotable_occurrences"] + dry["promotable_occurrences"]
    )
    assert result["records_updated"] > 0

    definitions = await _system_definitions(db_session)
    assert set(definitions) == {("spool", "dry")}
    assert definitions[("spool", "dry")].field_type == "date"

    await db_session.refresh(imported)
    custom = imported.custom_fields or {}
    assert custom["tag"] == convert_spoolman_value(source["extra"]["tag"], "text")
    assert (
        custom["dry"] == convert_spoolman_value(source["extra"]["dry"], "datetime")[:10]
    )
    assert "tag" not in custom.get("spoolman_extra", {})
    assert "dry" not in custom.get("spoolman_extra", {})
    assert imported.custom_field_definitions["tag"]["field_type"] == "text"
