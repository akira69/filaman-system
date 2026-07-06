from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import PrincipalDep, RequirePermission
from app.api.v1.schemas_system_extra_field import (
    FormulaPreviewRequest,
    FormulaPreviewResponse,
    SystemExtraFieldCreate,
    SystemExtraFieldResponse,
    SystemExtraFieldUpdate,
)
from app.core.cache import response_cache
from app.core.database import get_db
from app.models.system_extra_field import SystemExtraField
from app.services.derived_fields import evaluate_formula

router = APIRouter()

# Cache TTL in seconds (5 minutes - extra fields rarely change)
_EXTRA_FIELDS_CACHE_TTL = 300


def _invalidate_extra_fields_cache(
    target_type: str | None = None, source: str | None = None
) -> None:
    """Invalidate extra fields cache entries.

    If target_type/source provided, invalidates specific entries.
    Otherwise invalidates all extra_fields cache entries.
    """
    if target_type:
        response_cache.delete(f"extra_fields:{target_type}:{source or 'all'}")
        response_cache.delete(f"extra_fields:{target_type}:all")
    # Always invalidate the "all" queries
    response_cache.delete("extra_fields:all:all")


@router.get("", response_model=list[SystemExtraFieldResponse])
async def get_system_extra_fields(
    principal: PrincipalDep,
    target_type: str | None = None,
    source: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    # Build cache key based on query parameters
    cache_key = f"extra_fields:{target_type or 'all'}:{source or 'all'}"
    cached = response_cache.get(cache_key)
    if cached is not None:
        return cached

    query = select(SystemExtraField)
    if target_type:
        query = query.where(SystemExtraField.target_type == target_type)
    if source:
        query = query.where(SystemExtraField.source == source)
    result = await db.execute(query)
    items = result.scalars().all()

    # Serialize and cache (ORM objects can't be pickled after session closes)
    serialized = [SystemExtraFieldResponse.model_validate(f) for f in items]
    response_cache.set(cache_key, serialized, ttl=_EXTRA_FIELDS_CACHE_TTL)
    return serialized


@router.post(
    "",
    response_model=SystemExtraFieldResponse,
    dependencies=[RequirePermission("admin:system")],
)
async def create_system_extra_field(
    field: SystemExtraFieldCreate,
    db: AsyncSession = Depends(get_db),
):
    query = select(SystemExtraField).where(
        SystemExtraField.target_type == field.target_type,
        SystemExtraField.key == field.key,
    )
    existing = await db.execute(query)
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Field with this key already exists for this target type",
        )

    # Validate formula if provided
    if field.formula is not None:
        _validate_formula(field.formula)

    new_field = SystemExtraField(**field.model_dump())
    db.add(new_field)
    await db.commit()
    await db.refresh(new_field)

    # Invalidate cache for this target_type
    _invalidate_extra_fields_cache(new_field.target_type, new_field.source)
    return new_field


@router.put(
    "/{field_id}",
    response_model=SystemExtraFieldResponse,
    dependencies=[RequirePermission("admin:system")],
)
async def update_system_extra_field(
    field_id: int,
    update_data: SystemExtraFieldUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a user-created extra field. Plugin-managed fields cannot be edited."""
    query = select(SystemExtraField).where(SystemExtraField.id == field_id)
    result = await db.execute(query)
    field = result.scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    if field.source:
        raise HTTPException(
            status_code=403,
            detail=f"Cannot edit plugin-managed field (source: {field.source}). Plugin fields are read-only.",
        )

    # Apply updates (only non-None values)
    update_dict = update_data.model_dump(exclude_unset=True)

    # Validate formula if being updated
    if "formula" in update_dict and update_dict["formula"] is not None:
        _validate_formula(update_dict["formula"])

    for key, value in update_dict.items():
        setattr(field, key, value)

    await db.commit()
    await db.refresh(field)

    # Invalidate cache for this target_type
    _invalidate_extra_fields_cache(field.target_type, field.source)
    return field


@router.delete(
    "/{field_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[RequirePermission("admin:system")],
)
async def delete_system_extra_field(
    field_id: int,
    db: AsyncSession = Depends(get_db),
):
    query = select(SystemExtraField).where(SystemExtraField.id == field_id)
    result = await db.execute(query)
    field = result.scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    if field.source:
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete plugin-managed field (source: {field.source}). Uninstall the plugin to remove its fields.",
        )

    # Reference protection: block deletion if any formula field references this key
    if field.formula is None:
        formula_refs = await db.execute(
            select(SystemExtraField).where(
                SystemExtraField.target_type == field.target_type,
                SystemExtraField.formula.is_not(None),
            )
        )
        referencing = [
            f.key
            for f in formula_refs.scalars().all()
            if f.formula and _key_in_formula(field.key, f.formula)
        ]
        if referencing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "formula_reference",
                    "message": f"Cannot delete field '{field.key}' — referenced by formula fields: {referencing}",
                    "referencing_fields": referencing,
                },
            )

    # Store for cache invalidation before deletion
    target_type = field.target_type
    source = field.source

    await db.delete(field)
    await db.commit()

    # Invalidate cache
    _invalidate_extra_fields_cache(target_type, source)


# ---------------------------------------------------------------------------
# Formula utilities
# ---------------------------------------------------------------------------

def _validate_formula(formula: dict) -> None:
    """Raise HTTP 400 if the formula is not a non-empty dict or fails a dry-run."""
    if not formula:
        raise HTTPException(status_code=400, detail="Formula must be a non-empty JSON Logic object")
    # Dry-run with empty context to catch obvious syntax errors
    result = evaluate_formula(formula, {})
    # None is fine (missing context data); any non-exception result is valid
    _ = result


def _key_in_formula(key: str, formula: object) -> bool:
    """Recursively check if *key* appears as a string value anywhere in *formula*."""
    if isinstance(formula, str):
        return formula == key
    if isinstance(formula, list):
        return any(_key_in_formula(key, item) for item in formula)
    if isinstance(formula, dict):
        return any(_key_in_formula(key, v) for v in formula.values())
    return False


@router.post(
    "/preview",
    response_model=FormulaPreviewResponse,
    dependencies=[RequirePermission("admin:system")],
)
async def preview_formula(body: FormulaPreviewRequest) -> FormulaPreviewResponse:
    """Evaluate a JSON Logic formula against a sample context and return the result."""
    try:
        result = evaluate_formula(body.formula, body.context)
        return FormulaPreviewResponse(result=result)
    except Exception as exc:
        return FormulaPreviewResponse(result=None, error=str(exc))
