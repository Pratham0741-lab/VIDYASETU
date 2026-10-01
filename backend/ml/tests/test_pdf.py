"""
Phase 13E: PDF uploads - page 1 rasterised at PDF_RASTER_DPI and passed
through the same quality / classify / extract / crop path; unusable PDFs
fail cleanly (a quality issue at the gate, 422 elsewhere). Ground truth is
the renderer's own layout; the overlap rule is test_field_boxes.py's.
"""

import base64

import cv2
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.utils.pdf import PDF_RASTER_DPI
from doc_render import handmade_pdf, render_pdf, true_region
from test_field_boxes import INCOME, overlap_ok

B64 = lambda b: base64.b64encode(b).decode()  # noqa: E731

# A realistic page height: the 6-line INCOME page is 344 px tall, under the
# quality gate's 400 px minimum (settings.min_height) - the gate is right to
# reject it, so the PDF tests use the certificate with its usual footer lines.
CERT = "\n".join(
    [
        INCOME,
        "Office of the Circle Officer, Ranchi Sadar, Jharkhand",
        "Seal and signature of the issuing authority",
        "This certificate is issued on the basis of the enquiry report.",
        "Verify at the district e-District portal.",
    ]
)


async def post(path: str, body: dict):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        return await ac.post(f"/v1/documents/{path}", json=body)


def test_the_generated_pdf_rasterises_to_the_rendered_page():
    pdf, _ = render_pdf(CERT)
    assert pdf[:5] == b"%PDF-"
    from app.utils.pdf import rasterise_first_page
    from doc_render import render_document_layout

    image, info = rasterise_first_page(pdf)
    expected, _ = render_document_layout(CERT)
    # Same pixel grid at the same dpi (PDFium rounds the page size up: +-1 px at 300 dpi).
    assert image.shape[2] == expected.shape[2]
    assert all(abs(a - b) <= 1 for a, b in zip(image.shape[:2], expected.shape[:2]))
    assert info == {"page_count": 1, "page_used": 1, "page_size_pt": info["page_size_pt"], "dpi": PDF_RASTER_DPI}


@pytest.mark.asyncio
async def test_pdf_certificate_values_and_boxes_overlap_the_true_regions():
    pdf, words = render_pdf(CERT)
    q = await post("quality", {"image_base64": B64(pdf)})
    assert q.status_code == 200 and q.json()["value"]["usable"] is True
    assert q.json()["details"]["pdf"]["page_count"] == 1
    r = await post("extract", {"image_base64": B64(pdf), "document_type": "INCOME_CERTIFICATE"})
    assert r.status_code == 200, r.text
    v, boxes = r.json()["value"], r.json()["boxes"]
    assert v["issued_date"] == "2025-03-14"
    assert v["certificate_number"] == "INC-JH-2025-04471"
    assert v["family_income_annual"] == 268000
    assert v["applicant_name"] == "Rahul Kumar"
    for field, truth in {
        "issued_date": true_region(words, "14/03/2025"),
        "certificate_number": true_region(words, "INC-JH-2025-04471"),
        "family_income_annual": true_region(words, "2,68,000"),
        "applicant_name": true_region(words, "Rahul", "Kumar"),
    }.items():
        box = boxes[field]
        assert box is not None, field
        assert box["coordinate_space"] == f"pdf_page1_raster_{PDF_RASTER_DPI}dpi"
        assert overlap_ok(box, truth), (field, box, truth)


@pytest.mark.asyncio
async def test_multi_page_pdf_reads_page_one_only():
    page2 = CERT.replace("INC-JH-2025-04471", "INC-JH-2099-99999")
    pdf, _ = render_pdf(CERT, extra_pages=[page2])
    q = (await post("quality", {"image_base64": B64(pdf)})).json()
    assert q["details"]["pdf"] == {**q["details"]["pdf"], "page_count": 2, "page_used": 1}
    r = (await post("extract", {"image_base64": B64(pdf), "document_type": "INCOME_CERTIFICATE"})).json()
    assert r["value"]["certificate_number"] == "INC-JH-2025-04471"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "label,data,issue",
    [
        ("encrypted", handmade_pdf(encrypt=True), "pdf_encrypted"),
        ("corrupt", b"%PDF-1.4\n" + bytes(range(256)) * 4, "pdf_unreadable"),
        ("truncated header only", b"%PDF-1.7\n", "pdf_unreadable"),
        ("oversized page", handmade_pdf(media_box="0 0 5000 5000"), "pdf_too_large"),
    ],
)
async def test_unusable_pdfs_fail_cleanly(label, data, issue):
    q = await post("quality", {"image_base64": B64(data)})
    assert q.status_code == 200, (label, q.text)
    assert q.json()["value"] == {"usable": False, "issues": [issue], "warnings": []}, label
    for path, body in [("classify", {}), ("extract", {"document_type": "INCOME_CERTIFICATE"}), ("crop", {"x": 1, "y": 1, "width": 5, "height": 5})]:
        r = await post(path, {"image_base64": B64(data), **body})
        assert r.status_code == 422, (label, path, r.status_code, r.text)
        assert "pdf_issue" in r.text and issue in r.text, (label, path, r.text)


def test_a_normal_blank_handmade_pdf_is_readable():
    from app.utils.pdf import rasterise_first_page

    image, info = rasterise_first_page(handmade_pdf())
    assert info["page_size_pt"] == [595.0, 842.0]
    want = (842 * PDF_RASTER_DPI / 72, 595 * PDF_RASTER_DPI / 72)
    assert all(abs(a - b) <= 1 for a, b in zip(image.shape[:2], want))


@pytest.mark.asyncio
async def test_pdf_crop_returns_only_the_region():
    pdf, words = render_pdf(CERT)
    box = (await post("extract", {"image_base64": B64(pdf), "document_type": "INCOME_CERTIFICATE"})).json()["boxes"]["issued_date"]
    r = await post("crop", {"image_base64": B64(pdf), **{k: box[k] for k in ("x", "y", "width", "height")}, "margin": 10})
    assert r.status_code == 200, r.text
    crop = cv2.imdecode(np.frombuffer(base64.b64decode(r.json()["png_base64"]), np.uint8), cv2.IMREAD_COLOR)
    tx, ty, tw, th = true_region(words, "14/03/2025")
    assert crop.shape[1] >= tw and crop.shape[0] >= th  # the whole date fits
    page = cv2.imdecode(np.frombuffer(pdf, np.uint8), cv2.IMREAD_COLOR)
    assert page is None  # a PDF is not an image: only the ml service's rasteriser reads it
    from doc_render import render_document_layout

    h, w = render_document_layout(CERT)[0].shape[:2]
    assert crop.shape[0] * crop.shape[1] < 0.05 * w * h
    big = await post("crop", {"image_base64": B64(pdf), "x": 0, "y": 0, "width": w, "height": h})
    assert big.status_code == 422
