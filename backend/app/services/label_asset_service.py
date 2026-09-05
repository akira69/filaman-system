import hashlib
import io
import warnings
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.label_asset import LabelAsset, LabelPresetAsset
from app.models.label_preset import LabelPreset

MAX_INPUT_IMAGE_BYTES = 5 * 1024 * 1024
MAX_CANONICAL_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_IMAGE_DIMENSION = 10_000
MAX_ASSETS_PER_USER = 100
MAX_TOTAL_ASSET_BYTES_PER_USER = 50 * 1024 * 1024
ORPHAN_GRACE_PERIOD = timedelta(days=30)
SUPPORTED_IMAGE_FORMATS = {"PNG", "JPEG", "WEBP"}


class LabelAssetValidationError(ValueError):
    pass


class LabelAssetLimitError(ValueError):
    pass


@dataclass(frozen=True)
class CanonicalLabelImage:
    content: bytes
    media_type: str
    width: int
    height: int
    byte_size: int
    sha256: str


def extract_label_asset_ids(data: dict) -> set[str]:
    """Extract uploaded-image IDs only from the normalized v2 preset shape."""
    if data.get("version") != 2:
        return set()
    design = data.get("design")
    if not isinstance(design, dict) or design.get("version") != 2:
        raise LabelAssetValidationError("The v2 label design is malformed")
    elements = design.get("elements")
    if not isinstance(elements, list):
        raise LabelAssetValidationError("The v2 label element list is malformed")

    asset_ids: set[str] = set()
    for element in elements:
        if not isinstance(element, dict):
            raise LabelAssetValidationError("The v2 label element list is malformed")
        if element.get("type") != "image":
            continue
        asset_id = element.get("assetId")
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise LabelAssetValidationError("An uploaded-image element has no asset ID")
        asset_ids.add(asset_id)
    return asset_ids


def _inspect_image(content: bytes) -> tuple[str, int, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                image_format = str(image.format or "").upper()
                width, height = image.size
                frames = int(getattr(image, "n_frames", 1))
                image.verify()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
    ) as exc:
        raise LabelAssetValidationError("The file is not a valid supported image") from exc
    return image_format, width, height, frames


def canonicalize_label_image(content: bytes) -> CanonicalLabelImage:
    if not content:
        raise LabelAssetValidationError("The image is empty")
    if len(content) > MAX_INPUT_IMAGE_BYTES:
        raise LabelAssetValidationError("Label images cannot exceed 5 MiB")

    image_format, width, height, frames = _inspect_image(content)
    if image_format not in SUPPORTED_IMAGE_FORMATS:
        raise LabelAssetValidationError("Only PNG, JPEG, and WebP images are supported")
    if frames != 1:
        raise LabelAssetValidationError("Animated images are not supported")
    if width <= 0 or height <= 0:
        raise LabelAssetValidationError("Image dimensions must be positive")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise LabelAssetValidationError("Image dimensions are too large")
    if width * height > MAX_IMAGE_PIXELS:
        raise LabelAssetValidationError("Label images cannot exceed 12 megapixels")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                source.load()
                oriented = ImageOps.exif_transpose(source)
                has_alpha = oriented.mode in {"RGBA", "LA"} or (
                    oriented.mode == "P" and "transparency" in oriented.info
                )
                canonical = oriented.convert("RGBA" if has_alpha else "RGB")
                output = io.BytesIO()
                canonical.save(output, format="PNG", optimize=True)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError) as exc:
        raise LabelAssetValidationError("The image could not be decoded safely") from exc

    canonical_content = output.getvalue()
    if len(canonical_content) > MAX_CANONICAL_IMAGE_BYTES:
        raise LabelAssetValidationError("The processed label image exceeds 5 MiB")
    return CanonicalLabelImage(
        content=canonical_content,
        media_type="image/png",
        width=canonical.width,
        height=canonical.height,
        byte_size=len(canonical_content),
        sha256=hashlib.sha256(canonical_content).hexdigest(),
    )


def normalize_asset_display_name(value: str) -> str:
    name = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
    name = "".join(character for character in name if character.isprintable())
    if not name:
        name = "Label image.png"
    return name[:120]


async def create_label_asset(
    db: AsyncSession,
    user_id: int,
    display_name: str,
    content: bytes,
) -> tuple[LabelAsset, bool]:
    canonical = canonicalize_label_image(content)
    existing = await db.scalar(
        select(LabelAsset).where(
            LabelAsset.user_id == user_id,
            LabelAsset.sha256 == canonical.sha256,
        )
    )
    if existing is not None:
        return existing, False

    count, total_bytes = (
        await db.execute(
            select(func.count(LabelAsset.id), func.coalesce(func.sum(LabelAsset.byte_size), 0))
            .where(LabelAsset.user_id == user_id)
        )
    ).one()
    if int(count) >= MAX_ASSETS_PER_USER:
        raise LabelAssetLimitError("Label image limit reached (maximum 100 images)")
    if int(total_bytes) + canonical.byte_size > MAX_TOTAL_ASSET_BYTES_PER_USER:
        raise LabelAssetLimitError("Label image storage limit reached (maximum 50 MiB)")

    asset = LabelAsset(
        id=str(uuid4()),
        user_id=user_id,
        display_name=normalize_asset_display_name(display_name),
        sha256=canonical.sha256,
        media_type=canonical.media_type,
        width=canonical.width,
        height=canonical.height,
        byte_size=canonical.byte_size,
        content=canonical.content,
        orphaned_at=datetime.now(UTC),
    )
    db.add(asset)
    await db.flush()
    return asset, True


async def set_label_preset_asset_references(
    db: AsyncSession,
    preset: LabelPreset,
    asset_ids: set[str],
    *,
    orphaned_at: datetime | None = None,
) -> None:
    requested = set(asset_ids)
    if requested:
        owned_assets = list(
            (
                await db.execute(
                    select(LabelAsset).where(
                        LabelAsset.user_id == preset.user_id,
                        LabelAsset.id.in_(requested),
                    )
                )
            ).scalars()
        )
        if {asset.id for asset in owned_assets} != requested:
            raise LabelAssetValidationError("One or more label images were not found")
    else:
        owned_assets = []

    existing_ids = set(
        (
            await db.execute(
                select(LabelPresetAsset.asset_id).where(
                    LabelPresetAsset.preset_id == preset.id
                )
            )
        ).scalars()
    )
    removed_ids = existing_ids - requested
    added_ids = requested - existing_ids
    if removed_ids:
        await db.execute(
            delete(LabelPresetAsset).where(
                LabelPresetAsset.preset_id == preset.id,
                LabelPresetAsset.asset_id.in_(removed_ids),
            )
        )
    for asset_id in added_ids:
        db.add(
            LabelPresetAsset(
                preset_id=preset.id,
                asset_id=asset_id,
                user_id=preset.user_id,
            )
        )
    for asset in owned_assets:
        asset.orphaned_at = None
    await db.flush()

    if removed_ids:
        now = orphaned_at or datetime.now(UTC)
        still_referenced = set(
            (
                await db.execute(
                    select(LabelPresetAsset.asset_id).where(
                        LabelPresetAsset.asset_id.in_(removed_ids)
                    )
                )
            ).scalars()
        )
        orphan_ids = removed_ids - still_referenced
        if orphan_ids:
            orphan_assets = list(
                (
                    await db.execute(
                        select(LabelAsset).where(
                            LabelAsset.user_id == preset.user_id,
                            LabelAsset.id.in_(orphan_ids),
                        )
                    )
                ).scalars()
            )
            for asset in orphan_assets:
                asset.orphaned_at = now


async def cleanup_orphaned_label_assets(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> int:
    cutoff = (now or datetime.now(UTC)) - ORPHAN_GRACE_PERIOD
    orphan_ids = list(
        (
            await db.execute(
                select(LabelAsset.id).where(
                    LabelAsset.orphaned_at.is_not(None),
                    LabelAsset.orphaned_at <= cutoff,
                    ~exists().where(LabelPresetAsset.asset_id == LabelAsset.id),
                )
            )
        ).scalars()
    )
    if orphan_ids:
        await db.execute(delete(LabelAsset).where(LabelAsset.id.in_(orphan_ids)))
    return len(orphan_ids)
