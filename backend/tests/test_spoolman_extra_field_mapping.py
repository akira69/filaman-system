from types import SimpleNamespace

import pytest
from app.services.spoolman_extra_field_mapping import (
    SpoolmanFieldError,
    convert_spoolman_value,
    decode_spoolman_value,
    definitions_compatible,
    fingerprint,
    infer_definition,
    map_spoolman_definition,
)


@pytest.mark.parametrize(
    ("field_type", "raw", "expected"),
    [
        ("text", '"PLA profile"', "PLA profile"),
        ("text", "legacy text", "legacy text"),
        ("integer", "42", 42),
        ("float", "3.14", 3.14),
        ("integer_range", "[190,230]", {"min": 190, "max": 230}),
        ("float_range", "[0.2,null]", {"min": 0.2, "max": None}),
        ("boolean", "true", True),
        ("choice", '"PLA"', "PLA"),
        ("choice", '["PLA","PETG"]', ["PLA", "PETG"]),
        ("datetime", '"2026-07-20T10:30:00Z"', "2026-07-20T10:30:00Z"),
    ],
)
def test_convert_spoolman_values(field_type, raw, expected):
    assert convert_spoolman_value(raw, field_type, ["PLA", "PETG"]) == expected


def test_authoritative_text_preserves_legacy_json_looking_value():
    assert decode_spoolman_value("true", "text") == "true"


def test_choice_cardinality_is_enforced():
    with pytest.raises(SpoolmanFieldError, match="one choice"):
        convert_spoolman_value('["PLA"]', "choice", ["PLA"], multi_choice=False)


@pytest.mark.parametrize(
    ("raw", "field_type"),
    [("true", "integer"), ("[1,2,3]", "integer_range"), ('"ABS"', "choice")],
)
def test_invalid_values_are_rejected(raw, field_type):
    with pytest.raises(SpoolmanFieldError):
        convert_spoolman_value(raw, field_type, ["PLA", "PETG"])


@pytest.mark.parametrize(
    ("source_type", "multi", "native_type"),
    [
        ("text", None, "text"),
        ("integer", None, "number"),
        ("float", None, "number"),
        ("integer_range", None, "range"),
        ("float_range", None, "range"),
        ("boolean", None, "checkbox"),
        ("datetime", None, "datetime"),
        ("choice", False, "dropdown"),
        ("choice", True, "multiselect"),
    ],
)
def test_map_definition(source_type, multi, native_type):
    definition = {
        "key": "profile",
        "name": "Profile",
        "field_type": source_type,
        "unit": "mm"
        if source_type in {"integer", "float", "integer_range", "float_range"}
        else None,
    }
    if source_type == "choice":
        definition.update(choices=["PLA", "PETG"], multi_choice=multi)
    mapped = map_spoolman_definition(definition, "filament")
    assert mapped["field_type"] == native_type
    assert mapped["source_field_type"] == source_type


def test_vendor_definition_is_not_silently_mapped():
    with pytest.raises(SpoolmanFieldError, match="unsupported target"):
        map_spoolman_definition(
            {"key": "account", "name": "Account", "field_type": "text"},
            "vendor",
        )


def test_oversized_default_is_preserved_as_unsupported_definition():
    with pytest.raises(SpoolmanFieldError, match="500-character"):
        map_spoolman_definition(
            {
                "key": "profile",
                "name": "Profile",
                "field_type": "text",
                "default_value": '"' + ("x" * 501) + '"',
            },
            "filament",
        )


def test_float_definition_does_not_reuse_integer_only_native_field():
    candidate = map_spoolman_definition(
        {"key": "flow", "name": "Flow", "field_type": "float"},
        "filament",
    )
    existing = SimpleNamespace(
        field_type="number", options=None, config={"decimal_places": 0}
    )

    assert definitions_compatible(candidate, existing) is False


def test_unbounded_definition_does_not_reuse_bounded_native_field():
    candidate = map_spoolman_definition(
        {"key": "flow", "name": "Flow", "field_type": "float"},
        "filament",
    )
    existing = SimpleNamespace(
        field_type="number", options=None, config={"min_bound": 0}
    )

    assert definitions_compatible(candidate, existing) is False


@pytest.mark.parametrize(
    ("values", "expected_type", "confidence"),
    [
        (["true", "false"], "checkbox", "low"),
        (["1", "2"], "number", "low"),
        (["[190,230]", "[200,240]"], "range", "medium"),
        (['["PLA"]', '["PETG"]'], "multiselect", "medium"),
        (["plain text", "other"], "text", "low"),
        (["2026-07-20", "2026-07-21"], "date", "medium"),
        (["2026-07-20T10:30:00Z"], "datetime", "medium"),
        (
            ["https://example.com/one", "https://example.com/two"],
            "url",
            "high",
        ),
    ],
)
def test_infer_definition(values, expected_type, confidence):
    inferred = infer_definition("filament", "profile", values)
    assert inferred["field_type"] == expected_type
    assert inferred["confidence"] == confidence


def test_infer_definition_uses_high_confidence_for_repeated_structured_values():
    inferred = infer_definition(
        "filament",
        "temperature",
        ["[190,230]", "[200,240]", "[205,245]"],
    )

    assert inferred["field_type"] == "range"
    assert inferred["confidence"] == "high"
    assert inferred["confidence_reason"] == "structured_values"


def test_infer_definition_uses_dominant_pattern_and_preserves_outliers():
    inferred = infer_definition(
        "spool",
        "inspection_date",
        [
            "2026-07-20",
            "2026-07-21",
            "2026-07-22",
            "2026-07-23",
            "unknown",
        ],
    )

    assert inferred["field_type"] == "date"
    assert inferred["confidence"] == "medium"
    assert inferred["confidence_reason"] == "majority_match"


def test_fingerprint_is_stable_for_dictionary_order():
    assert fingerprint({"a": 1, "b": 2}) == fingerprint({"b": 2, "a": 1})
