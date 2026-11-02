from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.derived_fields import validate_formula
from app.services.extra_field_validation import (
    CONFIG_KEYS_BY_TYPE,
    VALID_FIELD_TYPES,
    validate_custom_field_path,
    validate_field_type_config,
)

__all__ = [
    "CONFIG_KEYS_BY_TYPE",
    "VALID_FIELD_TYPES",
    "validate_custom_field_path",
    "validate_field_type_config",
]


class SystemExtraFieldBase(BaseModel):
    target_type: str = Field(..., description="'filament' or 'spool'")
    key: str = Field(..., description="Key for the JSON custom_fields")
    label: str = Field(..., description="Display label")
    default_value: str | None = Field(None, description="Default value if any")
    field_type: str = Field(
        "text",
        description=(
            "Field type: text, number, range, dropdown, checkbox, "
            "formula, date, datetime, url, multiselect, textarea"
        ),
    )
    options: list[str] | None = Field(None, description="Options for dropdown/multiselect fields")
    config: dict[str, Any] | None = Field(
        None,
        exclude_if=lambda value: value is None,
        description=(
            "Type-specific config. Supported keys: unit (str), decimal_places (int|null), "
            "min_bound (number|null), max_bound (number|null), max_length (int|null)."
        ),
    )
    # Formula fields
    formula: dict[str, Any] | None = Field(
        None,
        exclude_if=lambda value: value is None,
        description="JSON Logic expression for formula fields",
    )
    show_in_detail: bool = Field(
        True,
        exclude_if=lambda value: value is True,
        description="Show the derived value in native detail views",
    )
    show_in_template: bool = Field(
        False,
        exclude_if=lambda value: value is False,
        description="Expose the derived value to label templates",
    )
    include_in_api: bool = Field(
        False,
        exclude_if=lambda value: value is False,
        description="Include the derived value in default entity API responses",
    )


class SystemExtraFieldCreate(SystemExtraFieldBase):
    source: str | None = Field(
        None,
        description="Plugin source, e.g. 'bambulab'. Protected from manual deletion.",
    )

    @model_validator(mode="after")
    def validate_type_and_config(self) -> "SystemExtraFieldCreate":
        if self.target_type not in {"filament", "spool"}:
            raise ValueError("target_type must be 'filament' or 'spool'")
        validate_custom_field_path(self.key)
        validate_field_type_config(self.field_type, self.options, self.config)
        validate_formula_definition(self.field_type, self.formula)
        return self


class SystemExtraFieldUpdate(BaseModel):
    """Update schema for user-created fields. target_type and key are not editable."""

    label: str | None = Field(None, description="Display label")
    default_value: str | None = Field(None, description="Default value if any")
    field_type: str | None = Field(
        None,
        description=(
            "Field type: text, number, range, dropdown, checkbox, "
            "formula, date, datetime, url, multiselect, textarea."
        ),
    )
    options: list[str] | None = Field(None, description="Options for dropdown/multiselect fields")
    config: dict[str, Any] | None = Field(None, description="Type-specific config")
    formula: dict[str, Any] | None = Field(None, description="JSON Logic expression")
    show_in_detail: bool | None = Field(None)
    show_in_template: bool | None = Field(None)
    include_in_api: bool | None = Field(None)


class FormulaPreviewRequest(BaseModel):
    formula: dict[str, Any] = Field(..., description="JSON Logic expression to evaluate")
    context: dict[str, Any] = Field(..., description="Sample context to evaluate against")


class FormulaPreviewResponse(BaseModel):
    result: Any = Field(None, description="Evaluated result, or null on error")
    error: str | None = Field(None, description="Error message if evaluation failed")


class SystemExtraFieldResponse(SystemExtraFieldBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str | None = None


def validate_formula_definition(
    field_type: str,
    formula: dict[str, Any] | None,
) -> None:
    if field_type == "formula":
        if formula is None:
            raise ValueError("field_type='formula' requires a formula")
        try:
            validate_formula(formula)
        except (ArithmeticError, TypeError) as exc:
            raise ValueError(f"Formula evaluation failed: {exc}") from exc
    elif formula is not None:
        raise ValueError("formula is only valid when field_type='formula'")
