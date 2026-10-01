import asyncio
import uuid
from typing import Callable, Optional
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Ensures every request has a request ID.
    Reads X-Request-ID from request headers or generates a new UUID v4.
    Attaches it to request.state.request_id and includes X-Request-ID in response headers.
    """
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = request.headers.get("X-Request-ID")
        if not request_id:
            request_id = str(uuid.uuid4())

        # Store on request.state
        request.state.request_id = request_id

        # Process the request
        response = await call_next(request)

        # Set header on response
        response.headers["X-Request-ID"] = request_id
        return response


class DocumentConcurrencyMiddleware(BaseHTTPMiddleware):
    """
    Processes at most `limit` document requests (paths under `prefix`) at a
    time; the rest wait their turn. OCR uses several CPU threads and up to
    ~2.5 GB per page, so one document at a time keeps the service inside its
    memory limit and gives each page the whole CPU. Health checks are not
    queued.
    """

    def __init__(self, app, prefix: str, limit: int = 1):
        super().__init__(app)
        self.prefix = prefix
        self.limit = max(1, limit)
        self._slots: Optional[asyncio.Semaphore] = None

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not request.url.path.startswith(self.prefix):
            return await call_next(request)
        if self._slots is None:  # created inside the running event loop
            self._slots = asyncio.Semaphore(self.limit)
        async with self._slots:
            return await call_next(request)
