import json

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db
from app.api.v1 import router as loader
from app.models.plugin import InstalledPlugin
from app.services import plugin_service


@pytest.mark.parametrize("mount", ["hot", "startup"])
async def test_integration_routes_follow_active_state(mount, db_session, tmp_path, monkeypatch):
    key = "serving_test"
    plugin_dir = tmp_path / key
    plugin_dir.mkdir()
    (plugin_dir / "__init__.py").touch()
    (plugin_dir / "plugin.json").write_text(json.dumps({
        "plugin_key": key, "plugin_type": "integration", "mount_prefix": "/plugins/serving-test",
        "page_url": "/plugin-view/serving-test",
    }))
    (plugin_dir / "router.py").write_text(
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n"
        "@router.get('/hosted-config')\n"
        "def config(): return {'active': True}\n"
    )
    monkeypatch.setattr(plugin_service, "PLUGINS_DIR", tmp_path)
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setattr(loader, "_deferred_plugin_routers", [])

    app = FastAPI()

    @app.get("/plugins/serving-test-preview/hosted-config")
    def preview_config():
        return {"preview": True}

    if mount == "hot":
        assert loader.mount_plugin_router_on_app(app, key)
    else:
        loader._mount_plugin_routers()
        loader.mount_deferred_plugin_routers(app)

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    plugin = InstalledPlugin(plugin_key=key, name="Test", version="1.0.0", plugin_type="integration")
    db_session.add(plugin)
    await db_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/plugins/serving-test-preview/hosted-config")).json() == {"preview": True}
        url = "/plugins/serving-test/hosted-config"
        assert (await client.get(url)).status_code == 200
        await plugin_service.PluginInstallService(db_session).set_active(key, False)
        assert (await client.get(url)).status_code == 404
        await plugin_service.PluginInstallService(db_session).set_active(key, True)
        assert (await client.get(url)).status_code == 200


async def test_bookmarked_shell_requires_an_active_install(db_session, tmp_path, monkeypatch):
    from app import main

    shell = tmp_path / "plugin-view/_shell/index.html"
    shell.parent.mkdir(parents=True)
    shell.write_text("integration shell")
    (shell.parent.parent / "index.html").write_text("legacy shell")
    monkeypatch.setattr(main, "static_files_path", str(tmp_path), raising=False)
    app = FastAPI()
    app.add_api_route("/plugin-view/{plugin_slug:path}", main.serve_plugin_view, methods=["GET", "HEAD"])

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    plugin = InstalledPlugin(
        plugin_key="bookmarked", name="Bookmarked", version="1.0.0",
        plugin_type="integration", page_url="/plugin-view/bookmarked",
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        url = plugin.page_url
        for legacy in ("/plugin-view/", "/plugin-view/index.html"):
            assert (await client.get(legacy)).text == "legacy shell"
        for method in ("GET", "HEAD"):
            assert (await client.request(method, "/plugin-view/_shell/index.html")).status_code == 404
        assert (await client.get(url)).status_code == 404
        db_session.add(plugin)
        await db_session.commit()
        assert (await client.get(url)).text == "integration shell"
        assert (await client.get(url + "/")).text == "integration shell"
        await plugin_service.PluginInstallService(db_session).set_active(plugin.plugin_key, False)
        assert (await client.get(url)).status_code == 404


async def test_navigation_reflects_plugin_toggle_without_worker_cache(db_session):
    from app.api.v1.system import plugin_nav

    plugin = InstalledPlugin(
        plugin_key="nav_test", name="Nav test", version="1.0.0", plugin_type="integration",
        page_url="/plugin-view/nav-test", show_in_nav=True,
    )
    db_session.add(plugin)
    await db_session.commit()
    assert plugin.plugin_key in [item.plugin_key for item in await plugin_nav(db_session, None)]
    await plugin_service.PluginInstallService(db_session).set_active(plugin.plugin_key, False)
    assert plugin.plugin_key not in [item.plugin_key for item in await plugin_nav(db_session, None)]


@pytest.mark.parametrize("prefix,has_router,valid", [
    ("/plugins/detail", True, True),
    ("/plugins/different", True, False),
    ("/plugins/detail", False, False),
])
async def test_install_manifest_requires_a_matching_shell_router(prefix, has_router, valid, tmp_path, db_session):
    (tmp_path / "plugin.json").write_text(json.dumps({
        "plugin_key": "detail", "plugin_type": "integration", "name": "Detail",
        "version": "1.0.0", "description": "Hosted integration", "author": "Test",
        "page_url": "/plugin-view/detail", "mount_prefix": prefix,
    }))
    if has_router:
        (tmp_path / "router.py").touch()
    service = plugin_service.PluginInstallService(db_session)
    if valid:
        assert service._validate_manifest(tmp_path)["mount_prefix"] == prefix
    else:
        with pytest.raises(plugin_service.PluginInstallError) as error:
            service._validate_manifest(tmp_path)
        assert error.value.code == "invalid_integration_shell"


def test_unguarded_starlette_route_is_not_published(tmp_path, monkeypatch):
    key = "plain_test"
    plugin_dir = tmp_path / key
    plugin_dir.mkdir()
    (plugin_dir / "__init__.py").touch()
    (plugin_dir / "plugin.json").write_text(json.dumps({
        "plugin_key": key, "plugin_type": "integration", "mount_prefix": "/plugins/plain-test",
        "page_url": "/plugin-view/plain-test",
    }))
    (plugin_dir / "router.py").write_text(
        "from fastapi import APIRouter\n"
        "from starlette.routing import Route\n"
        "from starlette.responses import Response\n"
        "router = APIRouter(routes=[Route('/', lambda request: Response('plain'))])\n"
    )
    monkeypatch.setattr(plugin_service, "PLUGINS_DIR", tmp_path)
    monkeypatch.syspath_prepend(str(tmp_path))
    app = FastAPI()
    assert not loader.mount_plugin_router_on_app(app, key)
    assert all(not route.path.startswith("/plugins/plain-test") for route in app.routes)


async def test_two_plugins_cannot_claim_one_shell_url(db_session, admin_user, tmp_path, monkeypatch):
    from io import BytesIO
    from zipfile import ZipFile

    monkeypatch.setattr(plugin_service, "PLUGINS_DIR", tmp_path)
    service = plugin_service.PluginInstallService(db_session)

    def package(key, page_url="/plugin-view/example", prefix="/plugins/example"):
        stream = BytesIO()
        with ZipFile(stream, "w") as archive:
            archive.writestr("plugin.json", json.dumps({
                "plugin_key": key, "plugin_type": "integration", "name": "Example",
                "version": "1.0.0", "description": "Hosted integration", "author": "Test",
                "page_url": page_url, "mount_prefix": prefix,
            }))
            archive.writestr("__init__.py", "")
            archive.writestr("router.py", "from fastapi import APIRouter\nrouter = APIRouter()\n")
        return stream.getvalue()

    installer_id = admin_user.id
    await service.install_from_zip(package("first_example"), installed_by=installer_id)
    with pytest.raises(plugin_service.PluginInstallError) as error:
        await service.install_from_zip(package("second_example"))
    assert error.value.code == "integration_shell_conflict"
    assert not (tmp_path / "second_example").exists()
    with pytest.raises(plugin_service.PluginInstallError) as error:
        await service.install_from_zip(package("unregistered_example", page_url=None))
    assert error.value.code == "invalid_integration_shell"
    assert not (tmp_path / "unregistered_example").exists()
    with pytest.raises(plugin_service.PluginInstallError) as error:
        await service.install_from_zip(package("shell_mount", page_url=None, prefix="/plugin-view"))
    assert error.value.code == "invalid_integration_shell"
    _, upgraded = await service.install_from_zip(package("first_example"), installed_by=installer_id)
    assert upgraded
