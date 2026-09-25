"""Spool labels for clients that cannot run the browser label designer."""

from collections import Counter
from datetime import datetime, timedelta, timezone
from io import BytesIO
from math import isfinite
from typing import Literal

from anyio import to_thread
from fastapi import APIRouter, HTTPException, Query, Request, Response
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.orm import selectinload, undefer

from app.api.deps import DBSession, RequirePermission
from app.api.v1.schemas_spool import SpoolResponse
from app.api.v1.schemas_system_extra_field import SystemExtraFieldResponse
from app.core.config import MANUFACTURER_LOGO_DIR
from app.models import (
    Filament,
    FilamentColor,
    LabelAsset,
    LabelPreset,
    LabelPrintRequest,
    Spool,
    SystemExtraField,
)
from app.services.label_asset_service import (
    MAX_IMAGE_PIXELS,
    LabelAssetValidationError,
    canonicalize_label_image,
    validate_canonical_label_image,
)
from app.services.label_preview_browser import label_render_slot, render_preview_png
from app.services.spool_service import SpoolService

router = APIRouter(prefix="/labels", tags=["labels"])


class LabelPrintRequestResponse(BaseModel):
    id: int
    spool_id: int
    preset_id: int | None


class ScaleLabelPresetResponse(BaseModel):
    id: int
    name: str
    selected: bool


@router.post("/spool/{spool_id}/print-request", status_code=201, response_model=LabelPrintRequestResponse)
async def request_pc_print(
    spool_id: int,
    db: DBSession,
    preset_id: int | None = Query(None, ge=1),
    principal=RequirePermission("spools:read"),
):
    if principal.user_id is None:
        raise HTTPException(status_code=403, detail="Use a user API key for PC print requests")
    if await SpoolService(db).get_spool(spool_id) is None:
        raise HTTPException(status_code=404, detail="Spool not found")
    if preset_id is not None and await db.scalar(
        select(LabelPreset.id).where(
            LabelPreset.id == preset_id,
            LabelPreset.user_id == principal.user_id,
            LabelPreset.preset_type == "spool",
        )
    ) is None:
        raise HTTPException(status_code=404, detail="Label preset not found")
    await db.execute(
        delete(LabelPrintRequest).where(
            LabelPrintRequest.created_at < datetime.now(timezone.utc) - timedelta(minutes=5)
        )
    )
    print_request = LabelPrintRequest(spool_id=spool_id, user_id=principal.user_id, preset_id=preset_id)
    db.add(print_request)
    await db.commit()
    await db.refresh(print_request)
    return {"id": print_request.id, "spool_id": spool_id, "preset_id": preset_id}


@router.get("/print-requests/pending", response_model=LabelPrintRequestResponse | None)
async def pending_pc_print(
    db: DBSession,
    principal=RequirePermission("spools:read"),
):
    if principal.user_id is None:
        raise HTTPException(status_code=403, detail="Use a user session for PC print prompts")
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    print_request = await db.scalar(
        select(LabelPrintRequest)
        .where(
            LabelPrintRequest.user_id == principal.user_id,
            LabelPrintRequest.claimed_at.is_(None),
            LabelPrintRequest.created_at >= cutoff,
        )
        .order_by(LabelPrintRequest.id)
        .limit(1)
    )
    if print_request is None:
        return None
    return {"id": print_request.id, "spool_id": print_request.spool_id, "preset_id": print_request.preset_id}


@router.post("/print-requests/{request_id}/claim", status_code=204)
async def claim_pc_print(
    request_id: int,
    db: DBSession,
    principal=RequirePermission("spools:read"),
):
    if principal.user_id is None:
        raise HTTPException(status_code=403, detail="Use a user session for PC print prompts")
    claimed = await db.execute(
        update(LabelPrintRequest)
        .where(
            LabelPrintRequest.id == request_id,
            LabelPrintRequest.user_id == principal.user_id,
            LabelPrintRequest.claimed_at.is_(None),
            LabelPrintRequest.created_at >= datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        .values(claimed_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        raise HTTPException(status_code=409, detail="Print request already claimed or missing")
    await db.commit()
    return Response(status_code=204)


@router.get("/presets", response_model=list[ScaleLabelPresetResponse])
async def list_scale_presets(
    db: DBSession,
    principal=RequirePermission("spools:read"),
):
    if principal.user_id is None:
        raise HTTPException(status_code=403, detail="Use a user API key to select label presets")
    rows = await db.execute(
        select(LabelPreset.id, LabelPreset.name, LabelPreset.selected_at)
        .where(LabelPreset.user_id == principal.user_id, LabelPreset.preset_type == "spool")
        .order_by(LabelPreset.name)
    )
    rows = list(rows)
    marked = [row for row in rows if row.selected_at is not None]
    selected_id = (
        max(marked, key=lambda row: (row.selected_at, row.id)).id
        if marked
        else None
    )
    return [
        {"id": row.id, "name": row.name, "selected": row.id == selected_id}
        for row in rows
    ]


def _label_size(settings: dict | None) -> tuple[float, float]:
    raw = (settings or {}).get("label") or {}
    return _number(raw.get("width", 60), 60, 20, 300), _number(raw.get("height", 40), 40, 10, 200)


def _number(value, default: float, low: float, high: float) -> float:
    try:
        # Match the legacy preview: explicit null/empty values become zero.
        number = 0 if value is None or isinstance(value, str) and not value.strip() else float(value)
    except (TypeError, ValueError):
        return default
    return min(high, max(low, number)) if isfinite(number) else default


def _mono1(image: Image.Image) -> bytes:
    width, height = image.size
    row_bytes = (width + 7) // 8
    # PIL stores white as 1; the wire format uses black as 1.
    packed = bytearray(image.convert("1", dither=Image.Dither.FLOYDSTEINBERG).tobytes().translate(bytes(range(255, -1, -1))))
    if width % 8:
        mask = (0xFF << (8 - width % 8)) & 0xFF
        for row in range(height):
            packed[row * row_bytes + row_bytes - 1] &= mask
    return bytes(packed)


def _preview_images(assets: dict[str, bytes], logo_path, image_uses: Counter, qr_count: int):
    # ponytail: reserve the shared renderer's maximum 1024² canvas per QR;
    # use exact normalized sizes only if this conservative ceiling becomes limiting.
    pixels = qr_count * 1024 * 1024
    limit_error = "Label images and QR codes exceed the combined 12 megapixel render limit"
    for path, content in assets.items():
        image = validate_canonical_label_image(content)
        # Capture embeds each occurrence, even when its source URL is reused.
        pixels += image.width * image.height * image_uses[path]
    if pixels > MAX_IMAGE_PIXELS:
        raise LabelAssetValidationError(limit_error)
    logo_url = None
    if logo_path is not None:
        try:
            with logo_path.open("rb") as source:
                content = source.read(2_000_001)
        except FileNotFoundError:
            content = None
        if content is not None:
            if len(content) > 2_000_000:
                raise LabelAssetValidationError("Manufacturer logo exceeds 2 MB")
            logo = canonicalize_label_image(content)
            logo_url = "/__label-assets/manufacturer.png"
            pixels += logo.width * logo.height * image_uses[logo_url]
            if pixels > MAX_IMAGE_PIXELS:
                raise LabelAssetValidationError(limit_error)
            assets[logo_url] = logo.content
    return assets, logo_url


def _raster_response(png, label_width, label_height, width, rotated, align, format, color, preset_id):
    with Image.open(BytesIO(png)) as source:
        if source.width > 2048 or source.height > 2048:
            raise HTTPException(status_code=422, detail="Rendered label exceeds the image limit")
        image = source.convert("RGB")
    # CSS millimetres round to fractional pixels; make the wire dimensions exact.
    if image.size != (label_width, label_height):
        image = image.resize((label_width, label_height), Image.Resampling.LANCZOS)
    if color == "mono":
        image = image.convert("L").convert("RGB")
    if rotated:
        image = image.transpose(Image.Transpose.ROTATE_90)
        label_width = image.width
    if label_width > width:
        raise HTTPException(status_code=422, detail="Label is wider than the requested print area")
    if label_width < width:
        canvas = Image.new("RGB", (width, image.height), "white")
        canvas.paste(image, (width - label_width if align == "right" else 0, 0))
        image = canvas
    headers = {
        "Cache-Control": "no-store",
        "X-Preset-Id": str(preset_id or 0),
        "X-Image-Width": str(image.width),
        "X-Image-Height": str(image.height),
        "X-Content-Width": str(label_width),
        "X-Rotated": "1" if rotated else "0",
    }
    if format == "mono1":
        headers.update({"X-Row-Bytes": str((image.width + 7) // 8), "X-Bit-Order": "msb-black-1"})
        return Response(_mono1(image), media_type="application/octet-stream", headers=headers)
    output = BytesIO()
    image.save(output, format="PNG")
    return Response(output.getvalue(), media_type="image/png", headers=headers)


@router.get("/spool/{spool_id}/render", response_class=Response, responses={
    200: {"content": {"image/png": {}, "application/octet-stream": {}}, "description": "Rendered label image"},
})
async def render_spool_label(
    spool_id: int,
    request: Request,
    db: DBSession,
    format: Literal["png", "mono1"] = "png",
    width: int = Query(576, ge=384, le=1024),
    dpi: int | None = Query(None, ge=100, le=600),
    align: Literal["left", "right"] = "left",
    orientation: Literal["original", "landscape", "portrait"] = "original",
    preset_id: int | None = Query(None, ge=0, description="Omit for the selected preset; 0 uses Default for this request"),
    color: Literal["mono", "color"] = "mono",
    principal=RequirePermission("spools:read"),
):
    if format == "mono1" and color == "color":
        raise HTTPException(status_code=422, detail="mono1 is always monochrome")
    async with label_render_slot():
        spool = await db.scalar(select(Spool).where(Spool.id == spool_id).options(
            selectinload(Spool.filament).selectinload(Filament.manufacturer),
            selectinload(Spool.filament).selectinload(Filament.filament_colors).selectinload(FilamentColor.color),
            selectinload(Spool.status), selectinload(Spool.location),
        ))
        if spool is None:
            raise HTTPException(status_code=404, detail="Spool not found")
        if preset_id is None and principal.user_id is not None:
            preset_id = await db.scalar(
                select(LabelPreset.id)
                .where(
                    LabelPreset.user_id == principal.user_id,
                    LabelPreset.preset_type == "spool",
                    LabelPreset.selected_at.is_not(None),
                )
                .order_by(LabelPreset.selected_at.desc(), LabelPreset.id.desc())
                .limit(1)
            )
        preset_id = preset_id or None
        preset_data = None
        settings = None
        design = None
        assets = {}
        if preset_id is not None:
            if principal.user_id is None:
                raise HTTPException(status_code=403, detail="Use a user API key to select label presets")
            preset = await db.scalar(
                select(LabelPreset).where(
                    LabelPreset.id == preset_id,
                    LabelPreset.user_id == principal.user_id,
                    LabelPreset.preset_type == "spool",
                )
            )
            if preset is None:
                raise HTTPException(status_code=404, detail="Label preset not found")
            preset_data = preset.data
            if preset.data.get("version") == 2:
                design = preset.data.get("design")
                if not isinstance(design, dict) or not isinstance(design.get("label"), dict):
                    raise HTTPException(status_code=422, detail="Preset design is invalid")
                elements = design.get("elements")
                if not isinstance(elements, list) or len(elements) > 100 or any(not isinstance(element, dict) for element in elements):
                    raise HTTPException(status_code=422, detail="Preset design is invalid")
                asset_ids = set()
                for element in elements:
                    if isinstance(element, dict) and element.get("type") == "image":
                        asset_id = element.get("assetId")
                        if not isinstance(asset_id, str) or not asset_id or len(asset_id) > 120:
                            raise HTTPException(status_code=422, detail="Preset image is unavailable")
                        asset_ids.add(asset_id)
                if asset_ids:
                    rows = await db.scalars(
                        select(LabelAsset).options(undefer(LabelAsset.content)).where(
                            LabelAsset.id.in_(asset_ids), LabelAsset.user_id == principal.user_id,
                        )
                    )
                    assets = {asset.id: asset.content for asset in rows}
                    if set(assets) != asset_ids:
                        raise HTTPException(status_code=422, detail="Preset image is unavailable")
            else:
                settings = preset.data.get("settings")
                if not isinstance(settings, dict) or any(
                    key in settings and not isinstance(settings[key], dict)
                    for key in ("label", "logo", "title", "title2", "info", "info2", "qr")
                ):
                    raise HTTPException(status_code=422, detail="Preset settings are invalid")
        if design is not None:
            width_mm, height_mm = (design["label"].get(key) for key in ("widthMm", "heightMm"))
            if any(not isinstance(value, (int, float)) or not isfinite(value) or not low <= value <= high
                   for value, low, high in ((width_mm, 20, 300), (height_mm, 10, 200))):
                raise HTTPException(status_code=422, detail="Preset design has invalid dimensions")
        else:
            width_mm, height_mm = _label_size(settings)
        label_width = round(width_mm * dpi / 25.4) if dpi else width
        label_height = round(label_width * height_mm / width_mm)
        rotated = (
            orientation == "landscape" and label_height > label_width
        ) or (
            orientation == "portrait" and label_width > label_height
        )
        content_width, content_height = (label_height, label_width) if rotated else (label_width, label_height)
        if content_width > width:
            raise HTTPException(status_code=422, detail="Label is wider than the requested print area")
        if content_height > 2048:
            raise HTTPException(status_code=422, detail="Preset is too tall for the requested width")
        asset_urls = {asset_id: f"/__label-assets/{index}.png" for index, asset_id in enumerate(assets)}
        assets = {asset_urls[asset_id]: content for asset_id, content in assets.items()}
        if design is not None:
            image_uses = Counter(
                asset_urls[element["assetId"]] if element["type"] == "image" else "/__label-assets/manufacturer.png"
                for element in design["elements"] if element.get("type") in ("image", "manufacturerLogo")
            )
            qr_count = sum(element.get("type") == "qr" for element in design["elements"])
        else:
            image_uses = Counter({"/__label-assets/manufacturer.png": int((settings or {}).get("logo", {}).get("show", True) is not False)})
            qr_count = int((settings or {}).get("qr", {}).get("show", True) is not False)
        logo_path = MANUFACTURER_LOGO_DIR / f"{spool.filament.manufacturer_id}_label.png" if image_uses["/__label-assets/manufacturer.png"] else None
        try:
            assets, logo_url = await to_thread.run_sync(_preview_images, assets, logo_path, image_uses, qr_count)
        except (LabelAssetValidationError, OSError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        definitions = {"spool": {}, "filament": {}}
        for field in await db.scalars(select(SystemExtraField).where(SystemExtraField.target_type.in_(definitions))):
            definitions[field.target_type][field.key] = SystemExtraFieldResponse.model_validate(field).model_dump(mode="json")
        spool_data = SpoolResponse.model_validate(spool).model_dump(mode="json")
        spool_data["status"] = {"label": spool.status.label}
        spool_data["location"] = {"name": spool.location.name} if spool.location else None
        payload = {
            "spool": spool_data, "preset": preset_data, "fieldDefinitions": definitions,
            "assets": asset_urls, "logoUrl": logo_url,
            "pixelWidth": label_width, "pixelHeight": label_height,
        }
        png = await render_preview_png(payload, str(request.base_url).rstrip("/"), assets)
        return await to_thread.run_sync(
            _raster_response, png, label_width, label_height, width, rotated, align, format, color, preset_id,
        )
