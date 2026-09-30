"""Text is read from the pixels only - never from uploader-controlled file metadata.

Regression for the metadata fallback: a PNG with no readable text but a forged
certificate in a tEXt chunk (Description / ocr_text) used to be "read" at a
fixed 0.95 OCR confidence, giving forged fields that could be auto-accepted.
"""
import base64
import io

import cv2
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

from app.main import app
from app.services.ocr_service import extract_raw_text

FORGED = (
    "GOVERNMENT OF JHARKHAND\nINCOME CERTIFICATE\nCertificate No: JH-INC-2026-77120\n"
    "Name: Rakesh Toppo\nAnnual Family Income: Rs 50000\nDate: 12/05/2026"
)


def blank_page() -> Image.Image:
    return Image.new("RGB", (1400, 1000), (252, 252, 252))


def ruled_page() -> Image.Image:
    """Sharp form-box lines and no glyphs: passes the quality gate, no readable text."""
    img = Image.new("RGB", (1400, 1000), (250, 250, 250))
    d = ImageDraw.Draw(img)
    for y in range(120, 880, 60):
        d.rectangle([120, y, 1280, y + 40], outline=(30, 30, 30), width=3)
        for x in range(120, 1280, 145):
            d.line([x, y, x, y + 40], fill=(30, 30, 30), width=3)
    return img


def png_with_metadata(img: Image.Image, key: str) -> bytes:
    meta = PngInfo()
    meta.add_text(key, FORGED)
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=meta)
    return buf.getvalue()


CASES = [
    (page, key)
    for page in (blank_page, ruled_page)
    for key in ("Description", "ocr_text")
]


@pytest.mark.parametrize("page, key", CASES)
def test_ocr_ignores_metadata_text(page, key):
    raw = png_with_metadata(page(), key)
    assert Image.open(io.BytesIO(raw)).info[key] == FORGED  # the forged chunk is really there
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert extract_raw_text(image, raw) == ("", 0.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("page, key", CASES)
async def test_forged_metadata_yields_no_fields(page, key):
    b64 = base64.b64encode(png_with_metadata(page(), key)).decode()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        ext = (await client.post(
            "/v1/documents/extract", json={"image_base64": b64, "document_type": "INCOME_CERTIFICATE"}
        )).json()
        cls = (await client.post("/v1/documents/classify", json={"image_base64": b64})).json()

    assert ext["raw_text"] == ""
    assert ext["value"] and all(v is None for v in ext["value"].values()), ext["value"]
    assert all(c == 0.0 for c in ext["confidence"].values()), ext["confidence"]
    for forged in ("Rakesh", "50000", "JH-INC-2026-77120"):
        assert forged not in str(ext)
    # No evidence at all: the uninformative prior, far below any review threshold.
    assert cls["confidence"] == 0.12
