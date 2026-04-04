"""Rate limiting utilities for brute-force protection."""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_client_ip(request: Request) -> str:
    """Extract real client IP from X-Forwarded-For or fall back to remote address.

    This handles reverse proxy setups where the real IP is in X-Forwarded-For.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2, ...
        # The first one is the original client
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


# Global limiter instance
# Uses in-memory storage by default (sufficient for single-instance deployments)
# For multi-instance deployments, configure Redis via storage_uri
limiter = Limiter(
    key_func=get_client_ip,
    headers_enabled=True,  # Sends X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
)
