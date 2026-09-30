"""
Phase 13D: field boxes and the crop endpoint.

Ground truth is the renderer's own layout (doc_render.render_document_layout),
never the OCR output. A returned box must overlap the true region of the
value: at least half of the true region lies inside it, and it is no more
than three times the true region's area (so a page-sized box cannot pass).
"""

import base64
import io

import cv2
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app
from app.services.field_boxes import to_stored_coordinates
from doc_render import render_document_layout, true_region

INCOME = (
    "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT\n"
    "INCOME CERTIFICATE\n"
    "Certificate No: INC-JH-2025-04471\n"
    "This is to certify that annual family income from all sources of Shri Rahul Kumar\n"
    "is Rs. 2,68,000 (Rupees Two Lakh Sixty Eight Thousand Only) per annum.\n"
    "Issued by: Tahsildar, Ranchi Sadar Date: 14/03/2025"
)


def png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def overlap_ok(box: dict, truth: tuple[int, int, int, int]) -> bool:
    bx, by, bw, bh = box["x"], box["y"], box["width"], box["height"]
    tx, ty, tw, th = truth
    ix = max(0, min(bx + bw, tx + tw) - max(bx, tx))
    iy = max(0, min(by + bh, ty + th) - max(by, ty))
    inter = ix * iy
    return inter >= 0.5 * tw * th and bw * bh <= 3 * tw * th


async def extract(b64: str, document_type: str = "INCOME_CERTIFICATE") -> dict:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/v1/documents/extract", json={"image_base64": b64, "document_type": document_type})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_boxes_overlap_the_true_regions():
    img, words = render_document_layout(INCOME)
    body = await extract(png_b64(img))
    v, boxes = body["value"], body["boxes"]
    assert v["issued_date"] == "2025-03-14"
    assert v["certificate_number"] == "INC-JH-2025-04471"
    assert v["family_income_annual"] == 268000
    assert v["applicant_name"] == "Rahul Kumar"
    truth = {
        "issued_date": true_region(words, "14/03/2025"),
        "certificate_number": true_region(words, "INC-JH-2025-04471"),
        "family_income_annual": true_region(words, "2,68,000"),
        "applicant_name": true_region(words, "Rahul", "Kumar"),
    }
    for field, region in truth.items():
        box = boxes[field]
        assert box is not None, field
        assert box["page"] == 1 and box["coordinate_space"] == "stored_image_pixels"
        assert overlap_ok(box, region), (field, box, region)


@pytest.mark.asyncio
async def test_a_value_read_in_two_places_gets_no_box():
    text = INCOME + "\nValid from 14/03/2025 for one year. Date: 14/03/2025"
    img, _ = render_document_layout(text)
    body = await extract(png_b64(img))
    assert body["value"]["issued_date"] == "2025-03-14"
    assert body["boxes"]["issued_date"] is None  # two places: no guess
    assert body["boxes"]["certificate_number"] is not None


@pytest.mark.asyncio
async def test_a_field_not_found_has_no_box():
    img, _ = render_document_layout("GOVERNMENT OF JHARKHAND\nINCOME CERTIFICATE\nCertificate No: INC-JH-2025-04471")
    body = await extract(png_b64(img))
    assert body["value"]["issued_date"] is None
    assert body["boxes"]["issued_date"] is None


def exif_rotated_jpeg(upright: np.ndarray) -> str:
    """The upright page stored rotated 90 degrees counter-clockwise with EXIF
    orientation 6 (display: rotate 90 clockwise) - how phone cameras save."""
    stored = np.ascontiguousarray(np.rot90(upright, 1))
    pil = Image.fromarray(cv2.cvtColor(stored, cv2.COLOR_BGR2RGB))
    exif = Image.Exif()
    exif[0x0112] = 6
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=95, exif=exif.tobytes())
    return base64.b64encode(buf.getvalue()).decode()


def upright_to_stored_rot90ccw(region, upright_width):
    """np.rot90(k=1): upright (x, y) -> stored (y, W - x). Independent of the service."""
    x, y, w, h = region
    return y, upright_width - (x + w), h, w


@pytest.mark.asyncio
async def test_exif_rotated_photo_boxes_are_in_the_stored_pixel_grid():
    img, words = render_document_layout(INCOME)
    b64 = exif_rotated_jpeg(img)
    decoded = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[:2] == img.shape[:2]  # the decoder applied the orientation
    body = await extract(b64)
    assert body["value"]["issued_date"] == "2025-03-14"
    box = body["boxes"]["issued_date"]
    expected = upright_to_stored_rot90ccw(true_region(words, "14/03/2025"), img.shape[1])
    assert overlap_ok(box, expected), (box, expected)


def test_orientation_mapping_round_trip():
    # A box in a 100x40 display of a 40x100 stored image, for every orientation.
    for o in range(1, 9):
        stored = (40, 100) if o in (5, 6, 7, 8) else (100, 40)
        x, y, w, h = to_stored_coordinates((10, 5, 20, 10), o, stored)
        assert 0 <= x and 0 <= y and x + w <= stored[0] and y + h <= stored[1], o
        assert w * h == 200, o


@pytest.mark.asyncio
async def test_crop_returns_only_the_region_upright():
    img, words = render_document_layout(INCOME)
    b64 = exif_rotated_jpeg(img)
    box = (await extract(b64))["boxes"]["issued_date"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/v1/documents/crop", json={"image_base64": b64, **{k: box[k] for k in ("x", "y", "width", "height")}, "margin": 10})
        assert r.status_code == 200, r.text
        crop = cv2.imdecode(np.frombuffer(base64.b64decode(r.json()["png_base64"]), np.uint8), cv2.IMREAD_COLOR)
        # Upright: a one-word date region is wider than tall; far smaller than the page.
        assert crop.shape[1] > crop.shape[0]
        assert crop.shape[0] * crop.shape[1] < 0.05 * img.shape[0] * img.shape[1]
        big = await ac.post("/v1/documents/crop", json={"image_base64": b64, "x": 0, "y": 0, "width": img.shape[0], "height": img.shape[1]})
        assert big.status_code == 422
        assert big.json()["error"]["code"] == "UNPROCESSABLE_ENTITY" if "error" in big.json() else big.json()["code"] == "UNPROCESSABLE_ENTITY"
