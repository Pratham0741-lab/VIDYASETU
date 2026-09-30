import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict

from app.config import settings


class JSONFormatter(logging.Formatter):
    """Formats log records as structured JSON."""
    def format(self, record: logging.LogRecord) -> str:
        log_obj: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include request ID if attached to record
        request_id = getattr(record, "request_id", None)
        if request_id:
            log_obj["requestId"] = request_id

        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_obj)


def setup_logging(log_level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger("vidyasetu_ml")
    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicates
    logger.handlers.clear()
    logger.propagate = False

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    logger.addHandler(handler)

    # Configure uvicorn loggers to match. The handler goes on the parent
    # "uvicorn" logger only: "uvicorn.error" and "uvicorn.access" propagate to
    # it. (Attaching it to the children as well emitted every line twice.)
    uvicorn_parent = logging.getLogger("uvicorn")
    uvicorn_parent.handlers.clear()
    uvicorn_parent.addHandler(handler)
    uvicorn_parent.propagate = False
    for child_name in ("uvicorn.error", "uvicorn.access"):
        child = logging.getLogger(child_name)
        child.handlers.clear()
        child.propagate = True

    return logger


logger = setup_logging(settings.log_level)
