from app.models.filament import Filament
from app.plugins.manager import PluginManager


def test_extract_bambu_params_reads_promoted_native_nozzle_range():
    params = PluginManager._extract_bambu_params(
        {"nozzle_temperature": {"min": 190, "max": None}},
        set(),
    )

    assert params["bambu_nozzle_temp_min"] == "190"
    assert "bambu_nozzle_temp_max" not in params


def test_clean_bambu_fields_removes_promoted_native_nozzle_range():
    filament = Filament(
        manufacturer_id=1,
        designation="PLA",
        material_type="PLA",
        diameter_mm=1.75,
        custom_fields={
            "nozzle_temperature": {"min": 190, "max": 230},
            "notes": "keep",
        },
    )

    PluginManager._clean_bambu_keys_from_cf(filament, set())

    assert filament.custom_fields == {"notes": "keep"}
