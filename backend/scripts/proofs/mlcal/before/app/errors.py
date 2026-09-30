from enum import Enum
from typing import Any, Optional
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorCode(str, Enum):
    """Centralized error code registry used across all ML endpoints."""
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_IMAGE = "INVALID_IMAGE"
    BAD_REQUEST = "BAD_REQUEST"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """Base application exception producing the standard error shape."""
    def __init__(
        self,
        code: ErrorCode | str,
        message: str,
        status_code: int = 400,
        details: Optional[Any] = None
    ):
        self.code = code.value if isinstance(code, ErrorCode) else str(code)
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class BadRequestError(AppError):
    def __init__(self, message: str = "Invalid request", details: Optional[Any] = None):
        super().__init__(code=ErrorCode.BAD_REQUEST, message=message, status_code=400, details=details)


class InvalidImageError(AppError):
    def __init__(self, message: str = "Invalid image data provided", details: Optional[Any] = None):
        super().__init__(code=ErrorCode.INVALID_IMAGE, message=message, status_code=400, details=details)


class PayloadTooLargeError(AppError):
    def __init__(self, message: str = "Payload exceeds size limit", details: Optional[Any] = None):
        super().__init__(code=ErrorCode.PAYLOAD_TOO_LARGE, message=message, status_code=413, details=details)


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found", details: Optional[Any] = None):
        super().__init__(code=ErrorCode.NOT_FOUND, message=message, status_code=404, details=details)


class InternalServerError(AppError):
    def __init__(self, message: str = "Internal server error", details: Optional[Any] = None):
        super().__init__(code=ErrorCode.INTERNAL_ERROR, message=message, status_code=500, details=details)


def get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "") or request.headers.get("X-Request-ID", "unknown")


def make_error_payload(code: ErrorCode | str, message: str, details: Optional[Any], request_id: str) -> dict:
    code_val = code.value if isinstance(code, ErrorCode) else str(code)
    return {
        "code": code_val,
        "message": message,
        "details": details,
        "requestId": request_id
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    request_id = get_request_id(request)
    payload = make_error_payload(exc.code, exc.message, exc.details, request_id)
    return JSONResponse(status_code=exc.status_code, content=payload)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = get_request_id(request)
    errors = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        errors.append({"field": loc, "message": err.get("msg", "Invalid value")})
    payload = make_error_payload(ErrorCode.VALIDATION_ERROR, "Request validation failed", errors, request_id)
    return JSONResponse(status_code=422, content=payload)


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    request_id = get_request_id(request)
    code = ErrorCode.BAD_REQUEST
    if exc.status_code == 404:
        code = ErrorCode.NOT_FOUND
    elif exc.status_code == 405:
        code = ErrorCode.METHOD_NOT_ALLOWED
    payload = make_error_payload(code, str(exc.detail), None, request_id)
    return JSONResponse(status_code=exc.status_code, content=payload)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = get_request_id(request)
    payload = make_error_payload(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred while processing the request",
        None,
        request_id
    )
    return JSONResponse(status_code=500, content=payload)
