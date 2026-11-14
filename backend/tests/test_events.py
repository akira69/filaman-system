import asyncio
from socket import socket

import pytest
from starlette.requests import Request

from app.api.v1.events import event_stream
from app.core import worker_reload
from app.core.event_bus import event_bus


@pytest.mark.asyncio
async def test_idle_event_stream_closes_when_worker_drains(monkeypatch):
    with socket() as listener:
        monkeypatch.setattr(worker_reload, "_worker_listeners", (listener,))
        stream = (await event_stream(Request({"type": "http"}))).body_iterator
        try:
            assert await anext(stream) == ": connected\n\n"
            next_message = asyncio.create_task(anext(stream))
            await asyncio.sleep(0)
            assert not next_message.done()
            listener.close()
            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(next_message, timeout=2)
        finally:
            await stream.aclose()
        assert not event_bus._subscribers


async def test_slow_event_subscriber_is_closed_without_affecting_others():
    from app.core.event_bus import EventBus

    bus = EventBus()
    slow = bus.subscribe()
    fast = bus.subscribe()
    fast_next = asyncio.create_task(anext(fast))
    slow_next = asyncio.create_task(anext(slow))
    await asyncio.sleep(0)
    await bus.publish({"event": "first"})
    assert await slow_next == await fast_next

    for index in range(65):
        await bus.publish({"event": "update", "index": index})
        assert '"index":' in await anext(fast)

    with pytest.raises(StopAsyncIteration):
        await anext(slow)
    await fast.aclose()
