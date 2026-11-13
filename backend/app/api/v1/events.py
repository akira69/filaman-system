"""SSE stream endpoint — pushes real-time events to connected frontends."""

from contextlib import aclosing

from fastapi import APIRouter
from starlette.requests import Request
from starlette.responses import StreamingResponse

from app.core.event_bus import event_bus

router = APIRouter(prefix="/events", tags=["Events"])


@router.get("/stream")
async def event_stream(request: Request) -> StreamingResponse:
    """Server-Sent Events endpoint.

    Frontend connects via EventSource('/api/v1/events/stream').
    Receives JSON events like: {"event": "slots_update", "printer_id": 1}
    """

    async def generate():
        # Send initial keepalive so the connection is established
        yield ": connected\n\n"

        async with aclosing(event_bus.subscribe()) as subscription:
            async for data in subscription:
                if await request.is_disconnected():
                    break
                yield f"data: {data}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
