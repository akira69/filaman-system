"""Resource use and transaction contracts for label image storage."""

import asyncio
import base64
import io
import threading
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import event, func, inspect, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.label_assets import get_label_asset_content, list_label_assets
from app.api.v1.label_presets import (
    LabelPresetMigrationRequest,
    LabelPresetUpsertInput,
    migrate_label_presets,
    upsert_label_preset,
)
from app.api.v1.system import _export_all_data, _import_all_data
from app.core.security import Principal
from app.models import Base, LabelAsset, LabelPreset, User
from app.models.label_preset import label_preset_name_key
from app.services import label_asset_service as assets


def png(color: str = "red") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


@pytest_asyncio.fixture
async def sessions(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'assets.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def pragmas(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as db:
            db.add(User(id=1, email="asset-regressions@example.com"))
            await db.commit()
        yield factory
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("quota", ["count", "bytes"])
async def test_concurrent_uploads_cannot_exceed_user_quota(
    sessions, monkeypatch, quota
):
    if quota == "count":
        monkeypatch.setattr(assets, "MAX_ASSETS_PER_USER", 1)
    else:
        monkeypatch.setattr(assets, "MAX_TOTAL_ASSET_BYTES_PER_USER", 100)
    first_checked = asyncio.Event()
    release_first = asyncio.Event()
    second_checked = asyncio.Event()

    async def upload(first):
        async with sessions() as db:
            execute = db.execute

            async def pause_after_quota(statement, *args, **kwargs):
                result = await execute(statement, *args, **kwargs)
                if "count(label_assets.id)" in str(statement):
                    if first:
                        first_checked.set()
                        await release_first.wait()
                    else:
                        second_checked.set()
                return result

            monkeypatch.setattr(db, "execute", pause_after_quota)
            try:
                await assets.create_label_asset(
                    db, 1, "image.png", png("red" if first else "blue")
                )
                await db.commit()
                return "saved"
            except assets.LabelAssetLimitError:
                await db.rollback()
                return "limited"

    first = asyncio.create_task(upload(True))
    await asyncio.wait_for(first_checked.wait(), 2)
    second = asyncio.create_task(upload(False))
    try:
        # An unlocked second request reaches its quota read before the first writes.
        await asyncio.wait_for(second_checked.wait(), 0.1)
    except TimeoutError:
        pass  # A serialized request must wait for the first transaction.
    finally:
        release_first.set()
    assert sorted(await asyncio.gather(first, second)) == ["limited", "saved"]
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(LabelAsset)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["upsert", "migrate"])
async def test_preset_flush_conflict_is_409_and_rolls_back(
    sessions, monkeypatch, operation
):
    principal = Principal(auth_type="session", user_id=1)
    body = LabelPresetUpsertInput(name="Race", data={})
    async with sessions() as first:
        flush = first.flush
        inserted = False

        async def competing_save(*args, **kwargs):
            nonlocal inserted
            if not inserted:
                inserted = True
                async with sessions() as second:
                    await upsert_label_preset("spool", body, second, principal)
            return await flush(*args, **kwargs)

        monkeypatch.setattr(first, "flush", competing_save)
        with pytest.raises(HTTPException) as rejected:
            if operation == "upsert":
                await upsert_label_preset("spool", body, first, principal)
            else:
                await migrate_label_presets(
                    LabelPresetMigrationRequest(
                        presets=[
                            {
                                "preset_type": "spool",
                                "name": "Race",
                                "data": {},
                            }
                        ]
                    ),
                    first,
                    principal,
                )
        assert rejected.value.status_code == 409
        assert rejected.value.detail["code"] == "preset_conflict"
        assert not first.in_transaction()


@pytest.mark.asyncio
async def test_metadata_and_references_skip_blobs_but_content_and_backup_load_them(
    sessions,
):
    principal = Principal(auth_type="session", user_id=1)
    async with sessions() as db:
        asset, _ = await assets.create_label_asset(db, 1, "red.png", png())
        content, asset_id = asset.content, asset.id
        await db.commit()
    async with sessions() as db:
        listed = await list_label_assets(db, principal)
        assert "content" in inspect(listed[0]).unloaded
        preset = LabelPreset(
            user_id=1,
            preset_type="spool",
            name="Image",
            name_key=label_preset_name_key("Image"),
            data={},
        )
        db.add(preset)
        await db.flush()
        await assets.set_label_preset_asset_references(db, preset, {asset_id})
        assert "content" in inspect(listed[0]).unloaded
        await db.commit()
    async with sessions() as db:
        assert (await get_label_asset_content(asset_id, db, principal)).body == content
    async with sessions() as db:
        backup = await _export_all_data(db)
        assert base64.b64decode(backup["label_assets"][0]["content"]) == content


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["upload", "restore"])
async def test_image_conversion_does_not_run_on_event_loop(
    sessions, monkeypatch, operation
):
    from app.api.v1 import system

    if operation == "restore":
        async with sessions() as db:
            await assets.create_label_asset(db, 1, "red.png", png())
            await db.flush()
            exported = await _export_all_data(db)
            # Only the seed user is committed; exiting rolls the asset back.
    main_thread = threading.get_ident()
    canonicalize = assets.canonicalize_label_image

    def checked_conversion(content):
        assert threading.get_ident() != main_thread, (
            "image conversion blocks the event loop"
        )
        return canonicalize(content)

    monkeypatch.setattr(assets, "canonicalize_label_image", checked_conversion)
    monkeypatch.setattr(system, "canonicalize_label_image", checked_conversion)
    async with sessions() as db:
        if operation == "upload":
            await assets.create_label_asset(db, 1, "red.png", png())
        else:
            await _import_all_data(db, {"label_assets": exported["label_assets"]})


@pytest.mark.asyncio
async def test_upload_cleans_only_the_uploading_users_orphans(sessions):
    from datetime import UTC, datetime, timedelta

    async with sessions() as db:
        db.add(User(id=2, email="other-assets@example.com"))
        await db.flush()
        own, _ = await assets.create_label_asset(db, 1, "red.png", png())
        other, _ = await assets.create_label_asset(db, 2, "blue.png", png("blue"))
        own.orphaned_at = other.orphaned_at = datetime.now(UTC) - timedelta(days=31)
        own_id, other_id = own.id, other.id
        await db.commit()
    async with sessions() as db:
        await assets.create_label_asset(db, 1, "green.png", png("green"))
        await db.commit()
        assert await db.get(LabelAsset, own_id) is None
        assert await db.get(LabelAsset, other_id) is not None
