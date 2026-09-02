import pytest
from sqlalchemy import select

from app.models import Filament, Manufacturer, Spool, SpoolStatus

EXPECTED_DASHBOARD_KEYS = {
    "spool_distribution",
    "total_value_available",
    "filament_count_active",
    "filament_count_used",
    "filament_stats",
    "location_stats",
    "manufacturers_with_spools",
    "low_stock_spools",
    "empty_spools",
    "filament_types",
}


async def _status(db_session, key: str) -> SpoolStatus:
    result = await db_session.execute(select(SpoolStatus).where(SpoolStatus.key == key))
    return result.scalar_one()


@pytest.mark.asyncio
async def test_dashboard_stats_requires_authentication(client):
    response = await client.get("/api/v1/dashboard/stats")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_dashboard_stats_preserves_pre_scope_response_contract(
    auth_client, db_session
):
    client, _ = auth_client
    manufacturer = Manufacturer(name="Dashboard Contract Maker")
    db_session.add(manufacturer)
    await db_session.flush()

    filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Contract PLA",
        material_type="PLA",
        diameter_mm=1.75,
    )
    unused_filament = Filament(
        manufacturer_id=manufacturer.id,
        designation="Unused PLA",
        material_type="PLA",
        diameter_mm=1.75,
    )
    db_session.add_all([filament, unused_filament])
    await db_session.flush()

    active_status = await _status(db_session, "new")
    db_session.add_all(
        [
            Spool(
                filament_id=filament.id,
                status_id=active_status.id,
                initial_total_weight_g=1000,
                remaining_weight_g=500,
                low_weight_threshold_g=100,
            ),
            Spool(
                filament_id=filament.id,
                status_id=active_status.id,
                initial_total_weight_g=1000,
                remaining_weight_g=250,
                low_weight_threshold_g=100,
            ),
            Spool(
                filament_id=filament.id,
                status_id=active_status.id,
                initial_total_weight_g=1000,
                remaining_weight_g=0,
                low_weight_threshold_g=100,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get("/api/v1/dashboard/stats?limit=20")

    assert response.status_code == 200
    data = response.json()
    assert set(data) == EXPECTED_DASHBOARD_KEYS
    assert "filament_types_active" not in data
    assert "filament_types_used" not in data
    assert "filament_stats_used" not in data
    assert data["filament_count_active"] == 1
    assert data["filament_count_used"] == 1
    assert data["filament_types"] == [{"material_type": "PLA", "count": 3}]
    assert data["filament_stats"] == [
        {"filament_type": "PLA", "spool_count": 2, "total_weight_g": 750.0}
    ]


@pytest.mark.asyncio
async def test_dashboard_stats_keeps_limit_validation(auth_client):
    client, _ = auth_client

    response = await client.get("/api/v1/dashboard/stats?limit=0")

    assert response.status_code == 422
