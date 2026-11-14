"""Cancellation helpers for work that must settle before ownership changes."""

import asyncio
import logging
from collections.abc import Awaitable

logger = logging.getLogger(__name__)


async def finish_on_cancel(work: Awaitable[None]) -> None:
    """Wait for cleanup to settle, then propagate cancellation of the caller."""
    caller = asyncio.current_task()
    assert caller is not None
    initial_cancellations = caller.cancelling()
    task = asyncio.ensure_future(work)
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break

    if caller.cancelling() > initial_cancellations:
        if not task.cancelled() and (exc := task.exception()) is not None:
            logger.error("Cleanup failed during cancellation", exc_info=exc)
        raise asyncio.CancelledError
    if task.cancelled():
        raise RuntimeError("Cleanup cancelled itself")
    task.result()


async def await_driver_startup(work: Awaitable[object], timeout: float) -> object:
    """Bound plugin startup and distinguish child cancellation from worker shutdown."""
    async with asyncio.timeout(timeout):
        result, = await asyncio.gather(work, return_exceptions=True)
    if isinstance(result, asyncio.CancelledError):
        raise RuntimeError("Driver startup cancelled itself")
    if isinstance(result, BaseException):
        raise result
    return result
