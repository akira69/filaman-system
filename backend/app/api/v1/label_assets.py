from datetime import datetime

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DBSession, PrincipalDep
from app.api.v1.label_presets import _require_user_id
from app.models import LabelAsset, LabelPresetAsset
from app.services.label_asset_service import (
    MAX_INPUT_IMAGE_BYTES,
    LabelAssetLimitError,
    LabelAssetValidationError,
    cleanup_orphaned_label_assets,
    create_label_asset,
)

router = APIRouter(prefix="/me/label-assets", tags=["me"])


class LabelAssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    sha256: str
    media_type: str
    width: int
    height: int
    byte_size: int
    orphaned_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "label_asset_not_found", "message": "Label image not found"},
    )


@router.get("", response_model=list[LabelAssetResponse])
async def list_label_assets(db: DBSession, principal: PrincipalDep):
    user_id = _require_user_id(principal)
    result = await db.execute(
        select(LabelAsset)
        .where(LabelAsset.user_id == user_id)
        .order_by(LabelAsset.created_at, LabelAsset.id)
    )
    return list(result.scalars())


@router.post("", response_model=LabelAssetResponse)
async def upload_label_asset(
    db: DBSession,
    principal: PrincipalDep,
    file: UploadFile = File(...),
):
    user_id = _require_user_id(principal)
    content = await file.read(MAX_INPUT_IMAGE_BYTES + 1)
    try:
        await cleanup_orphaned_label_assets(db)
        asset, _created = await create_label_asset(
            db,
            user_id,
            file.filename or "Label image.png",
            content,
        )
        await db.commit()
        await db.refresh(asset)
        return asset
    except (LabelAssetValidationError, LabelAssetLimitError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "invalid_label_asset", "message": str(exc)},
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "label_asset_conflict",
                "message": "Label images changed concurrently; retry the upload",
            },
        ) from exc
    finally:
        await file.close()


@router.get("/{asset_id}/content")
async def get_label_asset_content(
    asset_id: str,
    db: DBSession,
    principal: PrincipalDep,
):
    asset = await db.scalar(
        select(LabelAsset).where(
            LabelAsset.id == asset_id,
            LabelAsset.user_id == _require_user_id(principal),
        )
    )
    if asset is None:
        raise _not_found()
    return Response(
        content=asset.content,
        media_type=asset.media_type,
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{asset.sha256}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label_asset(
    asset_id: str,
    db: DBSession,
    principal: PrincipalDep,
):
    asset = await db.scalar(
        select(LabelAsset).where(
            LabelAsset.id == asset_id,
            LabelAsset.user_id == _require_user_id(principal),
        )
    )
    if asset is None:
        raise _not_found()
    reference_count = await db.scalar(
        select(func.count())
        .select_from(LabelPresetAsset)
        .where(LabelPresetAsset.asset_id == asset.id)
    )
    if reference_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "label_asset_in_use",
                "message": "This image is still used by a label preset",
            },
        )
    await db.delete(asset)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
