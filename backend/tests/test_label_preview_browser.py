import asyncio
import io
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image
from playwright.async_api import BrowserType


def write_render_page(root: Path, script: str):
    (root / "label-render").mkdir(parents=True)
    (root / "_astro").mkdir()
    (root / "label-render/index.html").write_text(
        '<!doctype html><script type="module" src="/_astro/render.js"></script>'
    )
    (root / "_astro/render.js").write_text(script)


@pytest.mark.asyncio
async def test_render_uses_local_files_and_owned_assets_without_network(tmp_path, browser_executable):
    from app.services.label_preview_browser import render_preview_png

    requests = []

    async def record_network(reader, writer):
        requests.append(await reader.read(4096))
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nSECRET")
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(record_network, "127.0.0.1", 0)
    origin = f"http://LOCALHOST:{server.sockets[0].getsockname()[1]}"
    root = tmp_path / "static"
    write_render_page(root, """
        window.renderApiLabel = async payload => {
          if (await (await fetch('/_astro/allowed.txt')).text() !== 'local') throw Error('local file missing');
          for (const path of payload.blocked) {
            let denied = false;
            try { await fetch(path, {mode: 'no-cors'}); } catch { denied = true; }
            if (!denied) throw Error('Unexpected access to ' + path);
          }
          const image = await createImageBitmap(await (await fetch(payload.asset)).blob());
          const canvas = document.createElement('canvas');
          canvas.width = 3; canvas.height = 2;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          context.fillStyle = payload.color; context.fillRect(2, 1, 1, 1);
          return canvas.toDataURL('image/png');
        };
    """)
    (root / "_astro/allowed.txt").write_text("local")
    (root / "api").mkdir()
    (root / "api/private").write_text("API must remain blocked even if a file exists")
    (root / "uploads").mkdir()
    (root / "uploads/private.png").write_text("unowned upload")
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET")
    (root / "escape.txt").symlink_to(secret)
    asset = io.BytesIO()
    Image.new("RGB", (1, 1), "red").save(asset, format="PNG")
    asset_path = "/api/v1/label-assets/owned/content"
    try:
        result = await render_preview_png(
            {
                "asset": asset_path, "color": "#00ff00",
                "blocked": [
                    "/api/private", "/uploads/private.png", "/missing.txt", "/escape.txt",
                    "/..%2Fsecret.txt", f"{origin}/outside", "https://example.invalid/private",
                    "file:///etc/passwd",
                ],
            },
            origin, {asset_path: asset.getvalue()}, static_dir=root, executable_path=browser_executable,
        )
        with Image.open(io.BytesIO(result)) as image:
            assert image.size == (3, 2)
            assert image.convert("RGB").getpixel((0, 0)) == (255, 0, 0)
            assert image.convert("RGB").getpixel((2, 1)) == (0, 255, 0)
        assert requests == []
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_render_closes_browser_after_failure_and_does_not_retain_cookies(
    tmp_path, browser_executable, monkeypatch
):
    from app.services.label_preview_browser import render_preview_png

    browsers = []
    original_launch = BrowserType.launch

    async def capture_browser(self, **kwargs):
        browser = await original_launch(self, **kwargs)
        browsers.append(browser)
        return browser

    monkeypatch.setattr(BrowserType, "launch", capture_browser)
    write_render_page(tmp_path, """
        window.renderApiLabel = async payload => {
          if (document.cookie) throw Error('Previous request cookie leaked');
          if (payload.fail) { document.cookie = 'private=1'; throw Error('bad label'); }
          return document.createElement('canvas').toDataURL('image/png');
        };
    """)
    with pytest.raises(HTTPException) as rejected:
        await render_preview_png(
            {"fail": True}, "http://labels.invalid", {},
            static_dir=tmp_path, executable_path=browser_executable,
        )
    assert rejected.value.status_code == 422
    assert browsers and all(not browser.is_connected() for browser in browsers)
    png = await render_preview_png(
        {}, "http://labels.invalid", {}, static_dir=tmp_path, executable_path=browser_executable,
    )
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(browsers) == 2
    assert all(not browser.is_connected() for browser in browsers)


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["build", "binary"])
async def test_missing_browser_runtime_returns_clear_503(tmp_path, missing):
    from app.services.label_preview_browser import render_preview_png

    if missing == "binary":
        write_render_page(tmp_path, "window.renderApiLabel = () => ''")
    with pytest.raises(HTTPException) as rejected:
        await render_preview_png(
            {}, "http://labels.invalid", {}, static_dir=tmp_path,
            executable_path=str(tmp_path / "missing-chromium"),
        )
    assert rejected.value.status_code == 503
    assert ("build" if missing == "build" else "Chromium") in rejected.value.detail


@pytest.mark.asyncio
async def test_render_slot_rejects_concurrent_work_and_releases_after_failure(tmp_path, monkeypatch):
    from app.core.file_lock import exclusive_file_lock
    from app.services import label_preview_browser

    lock_path = tmp_path / "renderer.lock"
    monkeypatch.setattr(label_preview_browser, "_LOCK_PATH", lock_path)
    with pytest.raises(ValueError, match="render failed"):
        async with label_preview_browser.label_render_slot():
            with pytest.raises(HTTPException) as busy:
                async with label_preview_browser.label_render_slot():
                    pytest.fail("A second renderer entered the slot")
            assert busy.value.status_code == 503
            assert busy.value.headers["Retry-After"] == "1"
            raise ValueError("render failed")
    with exclusive_file_lock(lock_path):
        with pytest.raises(HTTPException) as busy:
            async with label_preview_browser.label_render_slot():
                pytest.fail("Renderer ignored an existing worker lock")
        assert busy.value.status_code == 503
    async with label_preview_browser.label_render_slot():
        pass


@pytest.mark.asyncio
async def test_origin_credentials_are_rejected_before_loading_page(tmp_path, browser_executable):
    from app.services.label_preview_browser import render_preview_png

    write_render_page(tmp_path, "window.renderApiLabel = () => ''")
    with pytest.raises(HTTPException) as rejected:
        await render_preview_png(
            {}, "http://:secret@labels.invalid", {}, static_dir=tmp_path,
            executable_path=browser_executable,
        )
    assert rejected.value.status_code == 422
    assert rejected.value.detail == "Invalid label renderer origin"
