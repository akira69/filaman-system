import io
from datetime import UTC, datetime, timedelta

import pytest
from PIL import Image, PngImagePlugin
from sqlalchemy import func, select

from app.models import LabelAsset, LabelPreset, LabelPresetAsset
from app.models.label_preset import label_preset_name_key
from app.services.label_asset_service import (
    LabelAssetLimitError,
    LabelAssetValidationError,
    canonicalize_label_image,
    cleanup_orphaned_label_assets,
    create_label_asset,
    set_label_preset_asset_references,
)


def image_bytes(
    image_format: str = "PNG",
    *,
    mode: str = "RGB",
    color=(20, 80, 160),
    size=(24, 12),
    animated: bool = False,
    metadata: bool = False,
) -> bytes:
    image = Image.new(mode, size, color)
    output = io.BytesIO()
    kwargs = {}
    if animated:
        kwargs = {
            "save_all": True,
            "append_images": [Image.new(mode, size, color[::-1])],
            "duration": 100,
            "loop": 0,
        }
    if metadata and image_format == "PNG":
        pnginfo = PngImagePlugin.PngInfo()
        pnginfo.add_text("Comment", "must be stripped")
        kwargs["pnginfo"] = pnginfo
    image.save(output, format=image_format, **kwargs)
    return output.getvalue()


class TestLabelImageCanonicalization:
    @pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
    def test_accepts_supported_formats_and_reencodes_canonical_png(
        self, image_format
    ):
        canonical = canonicalize_label_image(image_bytes(image_format))

        assert canonical.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert canonical.media_type == "image/png"
        assert (canonical.width, canonical.height) == (24, 12)
        assert canonical.byte_size == len(canonical.content)
        assert len(canonical.sha256) == 64

    def test_preserves_transparency_but_strips_metadata(self):
        canonical = canonicalize_label_image(
            image_bytes(
                mode="RGBA",
                color=(20, 80, 160, 90),
                metadata=True,
            )
        )

        with Image.open(io.BytesIO(canonical.content)) as reopened:
            assert reopened.mode == "RGBA"
            assert reopened.getpixel((0, 0))[3] == 90
            assert "Comment" not in reopened.info

    @pytest.mark.parametrize(
        "content",
        [b"not an image", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    )
    def test_rejects_invalid_bytes_and_svg(self, content):
        with pytest.raises(LabelAssetValidationError):
            canonicalize_label_image(content)

    def test_rejects_animation_and_input_or_pixel_limits(self):
        with pytest.raises(LabelAssetValidationError, match="[Aa]nimated"):
            canonicalize_label_image(image_bytes(animated=True))
        with pytest.raises(LabelAssetValidationError, match="5 MiB"):
            canonicalize_label_image(b"x" * (5 * 1024 * 1024 + 1))
        with pytest.raises(LabelAssetValidationError, match="12 megapixels"):
            canonicalize_label_image(image_bytes(size=(4000, 3100)))


class TestLabelAssetPersistence:
    @pytest.mark.asyncio
    async def test_same_user_deduplicates_but_users_remain_isolated(
        self, db_session, admin_user, normal_user
    ):
        content = image_bytes()
        first, first_created = await create_label_asset(
            db_session, admin_user.id, "logo.png", content
        )
        duplicate, duplicate_created = await create_label_asset(
            db_session, admin_user.id, "renamed.png", content
        )
        other_user, other_created = await create_label_asset(
            db_session, normal_user.id, "logo.png", content
        )
        await db_session.commit()

        assert first_created is True
        assert duplicate_created is False
        assert duplicate.id == first.id
        assert duplicate.display_name == "logo.png"
        assert other_created is True
        assert other_user.id != first.id
        assert other_user.sha256 == first.sha256
        assert await db_session.scalar(
            select(func.count()).select_from(LabelAsset)
        ) == 2

    @pytest.mark.asyncio
    async def test_enforces_per_user_count_and_byte_quotas(
        self, db_session, admin_user, monkeypatch
    ):
        import app.services.label_asset_service as service

        user_id = admin_user.id
        monkeypatch.setattr(service, "MAX_ASSETS_PER_USER", 1)
        await create_label_asset(
            db_session, user_id, "first.png", image_bytes(color=(1, 2, 3))
        )
        with pytest.raises(LabelAssetLimitError, match="100"):
            await create_label_asset(
                db_session,
                user_id,
                "second.png",
                image_bytes(color=(4, 5, 6)),
            )

        await db_session.rollback()
        monkeypatch.setattr(service, "MAX_ASSETS_PER_USER", 100)
        monkeypatch.setattr(service, "MAX_TOTAL_ASSET_BYTES_PER_USER", 1)
        with pytest.raises(LabelAssetLimitError, match="50 MiB"):
            await create_label_asset(
                db_session, user_id, "large.png", image_bytes()
            )

    @pytest.mark.asyncio
    async def test_reference_rows_control_orphan_state_and_thirty_day_cleanup(
        self, db_session, admin_user
    ):
        asset, _ = await create_label_asset(
            db_session, admin_user.id, "logo.png", image_bytes()
        )
        preset = LabelPreset(
            user_id=admin_user.id,
            preset_type="spool",
            name="With image",
            name_key=label_preset_name_key("With image"),
            data={"version": 2},
        )
        db_session.add(preset)
        await db_session.flush()

        await set_label_preset_asset_references(
            db_session, preset, {asset.id}
        )
        await db_session.flush()
        assert asset.orphaned_at is None
        assert await db_session.scalar(
            select(func.count()).select_from(LabelPresetAsset)
        ) == 1

        orphaned_at = datetime.now(UTC) - timedelta(days=31)
        await set_label_preset_asset_references(
            db_session, preset, set(), orphaned_at=orphaned_at
        )
        await db_session.flush()
        assert asset.orphaned_at == orphaned_at

        deleted = await cleanup_orphaned_label_assets(
            db_session, now=datetime.now(UTC)
        )
        await db_session.flush()
        assert deleted == 1
        assert await db_session.get(LabelAsset, asset.id) is None

    @pytest.mark.asyncio
    async def test_rejects_cross_user_asset_references(
        self, db_session, admin_user, normal_user
    ):
        asset, _ = await create_label_asset(
            db_session, normal_user.id, "private.png", image_bytes()
        )
        preset = LabelPreset(
            user_id=admin_user.id,
            preset_type="spool",
            name="Admin",
            name_key=label_preset_name_key("Admin"),
            data={"version": 2},
        )
        db_session.add(preset)
        await db_session.flush()

        with pytest.raises(LabelAssetValidationError, match="not found"):
            await set_label_preset_asset_references(
                db_session, preset, {asset.id}
            )
