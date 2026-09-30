import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health", headers={"X-Request-ID": "test-req-123"})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["modelsDirExists"] is True
        assert data["modelsPresent"] is True
        assert data["models"]["quality_gate"] == "ready"
        assert data["models"]["classifier"] == "ready"
        assert data["models"]["extractor"] == "ready"
        assert data["models"]["consistency_checker"] == "ready"
        assert response.headers.get("X-Request-ID") == "test-req-123"
