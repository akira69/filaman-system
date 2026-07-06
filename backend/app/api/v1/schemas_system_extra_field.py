from typing import Any

from pydantic import BaseModel, Field


class SystemExtraFieldBase(BaseModel):
    target_type: str = Field(..., description="'filament' or 'spool'")
    key: str = Field(..., description="Key for the JSON custom_fields")
    label: str = Field(..., description="Display label")
    default_value: str | None = Field(None, description="Default value if any")
    field_type: str = Field(
        "text", description="Field type: text, number, dropdown, checkbox, formula"
    )
    options: list[str] | None = Field(None, description="Options for dropdown fields")
    # Formula fields
    formula: dict[str, Any] | None = Field(None, description="JSON Logic expression; non-null marks this as a formula field")
    show_in_list: bool = Field(True, description="Show derived value in list views")
    show_in_detail: bool = Field(True, description="Show derived value in detail views")
    show_in_template: bool = Field(False, description="Expose derived value to label template tokens")
    include_in_api: bool = Field(False, description="Include derived value in API responses")


class SystemExtraFieldCreate(SystemExtraFieldBase):
    source: str | None = Field(
        None,
        description="Plugin source, e.g. 'bambulab'. Protected from manual deletion.",
    )


class SystemExtraFieldUpdate(BaseModel):
    """Update schema for user-created fields. target_type and key are not editable."""

    label: str | None = Field(None, description="Display label")
    default_value: str | None = Field(None, description="Default value if any")
    field_type: str | None = Field(
        None, description="Field type: text, number, dropdown, checkbox, formula"
    )
    options: list[str] | None = Field(None, description="Options for dropdown fields")
    formula: dict[str, Any] | None = Field(None, description="JSON Logic expression")
    show_in_list: bool | None = Field(None)
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
    id: int
    source: str | None = None

    class Config:
        from_attributes = True
