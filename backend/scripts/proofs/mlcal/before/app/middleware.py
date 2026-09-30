import uuid
from typing import Callable
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
