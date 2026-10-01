"""
Best-effort OCR: a rotated, blurry or cropped scan of every document type is
never rejected by the quality gate, and extraction keeps whatever it reads
(each field with its own confidence). Only a file unusable as a file is
rejected (tests/test_quality.py).
"""

import base64

import cv2
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.ocr_repair import repair_ocr_text
from app.services.ocr_service import deskew, enhance, rotate_quarter
from doc_render import render_document
from test_extract import SAMPLE_DOCS


def _decode(b64: str) -> np.ndarray:
    return cv2.imdecode(
        np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR
    )


def _encode(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def rotated_90(img: np.ndarray) -> np.ndarray:
    return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)


def skewed(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), 6, 1.0)
    return cv2.warpAffine(img, m, (w, h), borderValue=(235, 235, 235))


def blurry(img: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), 2.2)


def cropped(img: np.ndarray) -> np.ndarray:
    # Right edge cut through the text and the last line half gone.
    h, w = img.shape[:2]
    return img[: h - 30, : int(w * 0.8)]


DEGRADATIONS = {
    "rotated_90": rotated_90,
    "skewed": skewed,
    "blurry": blurry,
    "cropped": cropped,
}
CASES = [(t, d) for t in SAMPLE_DOCS for d in DEGRADATIONS]


def _read(values: dict) -> list:
    return [k for k, v in values.items() if v not in (None, "", [])]


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type, degradation", CASES)
async def test_degraded_scan_is_accepted_and_partly_read(doc_type, degradation):
    img = DEGRADATIONS[degradation](_decode(render_document(SAMPLE_DOCS[doc_type])))
    b64 = _encode(img)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        quality = (
            await client.post("/v1/documents/quality", json={"image_base64": b64})
        ).json()
        # Blur, rotation and crop are warnings at most: never a rejection.
        assert quality["value"]["usable"] is True, quality
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": b64, "document_type": doc_type},
        )
    assert resp.status_code == 200
    data = resp.json()
    # Every field is reported with its own confidence, read or not.
    assert set(data["value"]) == set(data["confidence"])
    for k, v in data["value"].items():
        c = data["confidence"][k]
        assert 0.0 <= c <= 1.0
        assert (c > 0.0) == (v not in (None, "", [])), (k, v, c)
    # Whatever could be read is kept: at least one field on every degraded scan.
    assert _read(data["value"]), (doc_type, degradation, data["raw_text"][:300])


@pytest.mark.asyncio
async def test_rotated_scan_reads_as_much_as_upright():
    text = SAMPLE_DOCS["INCOME_CERTIFICATE"]
    upright = render_document(text)
    turned = _encode(rotated_90(_decode(upright)))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        body = {"document_type": "INCOME_CERTIFICATE"}
        a = (
            await client.post(
                "/v1/documents/extract", json={**body, "image_base64": upright}
            )
        ).json()
        b = (
            await client.post(
                "/v1/documents/extract", json={**body, "image_base64": turned}
            )
        ).json()
    assert (
        b["value"]["family_income_annual"]
        == a["value"]["family_income_annual"]
        == 268000
    )
    # Read from a later (upright / rotated) pass: a real, confident reading.
    assert b["confidence"]["family_income_annual"] >= 0.5


def test_preprocessing_keeps_a_readable_page():
    img = _decode(render_document(SAMPLE_DOCS["MARKSHEET"]))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, None, fx=0.4, fy=0.4)
    factor = max(enhance(small).shape) / max(small.shape)
    assert factor in (2.0, 3.0, 4.0)  # small photos: whole-factor upscale
    assert enhance(gray).shape == gray.shape  # legible pages are not resized
    assert rotate_quarter(rotate_quarter(gray, 1), 3).shape == gray.shape
    tilted = cv2.cvtColor(skewed(img), cv2.COLOR_BGR2GRAY)
    assert deskew(tilted).shape == tilted.shape


@pytest.mark.parametrize(
    "noisy, repaired",
    [
        ("Anual lncome : Rs. 1,2O,OOO", "Annual income : Rs. 1,20,000"),
        ("Certifcate No; INC/2O24/0O1", "Certificate No: INC/2024/001"),
        ("Date of lssue : l2 / 04/ 2O24", "Date of issue : 12/04/2024"),
        ("Amount Paid: Rs.45,OOO/-", "Amount Paid: Rs.45,000/-"),
        ("Percentaqe: 78.5O", "Percentage: 78.50"),
        # Left alone: codes with real letters, and names.
        ("IFSC: SBIN0001234", "IFSC: SBIN0001234"),
        ("Name: Sonal Kumari", "Name: Sonal Kumari"),
        ("Shri Ramu Oraon", "Shri Ramu Oraon"),
    ],
)
def test_ocr_noise_repair(noisy, repaired):
    assert repair_ocr_text(noisy) == repaired
