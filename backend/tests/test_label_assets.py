import io
from datetime import UTC, datetime, timedelta

import pytest
from PIL import Image, PngImagePlugin
from sqlalchemy import delete, func, select

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


def designer_data(asset_id: str) -> dict:
    return {
        "version": 2,
        "design": {
            "version": 2,
            "label": {
                "widthMm": 60,
                "heightMm": 40,
                "marginMm": 1,
                "border": False,
            },
            "elements": [
                {
                    "id": "image-1",
                    "type": "image",
                    "assetId": asset_id,
                    "x": 1,
                    "y": 1,
                    "w": 20,
                    "h": 10,
                    "z": 0,
                    "objectFit": "contain",
                }
            ],
        },
    }


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


class TestLabelAssetApi:
    @pytest.mark.asyncio
    async def test_upload_list_and_immutable_content(self, auth_client):
        client, csrf_token = auth_client
        response = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("my logo.webp", image_bytes("WEBP"), "image/webp")},
            headers={"X-CSRF-Token": csrf_token},
        )

        assert response.status_code == 200
        uploaded = response.json()
        assert uploaded["display_name"] == "my logo.webp"
        assert uploaded["media_type"] == "image/png"
        assert uploaded["width"] == 24
        assert uploaded["height"] == 12
        assert "content" not in uploaded

        listed = await client.get("/api/v1/me/label-assets")
        assert listed.status_code == 200
        assert listed.json() == [uploaded]

        content = await client.get(
            f"/api/v1/me/label-assets/{uploaded['id']}/content"
        )
        assert content.status_code == 200
        assert content.headers["content-type"] == "image/png"
        assert content.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert content.headers["etag"] == f'"{uploaded["sha256"]}"'
        assert content.content.startswith(b"\x89PNG\r\n\x1a\n")

    @pytest.mark.asyncio
    async def test_upload_requires_authentication(self, client):
        response = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("logo.png", image_bytes(), "image/png")},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_cookie_upload_requires_csrf(self, auth_client):
        client, _csrf_token = auth_client
        response = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("logo.png", image_bytes(), "image/png")},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_assets_support_api_key_auth(
        self, client, db_session, normal_user
    ):
        from app.core.security import generate_token_secret, hash_token
        from app.models import UserApiKey

        secret = generate_token_secret()
        api_key = UserApiKey(
            user_id=normal_user.id,
            name="Label images",
            key_hash=hash_token(secret),
        )
        db_session.add(api_key)
        await db_session.commit()
        await db_session.refresh(api_key)
        headers = {"Authorization": f"ApiKey uak.{api_key.id}.{secret}"}

        response = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("logo.png", image_bytes(), "image/png")},
            headers=headers,
        )
        assert response.status_code == 200
        assert (await client.get("/api/v1/me/label-assets", headers=headers)).json()

    @pytest.mark.asyncio
    async def test_ownership_is_hidden_and_unreferenced_assets_can_be_deleted(
        self, auth_client, db_session, normal_user
    ):
        client, csrf_token = auth_client
        private_asset, _ = await create_label_asset(
            db_session, normal_user.id, "private.png", image_bytes()
        )
        await db_session.commit()

        assert (
            await client.get(
                f"/api/v1/me/label-assets/{private_asset.id}/content"
            )
        ).status_code == 404
        assert (
            await client.delete(
                f"/api/v1/me/label-assets/{private_asset.id}",
                headers={"X-CSRF-Token": csrf_token},
            )
        ).status_code == 404

        uploaded = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("delete.png", image_bytes(color=(9, 8, 7)), "image/png")},
            headers={"X-CSRF-Token": csrf_token},
        )
        response = await client.delete(
            f"/api/v1/me/label-assets/{uploaded.json()['id']}",
            headers={"X-CSRF-Token": csrf_token},
        )
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_preset_references_prevent_deletion_then_become_orphaned(
        self, auth_client, db_session
    ):
        client, csrf_token = auth_client
        uploaded = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("used.png", image_bytes(), "image/png")},
            headers={"X-CSRF-Token": csrf_token},
        )
        asset_id = uploaded.json()["id"]

        preset = await client.put(
            "/api/v1/me/label-presets/spool/item",
            json={"name": "Uses image", "data": designer_data(asset_id)},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert preset.status_code == 200
        assert (
            await client.delete(
                f"/api/v1/me/label-assets/{asset_id}",
                headers={"X-CSRF-Token": csrf_token},
            )
        ).status_code == 409

        deleted = await client.delete(
            "/api/v1/me/label-presets/spool/item?name=Uses%20image",
            headers={"X-CSRF-Token": csrf_token},
        )
        assert deleted.status_code == 204
        asset = await db_session.get(LabelAsset, asset_id)
        await db_session.refresh(asset)
        assert asset.orphaned_at is not None

    @pytest.mark.asyncio
    async def test_preset_rejects_missing_or_cross_user_asset_ids(
        self, auth_client, db_session, normal_user
    ):
        client, csrf_token = auth_client
        private_asset, _ = await create_label_asset(
            db_session, normal_user.id, "private.png", image_bytes()
        )
        await db_session.commit()

        for asset_id in (private_asset.id, "00000000-0000-0000-0000-000000000000"):
            response = await client.put(
                "/api/v1/me/label-presets/spool/item",
                json={"name": "Invalid image", "data": designer_data(asset_id)},
                headers={"X-CSRF-Token": csrf_token},
            )
            assert response.status_code == 422
            assert response.json()["detail"]["code"] == "invalid_label_asset"

    @pytest.mark.asyncio
    async def test_browser_preset_migration_restores_image_references(
        self, auth_client, db_session
    ):
        client, csrf_token = auth_client
        uploaded = await client.post(
            "/api/v1/me/label-assets",
            files={"file": ("migrated.png", image_bytes(), "image/png")},
            headers={"X-CSRF-Token": csrf_token},
        )
        asset_id = uploaded.json()["id"]

        response = await client.post(
            "/api/v1/me/label-presets/migrate",
            json={
                "presets": [
                    {
                        "preset_type": "spool",
                        "name": "Migrated v2",
                        "data": designer_data(asset_id),
                    }
                ]
            },
            headers={"X-CSRF-Token": csrf_token},
        )

        assert response.status_code == 200
        assert response.json()[0]["data"] == designer_data(asset_id)
        assert await db_session.scalar(
            select(func.count())
            .select_from(LabelPresetAsset)
            .where(LabelPresetAsset.asset_id == asset_id)
        ) == 1


class TestLabelAssetBackups:
    @pytest.mark.asyncio
    async def test_complete_backup_round_trips_binary_assets_and_references(
        self, db_session, admin_user
    ):
        from app.api.v1.system import _export_all_data, _import_all_data

        asset, _ = await create_label_asset(
            db_session, admin_user.id, "backup.png", image_bytes()
        )
        preset = LabelPreset(
            user_id=admin_user.id,
            preset_type="spool",
            name="Backed up image",
            name_key=label_preset_name_key("Backed up image"),
            data=designer_data(asset.id),
        )
        db_session.add(preset)
        await db_session.flush()
        await set_label_preset_asset_references(db_session, preset, {asset.id})
        await db_session.commit()

        exported = await _export_all_data(db_session)
        assert isinstance(exported["label_assets"][0]["content"], str)
        assert exported["label_assets"][0]["content"] != str(asset.content)
        assert exported["label_preset_assets"] == [
            {
                "preset_id": preset.id,
                "asset_id": asset.id,
                "user_id": admin_user.id,
            }
        ]

        await db_session.execute(delete(LabelPresetAsset))
        await db_session.execute(delete(LabelPreset))
        await db_session.execute(delete(LabelAsset))
        await db_session.flush()
        imported = await _import_all_data(
            db_session,
            {
                "label_assets": exported["label_assets"],
                "label_presets": exported["label_presets"],
                "label_preset_assets": exported["label_preset_assets"],
            },
        )

        restored = await db_session.get(LabelAsset, asset.id)
        assert imported["label_assets"] == 1
        assert imported["label_preset_assets"] == 1
        assert restored.content == asset.content
        assert restored.sha256 == asset.sha256

    @pytest.mark.asyncio
    async def test_legacy_backup_without_asset_tables_remains_valid(
        self, db_session
    ):
        from app.api.v1.system import _import_all_data

        imported = await _import_all_data(db_session, {"label_presets": []})

        assert imported["label_assets"] == 0
        assert imported["label_preset_assets"] == 0

    @pytest.mark.asyncio
    async def test_corrupt_asset_base64_is_rejected(self, db_session, admin_user):
        from app.api.v1.system import _import_all_data

        now = datetime.now(UTC).isoformat()
        with pytest.raises(ValueError, match="base64"):
            await _import_all_data(
                db_session,
                {
                    "label_assets": [
                        {
                            "id": "00000000-0000-0000-0000-000000000001",
                            "user_id": admin_user.id,
                            "display_name": "bad.png",
                            "sha256": "0" * 64,
                            "media_type": "image/png",
                            "width": 1,
                            "height": 1,
                            "byte_size": 1,
                            "content": "%%%not-base64%%%",
                            "orphaned_at": now,
                            "created_at": now,
                            "updated_at": now,
                        }
                    ]
                },
            )

    @pytest.mark.asyncio
    async def test_corrupt_cross_user_asset_reference_is_rejected(
        self, db_session
    ):
        from app.api.v1.system import _import_all_data

        with pytest.raises(ValueError, match="reference"):
            await _import_all_data(
                db_session,
                {
                    "label_preset_assets": [
                        {
                            "preset_id": 999_999,
                            "asset_id": "00000000-0000-0000-0000-000000000001",
                            "user_id": 999_999,
                        }
                    ]
                },
            )

    @pytest.mark.asyncio
    async def test_inventory_backup_excludes_label_assets(
        self, db_session, admin_user
    ):
        from app.api.v1.system import _export_inventory_data

        await create_label_asset(
            db_session, admin_user.id, "not-in-inventory.png", image_bytes()
        )
        exported = await _export_inventory_data(db_session)

        assert "label_assets" not in exported
        assert "label_preset_assets" not in exported
