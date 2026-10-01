"""The ml service processes one document at a time (DocumentConcurrencyMiddleware)."""

import asyncio
import threading
import time

import pytest
from httpx import ASGITransport, AsyncClient

import app.routes.extract as extract_route
from app.config import settings
from app.main import app


@pytest.mark.asyncio
async def test_documents_are_processed_one_at_a_time(monkeypatch):
    assert settings.max_concurrent_documents == 1
    lock = threading.Lock()
    state = {"in_flight": 0, "max": 0}

    def slow_extract(**_):
        with lock:
            state["in_flight"] += 1
            state["max"] = max(state["max"], state["in_flight"])
        time.sleep(0.3)
        with lock:
            state["in_flight"] -= 1
        return {
            "value": {},
            "confidence": {},
            "raw_text": "",
            "document_type": "MARKSHEET",
            "document_type_confidence": 1.0,
            "low_confidence_auto_classification": False,
            "boxes": {},
        }

    monkeypatch.setattr(extract_route, "extract_document_fields", slow_extract)
    monkeypatch.setattr(
        extract_route, "decode_base64_image_with_bytes", lambda _: (None, b"")
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        body = {"image_base64": "eA==", "document_type": "MARKSHEET"}
        started = time.monotonic()
        responses = await asyncio.gather(
            *(client.post("/v1/documents/extract", json=body) for _ in range(3))
        )
        elapsed = time.monotonic() - started
        # Health is never queued behind documents.
        assert (await client.get("/health")).status_code == 200
    assert all(r.status_code == 200 for r in responses)
    assert state["max"] == 1
    assert elapsed >= 0.85  # three documents, one after another
