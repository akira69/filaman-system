"""Run the existing browser label preview with local files and owned image bytes."""

import asyncio
import base64
import binascii
import mimetypes
import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from playwright.async_api import Error as BrowserError
from playwright.async_api import Route, async_playwright
from playwright.async_api import TimeoutError as BrowserTimeout

from app.core.file_lock import FileLockBusy, exclusive_file_lock

_LOCK_PATH = Path(tempfile.gettempdir()) / "filaman-label-render.lock"
_RENDER_TIMEOUT_SECONDS = 30


@asynccontextmanager
async def label_render_slot() -> AsyncIterator[None]:
    # ponytail: one browser across workers caps RAM; add parallel slots only after measuring peak memory.
    try:
        with exclusive_file_lock(_LOCK_PATH):
            yield
    except FileLockBusy as exc:
        raise HTTPException(503, "Label renderer is busy", headers={"Retry-After": "1"}) from exc


async def render_preview_png(
    payload: dict,
    origin: str,
    assets: dict[str, bytes],
    *,
    static_dir: str | Path | None = None,
    executable_path: str | None = None,
) -> bytes:
    """Caller holds label_render_slot before loading assets and throughout this call."""
    configured_root = static_dir or os.environ.get("LABEL_RENDER_STATIC_DIR")
    candidates = [Path(configured_root)] if configured_root else [
        Path("/app/static"),
        Path(__file__).resolve().parents[3] / "frontend/dist",
        Path(__file__).resolve().parents[3] / "frontend/dist/client",
    ]
    root = next((path.resolve() for path in candidates if (path / "label-render/index.html").is_file()), None)
    if root is None:
        raise HTTPException(503, "Label renderer frontend build is missing; build the frontend first")
    executable = executable_path or os.environ.get("LABEL_RENDER_CHROMIUM_EXECUTABLE")
    if executable and (not Path(executable).is_file() or not os.access(executable, os.X_OK)):
        raise HTTPException(503, "Label renderer Chromium executable is unavailable")
    try:
        expected_origin = urlsplit(origin)
        expected_port = expected_origin.port or (443 if expected_origin.scheme == "https" else 80)
    except ValueError as exc:
        raise HTTPException(422, "Invalid label renderer origin") from exc
    if expected_origin.scheme not in {"http", "https"} or not expected_origin.hostname or expected_origin.username is not None:
        raise HTTPException(422, "Invalid label renderer origin")
    base_url = f"{expected_origin.scheme}://{expected_origin.netloc}"

    async def serve_local(route: Route) -> None:
        requested = urlsplit(route.request.url)
        requested_port = requested.port or (443 if requested.scheme == "https" else 80)
        if requested.username is not None or (
            requested.scheme, requested.hostname, requested_port
        ) != (expected_origin.scheme, expected_origin.hostname, expected_port):
            await route.abort()
            return
        path = unquote(requested.path)
        if route.request.method != "GET":
            await route.abort()
            return
        if path in assets:
            await route.fulfill(body=assets[path], content_type="image/png")
            return
        if path == "/api" or path.startswith(("/api/", "/uploads/")):
            await route.abort()
            return
        try:
            file = (root / path.lstrip("/")).resolve()
            file.relative_to(root)
            if file.is_dir():
                file = (file / "index.html").resolve()
                file.relative_to(root)
            content = file.read_bytes()
        except (OSError, ValueError):
            await route.abort()
            return
        await route.fulfill(body=content, content_type=mimetypes.guess_type(file.name)[0] or "application/octet-stream")

    try:
        async with asyncio.timeout(_RENDER_TIMEOUT_SECONDS), async_playwright() as playwright:
            try:
                # Offline routing alone still permits speculative TCP preconnects.
                browser = await playwright.chromium.launch(
                    executable_path=executable, headless=True,
                    proxy={"server": "http://label-render.invalid:9", "bypass": "<-loopback>"},
                    args=["--host-resolver-rules=MAP * ~NOTFOUND"],
                )
            except BrowserError as exc:
                raise HTTPException(503, "Label renderer Chromium is unavailable; install Playwright Chromium or configure LABEL_RENDER_CHROMIUM_EXECUTABLE") from exc
            try:
                context = await browser.new_context(offline=True, service_workers="block", accept_downloads=False)
                await context.route("**/*", serve_local)
                await context.route_web_socket("**/*", lambda socket: socket.close())
                page = await context.new_page()
                await page.goto(f"{base_url}/label-render/", wait_until="load")
                await page.wait_for_function("typeof window.renderApiLabel === 'function'")
                data_url = await page.evaluate("payload => window.renderApiLabel(payload)", payload)
            finally:
                await browser.close()
    except (TimeoutError, BrowserTimeout) as exc:
        raise HTTPException(503, "Label renderer timed out", headers={"Retry-After": "1"}) from exc
    except BrowserError as exc:
        raise HTTPException(422, "Label could not be rendered by the browser preview") from exc

    prefix = "data:image/png;base64,"
    try:
        if not isinstance(data_url, str) or not data_url.startswith(prefix):
            raise ValueError("Expected PNG data URL")
        png = base64.b64decode(data_url[len(prefix):], validate=True)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Expected PNG bytes")
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, "Browser preview did not return a PNG image") from exc
    return png
