import cv2
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.utils.image import encode_image_to_base64


def create_test_image(width=800, height=600, blur=False, glare=False, dark=False, slight_blur=False) -> str:
    """Helper to generate synthetic test images with known visual properties."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 200

    # Draw geometric patterns and text lines
    # First baseline at y=40: at y=10 the first line's letters were sliced by the
    # top edge, i.e. the "clean" image was itself cropped (cut_off_edge is right).
    for i in range(40, height - 20, 30):
        cv2.putText(img, f"Document Line Test Record {i} VIDYASETU Verification Text", 
                    (20, i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 1)
        cv2.rectangle(img, (50, i), (width - 50, i + 10), (40, 40, 40), 1)

    if dark:
        img = (img * 0.1).astype(np.uint8)

    if glare:
        cv2.circle(img, (width // 2, height // 2), int(min(width, height) * 0.3), (255, 255, 255), -1)

    if blur:
        img = cv2.GaussianBlur(img, (31, 31), 0)
    elif slight_blur:
        # Subtle blur creating blur variance near threshold (~75 vs 100) -> yields low certainty (~0.67)
        img = cv2.GaussianBlur(img, (7, 7), 0)

    return encode_image_to_base64(img)


@pytest.mark.asyncio
async def test_quality_clean_image():
    clean_b64 = create_test_image(width=800, height=600)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": clean_b64})
        assert resp.status_code == 200
        data = resp.json()
        assert data["value"]["usable"] is True
        assert data["value"]["issues"] == []
        # Clear pass: high certainty in the verdict
        assert data["confidence"] >= 0.85
        assert data["details"]["resolution"] == [800, 600]
        assert data["details"]["blur_score"] > 100.0


@pytest.mark.asyncio
async def test_quality_blurred_image():
    blurred_b64 = create_test_image(width=800, height=600, blur=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": blurred_b64})
        assert resp.status_code == 200
        data = resp.json()
        # A warning, never a rejection: OCR still runs on it.
        assert data["value"]["usable"] is True
        assert "blurred" in data["value"]["issues"]
        assert "blurred" in data["value"]["warnings"]
        # Clear failure: high certainty that image is indeed defective
        assert data["confidence"] >= 0.85
        assert data["details"]["blur_score"] < 50.0


@pytest.mark.asyncio
async def test_quality_borderline_case():
    # Subtle blur creating blur variance near threshold -> lower certainty to trigger human review
    borderline_b64 = create_test_image(width=800, height=600, slight_blur=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": borderline_b64})
        assert resp.status_code == 200
        data = resp.json()
        # Borderline cases must yield lower certainty to flag for human review (<0.75)
        assert data["confidence"] <= 0.75


@pytest.mark.asyncio
async def test_quality_low_resolution():
    low_res_b64 = create_test_image(width=250, height=250)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": low_res_b64})
        assert resp.status_code == 200
        data = resp.json()
        # A warning, never a rejection: OCR still runs on it.
        assert data["value"]["usable"] is True
        assert "low_resolution" in data["value"]["issues"]
        assert "low_resolution" in data["value"]["warnings"]
        # High certainty of defect
        assert data["confidence"] >= 0.80


@pytest.mark.asyncio
async def test_quality_glare_image():
    glare_b64 = create_test_image(width=800, height=600, glare=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": glare_b64})
        assert resp.status_code == 200
        data = resp.json()
        # A warning, never a rejection: OCR still runs on it.
        assert data["value"]["usable"] is True
        assert "glare_detected" in data["value"]["issues"]
        assert "glare_detected" in data["value"]["warnings"]
        assert data["confidence"] >= 0.80


@pytest.mark.asyncio
async def test_quality_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={})
        assert resp.status_code == 422
        data = resp.json()
        assert data["code"] == "VALIDATION_ERROR"
        assert "requestId" in data


@pytest.mark.asyncio
async def test_quality_garbage_image():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/quality", json={"image_base64": "ThisIsNotValidBase64Data!*#&@"})
        # Unreadable as a file: a clean "not usable" verdict (upload again), not an error.
        assert resp.status_code == 200
        data = resp.json()
        assert data["value"]["usable"] is False
        assert data["value"]["issues"] == ["unreadable_file"]


@pytest.mark.asyncio
async def test_quality_blank_page_is_the_only_content_rejection():
    blank = encode_image_to_base64(np.full((1200, 900, 3), 240, dtype=np.uint8))
    dark = create_test_image(width=800, height=600, dark=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        data = (await client.post("/v1/documents/quality", json={"image_base64": blank})).json()
        assert data["value"]["usable"] is False
        assert "blank_page" in data["value"]["issues"]
        data = (await client.post("/v1/documents/quality", json={"image_base64": dark})).json()
        assert data["value"]["usable"] is True
        assert "blank_page" not in data["value"]["issues"]
