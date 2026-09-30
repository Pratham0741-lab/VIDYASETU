from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.errors import (
    AppError,
    app_error_handler,
    validation_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
)
from app.health import router as health_router
from app.logging import logger
from app.middleware import RequestIDMiddleware
from app.routes.quality import router as quality_router
from app.routes.classify import router as classify_router
from app.routes.extract import router as extract_router
from app.routes.consistency import router as consistency_router
from app.routes.crop import router as crop_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup validation and logging
    logger.info(f"Starting VIDYASETU ML Service [env={settings.environment}]")
    logger.info(f"Models directory: {settings.models_dir} (from ML_MODELS_DIR)")
    if not settings.models_path.is_dir():
        # The four engines need no weight files, so this is not fatal, but
        # the configured path is wrong and /health reports it.
        logger.warning(f"ML_MODELS_DIR {settings.models_dir} is not a directory")
    yield
    logger.info("Shutting down VIDYASETU ML Service")


app = FastAPI(
    title="VIDYASETU ML Service",
    description="Offline Document Verification, Quality Gate, Classification, Extraction, and Consistency API",
    version="0.1.0",
    lifespan=lifespan,
)

# Request ID propagation middleware
app.add_middleware(RequestIDMiddleware)

# Standardized Error Handlers
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

# Routers
app.include_router(health_router)
# Document endpoints live under the api's contract prefix
# (api/src/ml-client/document-api.ts: ML_DOCUMENT_PATHS).
DOCUMENTS_PREFIX = "/v1/documents"
app.include_router(quality_router, prefix=DOCUMENTS_PREFIX)
app.include_router(classify_router, prefix=DOCUMENTS_PREFIX)
app.include_router(extract_router, prefix=DOCUMENTS_PREFIX)
app.include_router(consistency_router, prefix=DOCUMENTS_PREFIX)
app.include_router(crop_router, prefix=DOCUMENTS_PREFIX)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
