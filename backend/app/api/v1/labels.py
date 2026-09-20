"""Spool labels for clients that cannot run the browser label designer."""

import re
from datetime import datetime, timedelta, timezone
from io import BytesIO
from math import isfinite
from typing import Literal
from urllib.parse import urlsplit

import qrcode
from fastapi import APIRouter, HTTPException, Query, Request, Response
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import delete, select, update
from sqlalchemy.orm import undefer

from app.api.deps import DBSession, RequirePermission
from app.core.config import MANUFACTURER_LOGO_DIR
from app.models import Color, FilamentColor, LabelAsset, LabelPreset, LabelPrintRequest
from app.services.label_v2_renderer import render_v2_label
from app.services.spool_service import SpoolService

router = APIRouter(prefix="/labels", tags=["labels"])


@router.post("/spool/{spool_id}/print-request", status_code=201)
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


@router.get("/print-requests/pending")
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
    claimed = await db.scalar(
        update(LabelPrintRequest)
        .where(
            LabelPrintRequest.id == request_id,
            LabelPrintRequest.user_id == principal.user_id,
            LabelPrintRequest.claimed_at.is_(None),
            LabelPrintRequest.created_at >= datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        .values(claimed_at=datetime.now(timezone.utc))
        .returning(LabelPrintRequest.id)
    )
    if claimed is None:
        raise HTTPException(status_code=409, detail="Print request already claimed or missing")
    await db.commit()
    return Response(status_code=204)


@router.get("/presets")
async def list_scale_presets(
    db: DBSession,
    principal=RequirePermission("spools:read"),
):
    if principal.user_id is None:
        raise HTTPException(status_code=403, detail="Use a user API key to select label presets")
    rows = await db.execute(
        select(LabelPreset.id, LabelPreset.name)
        .where(LabelPreset.user_id == principal.user_id, LabelPreset.preset_type == "spool")
        .order_by(LabelPreset.name)
    )
    return [{"id": preset_id, "name": name} for preset_id, name in rows]


def _label_size(settings: dict | None) -> tuple[float, float]:
    raw = (settings or {}).get("label") or {}
    return _number(raw.get("width"), 60, 20, 300), _number(raw.get("height"), 40, 10, 200)


def _label_values(spool, colors: list[str]) -> dict[str, str]:
    filament = spool.filament

    def value(item) -> str:
        return "" if item is None else str(item)

    def date(item) -> str:
        return item.date().isoformat() if item else ""

    values = {
        "id": value(spool.id),
        "filament.id": value(spool.filament_id),
        "filament.name": value(filament.designation),
        "filament.manufacturer": value(filament.manufacturer.name),
        "filament.type": value(filament.material_type),
        "filament.material": value(filament.material_type),
        "filament.subtype": value(getattr(filament, "material_subgroup", None)),
        "filament.color": value(filament.manufacturer_color_name),
        "filament.manufacturer_color_name": value(filament.manufacturer_color_name),
        "filament.color_hex": colors[0] if colors else "",
        "filament.color_hexes": ",".join(colors),
        "filament.weight": value(getattr(filament, "raw_material_weight_g", None)),
        "filament.diameter": value(filament.diameter_mm),
        "remaining_weight_g": value(round(spool.remaining_weight_g)) if spool.remaining_weight_g is not None else "",
        "stocked_in_at": date(getattr(spool, "stocked_in_at", None)),
        "lot_number": value(getattr(spool, "lot_number", None)),
        "external_id": value(getattr(spool, "external_id", None)),
        "rfid_uid": value(getattr(spool, "rfid_uid", None)),
    }
    for source, fields in (("filament", filament.custom_fields), ("spool", spool.custom_fields)):
        if isinstance(fields, dict):
            values.update({f"extra.{source}.{key}": value(item) for key, item in fields.items()})
    return values


def _resolve_label_text(template: str, values: dict[str, str]) -> str:
    resolved = re.sub(r"\{([\w.]+)\}", lambda match: values.get(match[1], ""), template.replace("\\n", "\n"))
    return re.sub(r"\*\*|==|__|@@", "", resolved)


def _label_image(
    spool, width: int, qr_url: str, settings: dict | None = None,
    colors: list[str] | None = None, colored: bool = False,
) -> Image.Image:
    width_mm, height_mm = _label_size(settings)
    height = round(width * height_mm / width_mm)
    if height > 2048:
        raise HTTPException(status_code=422, detail="Preset is too tall for the requested width")
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    margin = max(8, width // 40)
    colors = colors or []

    if settings is not None:
        # ponytail: common designer sections cover scale labels; port inline
        # markup if exact browser parity becomes necessary.
        label = settings.get("label") or {}
        margin = max(0, round(width * _number(label.get("marginMm"), 1, 0, 6) / width_mm))
        if label.get("border"):
            draw.rectangle((margin, margin, width - margin - 1, height - margin - 1), outline="black", width=2)
        inset = margin + max(4, width // 100)
        qr_cfg = settings.get("qr") or {}
        qr_show = qr_cfg.get("show", True) is not False
        qr_size = min(height - inset * 2, round(width * _number(qr_cfg.get("sizeMm"), 18, 3, 80) / width_mm)) if qr_show else 0
        qr_left = qr_cfg.get("position") == "left"
        text_x = inset + qr_size + inset if qr_left and qr_show else inset
        text_width = max(1, width - qr_size - inset * 3) if qr_show else width - inset * 2
        values = _label_values(spool, colors)

        def resolved(template: str) -> str:
            return _resolve_label_text(template, values)

        def section(config: dict, default: str, fallback_mm: float, bold: bool = False) -> None:
            nonlocal y
            if config.get("show", True) is False:
                return
            template = str(config.get("template", default))[:8000]
            size = max(10, round(width * _number(config.get("sizeMm"), fallback_mm, 1, 20) / width_mm))
            if config.get("dividerAbove"):
                draw.line((text_x, y, text_x + text_width, y), fill="black", width=2)
                y += max(3, size // 4)
            for raw_line in resolved(template).splitlines():
                has_swatch = "{color_swatch" in raw_line
                text_line = re.sub(r"\{color_swatch\[\d+\]\}", "", raw_line).strip(" *_")
                font_size = size
                font = ImageFont.load_default(size=font_size)
                if config.get("fitToWidth", True):
                    while font_size > 10 and draw.textlength(text_line, font=font) > text_width:
                        font_size -= 1
                        font = ImageFont.load_default(size=font_size)
                if draw.textlength(text_line, font=font) > text_width:
                    while text_line and draw.textlength(text_line + "…", font=font) > text_width:
                        text_line = text_line[:-1]
                    text_line += "…"
                if text_line:
                    align = config.get("align", config.get("hAlign", "left"))
                    offset = max(0, round((text_width - draw.textlength(text_line, font=font)) * (0.5 if align == "center" else 1 if align == "right" else 0)))
                    draw.text((text_x + offset, y), text_line, fill="black", font=font, stroke_width=1 if bold else 0)
                if has_swatch and colors:
                    swatch_y = y + (font_size if text_line else 0)
                    segment = max(1, min(text_width, width // 4) // len(colors))
                    for index, hex_code in enumerate(colors):
                        draw.rectangle((text_x + index * segment, swatch_y, text_x + (index + 1) * segment - 1, swatch_y + max(6, size // 2)), fill=hex_code if colored else "black")
                    y = swatch_y + max(6, size // 2)
                else:
                    y += font_size + max(2, size // 6)
                if y >= height - inset:
                    break
            if config.get("dividerBelow") and y < height - inset:
                draw.line((text_x, y, text_x + text_width, y), fill="black", width=2)
                y += max(3, size // 4)

        y = inset
        if (settings.get("logo") or {}).get("show", True):
            logo_cfg = settings.get("logo") or {}
            logo_path = MANUFACTURER_LOGO_DIR / f"{spool.filament.manufacturer_id}_label.png"
            try:
                if logo_path.stat().st_size > 2_000_000:
                    raise OSError("Logo is too large")
                with Image.open(logo_path) as source:
                    logo = source.convert("RGB" if colored else "L").convert("RGB")
                    logo.thumbnail((text_width, round(width * _number(logo_cfg.get("spaceMm"), 6, 2, 20) / width_mm)))
                align = logo_cfg.get("align", "left")
                offset = (text_width - logo.width) // (2 if align == "center" else 1) if align in {"center", "right"} else 0
                image.paste(logo, (text_x + offset, y))
                y += logo.height + max(3, width // 100)
            except OSError:
                section({"template": "{filament.manufacturer}", "sizeMm": 3}, "", 3)
        section(settings.get("title") or {}, "{filament.name}", 4, True)
        section(settings.get("title2") or {"show": False}, "", 3.5, True)
        section(settings.get("info") or {}, "{filament.type}\n{filament.color}", 2.5)
        section(settings.get("info2") or {"show": False}, "", 2.5)
        if qr_show and qr_size > 0:
            target = qr_url
            if qr_cfg.get("linkMode") == "url":
                candidate = resolved(str(qr_cfg.get("urlTemplate", ""))).strip()
                try:
                    base = urlsplit(candidate)
                    if base.scheme in {"http", "https"} and base.hostname:
                        origin = base.netloc.rsplit("@", 1)[-1]
                        target = f"{base.scheme}://{origin}{base.path.rstrip('/')}/spools/{spool.id}"
                except ValueError:
                    pass
            qr = qrcode.make(target).convert("RGB").resize((qr_size, qr_size), Image.Resampling.NEAREST)
            image.paste(qr, (inset if qr_left else width - qr_size - inset, height - qr_size - inset))
        return image

    qr_size = height // 2
    text_width = width - qr_size - margin * 3

    def line(value: str, y: int, size: int) -> int:
        while size > 12:
            font = ImageFont.load_default(size=size)
            if draw.textlength(value, font=font) <= text_width:
                break
            size -= 2
        font = ImageFont.load_default(size=size)
        if draw.textlength(value, font=font) > text_width:
            while value and draw.textlength(value + "…", font=font) > text_width:
                value = value[:-1]
            value += "…"
        draw.text((margin, y), value, fill="black", font=font)
        return y + size + max(3, width // 100)

    filament = spool.filament
    y = margin
    y = line(filament.manufacturer.name, y, width // 20)
    y = line(filament.designation, y, width // 16)
    y = line(filament.material_type, y, width // 22)
    if filament.manufacturer_color_name:
        y = line(filament.manufacturer_color_name, y, width // 24)
    if spool.remaining_weight_g is not None:
        line(f"{round(spool.remaining_weight_g)} g remaining", y, width // 26)
    if colors:
        swatch_width = min(text_width, width // 4)
        segment = max(1, swatch_width // len(colors))
        for index, hex_code in enumerate(colors):
            draw.rectangle((margin + index * segment, y, margin + (index + 1) * segment - 1, y + max(8, width // 50)), fill=hex_code if colored else "black")

    draw.line((margin, height - margin * 3, width - margin, height - margin * 3), fill="black", width=2)
    draw.text((margin, height - margin * 2 - width // 35), f"Spool #{spool.id}", fill="black", font=ImageFont.load_default(size=width // 35))
    qr = qrcode.make(qr_url).convert("RGB").resize((qr_size, qr_size), Image.Resampling.NEAREST)
    image.paste(qr, (width - qr_size - margin, margin))
    return image


def _number(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return min(high, max(low, number)) if isfinite(number) else default


def _mono1(image: Image.Image) -> bytes:
    width, height = image.size
    row_bytes = (width + 7) // 8
    packed = bytearray(image.convert("1", dither=Image.Dither.FLOYDSTEINBERG).tobytes())
    for index in range(len(packed)):
        packed[index] ^= 0xFF  # PIL stores white as 1; the wire format uses black as 1.
    if width % 8:
        mask = (0xFF << (8 - width % 8)) & 0xFF
        for row in range(height):
            packed[row * row_bytes + row_bytes - 1] &= mask
    return bytes(packed)


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
    preset_id: int | None = Query(None, ge=1),
    color: Literal["mono", "color"] = "mono",
    principal=RequirePermission("spools:read"),
):
    if format == "mono1" and color == "color":
        raise HTTPException(status_code=422, detail="mono1 is always monochrome")
    spool = await SpoolService(db).get_spool(spool_id)
    if spool is None:
        raise HTTPException(status_code=404, detail="Spool not found")
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
        if preset.data.get("version") == 2:
            design = preset.data.get("design")
            if not isinstance(design, dict) or not isinstance(design.get("label"), dict):
                raise HTTPException(status_code=422, detail="Preset design is invalid")
            elements = design.get("elements")
            if not isinstance(elements, list):
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
        else:
            settings = preset.data.get("settings")
            if not isinstance(settings, dict) or any(
                key in settings and not isinstance(settings[key], dict)
                for key in ("label", "logo", "title", "title2", "info", "info2", "qr")
            ):
                raise HTTPException(status_code=422, detail="Preset settings are invalid")
    color_rows = await db.scalars(
        select(Color.hex_code)
        .join(FilamentColor, FilamentColor.color_id == Color.id)
        .where(FilamentColor.filament_id == spool.filament_id)
        .order_by(FilamentColor.position)
    )
    colors = [hex_code[:7] for hex_code in color_rows]
    width_mm = design["label"].get("widthMm") if design is not None else _label_size(settings)[0]
    if design is not None and (not isinstance(width_mm, (int, float)) or not isfinite(width_mm) or width_mm < 20 or width_mm > 300):
        raise HTTPException(status_code=422, detail="Preset design has invalid dimensions")
    label_width = round(width_mm * dpi / 25.4) if dpi else width
    if label_width > width:
        raise HTTPException(status_code=422, detail="Label is wider than the requested print area")
    qr_url = str(request.base_url).rstrip("/") + f"/spools/{spool_id}"
    image = render_v2_label(
        design, label_width, _label_values(spool, colors), colors, qr_url,
        MANUFACTURER_LOGO_DIR / f"{spool.filament.manufacturer_id}_label.png",
        assets, color == "color",
    ) if design is not None else _label_image(
        spool, label_width, qr_url, settings, colors, color == "color",
    )
    rotated = (
        orientation == "landscape" and image.height > image.width
    ) or (
        orientation == "portrait" and image.width > image.height
    )
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
        "X-Image-Width": str(image.width),
        "X-Image-Height": str(image.height),
        "X-Content-Width": str(label_width),
        "X-Rotated": "1" if rotated else "0",
        "X-Row-Bytes": str((image.width + 7) // 8),
        "X-Bit-Order": "msb-black-1",
    }
    if format == "mono1":
        return Response(_mono1(image), media_type="application/octet-stream", headers=headers)
    output = BytesIO()
    image.save(output, format="PNG")
    return Response(output.getvalue(), media_type="image/png", headers=headers)
