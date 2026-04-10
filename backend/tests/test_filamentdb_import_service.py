from sqlalchemy import delete, select

import httpx
import pytest

from app.core.cache import response_cache
from app.models.filament import Color, Filament, FilamentColor, Manufacturer
from app.services.filamentdb_import_service import FilamentDBImportService


@pytest.mark.asyncio
async def test_preview_and_fetch_filaments_reuse_cached_sync_snapshot(
    db_session, monkeypatch
):
    response_cache.clear()
    calls = 0
    payload = {
        "synced_at": "2026-04-10T12:00:00Z",
        "manufacturers": [{"id": 1, "name": "ACME"}],
        "materials": [{"id": 10, "key": "PLA", "name": "PLA"}],
        "filaments": [
            {
                "id": 100,
                "designation": "Fast PLA",
                "manufacturer_id": 1,
                "material_id": 10,
                "colors": [{"hex_code": "#ff0000", "color_name": "Red", "position": 1}],
            }
        ],
        "spool_profiles": [],
    }

    class DummyResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return payload

    async def fake_get(self, url, params=None):
        nonlocal calls
        calls += 1
        return DummyResponse()

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    service = FilamentDBImportService(db_session)
    preview = await service.preview_manufacturers()
    fetched = await service.fetch_filaments([1], snapshot_id=getattr(preview, "snapshot_id", None))

    assert getattr(preview, "snapshot_id", None)
    assert preview.summary["manufacturers"] == 1
    assert len(fetched.filaments) == 1
    assert calls == 1

    response_cache.clear()


@pytest.mark.asyncio
async def test_create_filament_colors_replaces_stale_rows_for_reused_filament_ids(
    db_session,
):
    """Regression: stale filament_colors rows from a deleted filament must not
    collide with new color assignments when SQLite reuses the same filament ID."""
    manufacturer = Manufacturer(name="Test Manufacturer")
    old_color = Color(name="Legacy Red", hex_code="#ff0000")
    new_color = Color(name="Silk Blue", hex_code="#0000ff")
    db_session.add_all([manufacturer, old_color, new_color])
    await db_session.flush()

    original_filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Original",
        material_type="pla",
        diameter_mm=1.75,
        color_mode="single",
    )
    db_session.add(original_filament)
    await db_session.flush()

    reused_filament_id = original_filament.id
    db_session.add(
        FilamentColor(
            filament_id=reused_filament_id,
            color_id=old_color.id,
            position=1,
            display_name_override="Legacy Red",
        )
    )
    await db_session.commit()

    # Delete the filament but leave the filament_colors row behind
    # (simulates missing CASCADE enforcement in older SQLite DBs)
    await db_session.execute(delete(Filament).where(Filament.id == reused_filament_id))
    await db_session.commit()

    # Create a replacement filament that reuses the same ID
    replacement_filament = Filament(
        id=reused_filament_id,
        manufacturer_id=manufacturer.id,
        designation="Replacement",
        material_type="pla",
        diameter_mm=1.75,
        color_mode="multi",
    )
    db_session.add(replacement_filament)
    await db_session.flush()

    # This must NOT raise IntegrityError even though stale rows exist
    service = FilamentDBImportService(db_session)
    await service._create_filament_colors(
        replacement_filament.id,
        {
            "colors": [
                {
                    "hex_code": "#0000ff",
                    "position": 1,
                    "color_name": "Silk Blue",
                }
            ]
        },
        {"#0000ff": new_color.id},
    )
    await db_session.commit()

    result = await db_session.execute(
        select(FilamentColor)
        .where(FilamentColor.filament_id == replacement_filament.id)
        .order_by(FilamentColor.position)
    )
    colors = result.scalars().all()

    assert len(colors) == 1
    assert colors[0].color_id == new_color.id
    assert colors[0].position == 1
    assert colors[0].display_name_override == "Silk Blue"
