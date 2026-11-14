import asyncio
from contextlib import AsyncExitStack, asynccontextmanager, suppress
from socket import socket
from unittest.mock import AsyncMock, Mock

import pytest

from app import main
from app.core import worker_reload
from app.services import label_asset_service


@pytest.mark.asyncio
async def test_stale_label_asset_cleanup_runs_at_most_daily(monkeypatch):
    class Session:
        commit = AsyncMock()

    session = Session()

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return None

    cleanup = AsyncMock(return_value=2)
    monkeypatch.setattr(main, "async_session_maker", SessionContext)
    monkeypatch.setattr(label_asset_service, "cleanup_orphaned_label_assets", cleanup)
    monkeypatch.setattr(main.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(main, "_next_label_asset_cleanup", 0.0)

    await main._cleanup_stale_label_assets()
    await main._cleanup_stale_label_assets()

    cleanup.assert_awaited_once_with(session)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_cleanup_waits_until_the_next_daily_window(monkeypatch):
    class SessionContext:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *_args):
            return None

    cleanup = AsyncMock(side_effect=RuntimeError("database unavailable"))
    monkeypatch.setattr(main, "async_session_maker", SessionContext)
    monkeypatch.setattr(label_asset_service, "cleanup_orphaned_label_assets", cleanup)
    monkeypatch.setattr(main.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(main, "_next_label_asset_cleanup", 0.0)

    with pytest.raises(RuntimeError, match="database unavailable"):
        await main._cleanup_stale_label_assets()
    await main._cleanup_stale_label_assets()

    cleanup.assert_awaited_once()


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_skip_driver_health_check(monkeypatch):
    sleeps = 0

    async def stop_after_one_cycle(_seconds):
        nonlocal sleeps
        sleeps += 1
        if sleeps > 1:
            raise asyncio.CancelledError

    cleanup = AsyncMock(side_effect=RuntimeError("database unavailable"))
    health_check = AsyncMock()
    monkeypatch.setattr(main, "_is_primary", True)
    monkeypatch.setattr(main, "_cleanup_stale_label_assets", cleanup)
    monkeypatch.setattr(main, "_watchdog_health_check", health_check)
    monkeypatch.setattr(main.asyncio, "sleep", stop_after_one_cycle)

    with pytest.raises(asyncio.CancelledError):
        await main._driver_watchdog()

    cleanup.assert_awaited_once()
    health_check.assert_awaited_once()


@pytest.mark.asyncio
async def test_standby_checks_for_takeover_before_sleeping(monkeypatch):
    takeover = AsyncMock()
    sleep = AsyncMock(side_effect=asyncio.CancelledError)
    monkeypatch.setattr(main, "_is_primary", False)
    monkeypatch.setattr(main, "_watchdog_try_takeover", takeover)
    monkeypatch.setattr(main.asyncio, "sleep", sleep)

    with pytest.raises(asyncio.CancelledError):
        await main._driver_watchdog()

    takeover.assert_awaited_once()
    sleep.assert_awaited_once_with(1)


async def test_draining_standby_leaves_takeover_to_serving_workers(tmp_path, monkeypatch):
    startup_lock = tmp_path / "startup.lock"
    start_drivers = AsyncMock()
    monkeypatch.setattr(main, "_STARTUP_LOCK_PATH", startup_lock)
    monkeypatch.setattr(main, "_start_primary_drivers", start_drivers)
    with socket() as listener:
        monkeypatch.setattr(worker_reload, "_worker_listeners", (listener,))
        assert not worker_reload.worker_is_draining()

    await main._watchdog_try_takeover()

    assert not startup_lock.exists()
    start_drivers.assert_not_awaited()


@pytest.mark.parametrize("drain_during", ["drivers", "socket"])
async def test_takeover_rolls_back_when_public_drain_starts(tmp_path, monkeypatch, drain_during):
    startup_lock = tmp_path / "startup.lock"
    stop_drivers = AsyncMock()
    close_private_socket = Mock()
    publish_private_socket = Mock()
    monkeypatch.setattr(main, "_STARTUP_LOCK_PATH", startup_lock)
    monkeypatch.setattr(main, "_lock_fd", None)
    monkeypatch.setattr(main, "_is_primary", False)
    monkeypatch.setattr(main.plugin_manager, "stop_all", stop_drivers)

    with socket() as listener, startup_lock.open("a") as next_worker:
        async def start_drivers():
            if drain_during == "drivers":
                listener.close()

        @asynccontextmanager
        async def private_socket(_app):
            assert not main._is_primary
            if drain_during == "socket":
                listener.close()
            try:
                yield publish_private_socket
            finally:
                close_private_socket()

        monkeypatch.setattr(worker_reload, "_worker_listeners", (listener,))
        monkeypatch.setattr(main.plugin_manager, "start_all", start_drivers)
        monkeypatch.setattr(main, "serve_primary_socket", private_socket)
        async with AsyncExitStack() as listeners:
            monkeypatch.setattr(main, "_primary_socket", listeners)
            await main._watchdog_try_takeover()

            assert not main._is_primary
            assert main._lock_fd is None
            main.fcntl.flock(next_worker, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)
            stop_drivers.assert_awaited_once()
            publish_private_socket.assert_not_called()
            assert close_private_socket.call_count == (drain_during == "socket")


async def test_cancelled_takeover_holds_election_lock_until_drivers_stop(tmp_path, monkeypatch):
    startup_lock = tmp_path / "startup.lock"
    stopping, stopped = asyncio.Event(), asyncio.Event()
    monkeypatch.setattr(main, "_STARTUP_LOCK_PATH", startup_lock)
    monkeypatch.setattr(main, "_lock_fd", None)
    monkeypatch.setattr(main, "_is_primary", False)

    async def stop_drivers():
        stopping.set()
        await stopped.wait()

    with socket() as listener, startup_lock.open("a") as next_worker:
        async def start_drivers():
            listener.close()

        monkeypatch.setattr(worker_reload, "_worker_listeners", (listener,))
        monkeypatch.setattr(main.plugin_manager, "start_all", start_drivers)
        monkeypatch.setattr(main.plugin_manager, "stop_all", stop_drivers)
        takeover = asyncio.create_task(main._watchdog_try_takeover())
        await asyncio.wait_for(stopping.wait(), 2)
        takeover.cancel()
        try:
            await asyncio.sleep(0)
            with pytest.raises(BlockingIOError):
                main.fcntl.flock(next_worker, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)
        finally:
            stopped.set()
            with suppress(asyncio.CancelledError):
                await takeover

        assert takeover.cancelled()
        main.fcntl.flock(next_worker, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)


async def test_startup_collects_display_state_before_opening_driver_routes(monkeypatch):
    health = {1: {"connected": True}}
    publish_health = Mock()

    def get_display_state():
        publish_health.assert_called_once_with(health, replace=True)
        return {}

    display_state = AsyncMock(side_effect=get_display_state)
    published = Mock(side_effect=lambda: display_state.assert_awaited_once())
    monkeypatch.setattr(main, "_is_primary", False)
    monkeypatch.setattr(main.plugin_manager, "start_all", AsyncMock())
    monkeypatch.setattr(main.plugin_manager, "get_health", Mock(return_value=health))
    monkeypatch.setattr(main.plugin_manager, "get_display_states", display_state)
    monkeypatch.setattr(main.shared_health_store, "publish", publish_health)

    @asynccontextmanager
    async def private_socket(_app):
        yield published

    monkeypatch.setattr(main, "serve_primary_socket", private_socket)
    async with AsyncExitStack() as listeners:
        monkeypatch.setattr(main, "_primary_socket", listeners)
        await main._start_primary_drivers(main.app)

    display_state.assert_awaited_once()
    published.assert_called_once()


async def test_driver_events_finish_before_primary_releases_election_lock(tmp_path, monkeypatch):
    from app.plugins.manager import PluginManager

    manager = PluginManager()
    started, release = asyncio.Event(), asyncio.Event()
    seen = []

    async def write_event(_printer_id, event):
        started.set()
        await release.wait()
        seen.append(event["value"])

    monkeypatch.setattr(manager, "_handle_event", write_event)
    emitter = manager._create_event_handler(1)
    emitter({"event_type": "slots_update", "value": "admitted"})
    await asyncio.wait_for(started.wait(), 1)

    lock_path = tmp_path / "election.lock"
    with lock_path.open("a") as current, lock_path.open("a") as successor:
        main.fcntl.flock(current, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)

        async def shutdown():
            await manager.stop_all()
            current.close()

        stopping = asyncio.create_task(shutdown())
        try:
            await asyncio.sleep(0)
            with pytest.raises(BlockingIOError):
                main.fcntl.flock(successor, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)
            emitter({"event_type": "slots_update", "value": "late"})
        finally:
            release.set()
            await asyncio.wait_for(stopping, 1)
            await asyncio.sleep(0)

        assert seen == ["admitted"]
        main.fcntl.flock(successor, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)


async def test_driver_event_timeout_waits_for_cancellation_cleanup(monkeypatch):
    from app.plugins import manager as plugin_manager_module

    manager = plugin_manager_module.PluginManager()
    started, cancelling, cleaned = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def write_event(*_args):
        started.set()
        try:
            await asyncio.Future()
        finally:
            cancelling.set()
            await cleaned.wait()

    monkeypatch.setattr(plugin_manager_module, "_EVENT_DRAIN_TIMEOUT", 0)
    monkeypatch.setattr(manager, "_handle_event", write_event)
    manager._create_event_handler(1)({"event_type": "slots_update"})
    await asyncio.wait_for(started.wait(), 1)

    stopping = asyncio.create_task(manager.stop_all())
    try:
        await asyncio.wait_for(cancelling.wait(), 1)
        assert not stopping.done()
    finally:
        cleaned.set()
        await asyncio.wait_for(stopping, 1)

    assert not manager._event_tasks


async def test_slow_display_snapshot_does_not_block_primary_publication(monkeypatch):
    published = Mock()
    health_snapshot = Mock()
    display_snapshot = Mock()

    async def slow_display():
        await asyncio.Future()

    @asynccontextmanager
    async def private_socket(_app):
        yield published

    monkeypatch.setattr(main, "_is_primary", False)
    monkeypatch.setattr(main, "serve_primary_socket", private_socket)
    monkeypatch.setattr(main.plugin_manager, "start_all", AsyncMock())
    monkeypatch.setattr(main.plugin_manager, "get_health", lambda: {})
    monkeypatch.setattr(main.plugin_manager, "get_display_states", slow_display)
    monkeypatch.setattr(main.shared_health_store, "publish", health_snapshot)
    monkeypatch.setattr(main.shared_display_store, "publish", display_snapshot)

    async with AsyncExitStack() as listeners:
        monkeypatch.setattr(main, "_primary_socket", listeners)
        await asyncio.wait_for(main._start_primary_drivers(main.app), 2)

    published.assert_called_once()
    display_snapshot.assert_called_once_with({}, replace=True)


async def test_primary_publication_survives_one_driver_health_failure(monkeypatch):
    from app.plugins.manager import PluginManager

    manager = PluginManager()
    manager.drivers.update({
        1: Mock(driver_key="fixture", health=Mock(side_effect=RuntimeError("driver still connecting")), stop=AsyncMock()),
        2: Mock(health=Mock(return_value={"connected": True}), stop=AsyncMock()),
    })
    published = Mock()
    health_snapshot = Mock()

    @asynccontextmanager
    async def private_socket(_app):
        yield published

    monkeypatch.setattr(main, "_is_primary", False)
    monkeypatch.setattr(main, "serve_primary_socket", private_socket)
    monkeypatch.setattr(main, "plugin_manager", manager)
    monkeypatch.setattr(manager, "start_all", AsyncMock())
    monkeypatch.setattr(manager, "get_display_states", AsyncMock(return_value={}))
    monkeypatch.setattr(main.shared_health_store, "publish", health_snapshot)
    monkeypatch.setattr(main.shared_display_store, "publish", Mock())

    async with AsyncExitStack() as listeners:
        monkeypatch.setattr(main, "_primary_socket", listeners)
        await main._start_primary_drivers(main.app)

    published.assert_called_once()
    assert health_snapshot.call_args.args[0][2] == {"connected": True}


def test_initial_driver_failure_is_visible_in_health_snapshot():
    from app.plugins.manager import PluginManager

    manager = PluginManager()
    manager.health_status[1] = {"status": "error", "message": "Driver unavailable"}
    manager.drivers[2] = Mock(health=Mock(return_value={"connected": True}))

    health = manager.get_health()

    assert health[1]["status"] == "error"
    assert health[2]["connected"] is True


async def test_cancelled_takeover_interrupts_startup_then_waits_for_cleanup(tmp_path, monkeypatch):
    lock = tmp_path / "startup.lock"
    starting, interrupted, stopping, release = (asyncio.Event() for _ in range(4))
    monkeypatch.setattr(main, "_STARTUP_LOCK_PATH", lock)
    monkeypatch.setattr(main, "_lock_fd", None)
    monkeypatch.setattr(main, "_is_primary", False)

    startup_gate = asyncio.Event()

    async def start():
        starting.set()
        try:
            await startup_gate.wait()
        finally:
            interrupted.set()

    async def stop():
        stopping.set()
        await release.wait()

    monkeypatch.setattr(main.plugin_manager, "start_all", start)
    monkeypatch.setattr(main.plugin_manager, "stop_all", stop)
    takeover = asyncio.create_task(main._watchdog_try_takeover())
    try:
        await asyncio.wait_for(starting.wait(), 1)
        takeover.cancel()
        await asyncio.wait_for(interrupted.wait(), 0.1)
        await asyncio.wait_for(stopping.wait(), 1)
        with lock.open("a") as successor, pytest.raises(BlockingIOError):
            main.fcntl.flock(successor, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)
    finally:
        release.set()
        startup_gate.set()
        with pytest.raises(asyncio.CancelledError):
            await takeover

    with lock.open("a") as successor:
        main.fcntl.flock(successor, main.fcntl.LOCK_EX | main.fcntl.LOCK_NB)
