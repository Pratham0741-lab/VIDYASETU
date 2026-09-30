"""
PDF uploads (Phase 13E): page 1 rasterised to an image, so PDFs go through
the same quality -> classify -> extract -> consistency path as photos.

  * Resolution: PDF_RASTER_DPI (200). A page of W x H points becomes
    round(W/72*200) x round(H/72*200) pixels. Field boxes and crops of a PDF
    are in THIS raster's pixel grid (coordinate_space pdf_page1_raster_200dpi).
  * Page 1 only: later pages are not read (page_count is reported).
  * Limits, checked before anything is rendered: a page side over
    MAX_PAGE_SIDE_PT (A2's long side) or a raster over MAX_RASTER_PIXELS
    is refused as pdf_too_large - this bounds memory (at most ~60 MB BGR).
  * A PDF that needs a password is pdf_encrypted; one PDFium cannot load
    or render is pdf_unreadable. These become quality issues (usable:
    false) at the gate, and 422 elsewhere - never a crash.

Rasterisation runs locally with the bundled PDFium (pypdfium2, installed
at image build time); nothing reaches the network.
"""

from typing import Any, Dict, Tuple

import numpy as np
import pypdfium2 as pdfium

PDF_RASTER_DPI = 200
MAX_PAGE_SIDE_PT = 1684  # A2 long side (594 mm)
MAX_RASTER_PIXELS = 20_000_000
COORDINATE_SPACE = f"pdf_page1_raster_{PDF_RASTER_DPI}dpi"

_PDFIUM_PASSWORD_ERROR = 4  # FPDF_ERR_PASSWORD


class PdfProblem(Exception):
    """A PDF that cannot be used; `issue` is the quality issue code."""

    def __init__(self, issue: str, detail: str):
        super().__init__(detail)
        self.issue = issue


def is_pdf(raw: bytes) -> bool:
    return raw[:5] == b"%PDF-"


def rasterise_first_page(raw: bytes) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Page 1 of the PDF as a BGR image, plus {page_count, page_size_pt, dpi}."""
    try:
        doc = pdfium.PdfDocument(raw)
    except pdfium.PdfiumError as err:
        if getattr(err, "err_code", None) == _PDFIUM_PASSWORD_ERROR:
            raise PdfProblem("pdf_encrypted", "The PDF is password-protected.") from err
        raise PdfProblem("pdf_unreadable", "The PDF cannot be read.") from err
    try:
        page_count = len(doc)
        if page_count < 1:
            raise PdfProblem("pdf_unreadable", "The PDF has no pages.")
        page = doc[0]
        w_pt, h_pt = page.get_size()
        scale = PDF_RASTER_DPI / 72.0
        w_px, h_px = round(w_pt * scale), round(h_pt * scale)
        if (
            max(w_pt, h_pt) > MAX_PAGE_SIDE_PT
            or w_px * h_px > MAX_RASTER_PIXELS
            or w_px < 1
            or h_px < 1
        ):
            raise PdfProblem("pdf_too_large", "The PDF page is larger than the service accepts.")
        try:
            bitmap = page.render(scale=scale)
            image = np.ascontiguousarray(bitmap.to_numpy()[:, :, :3])
        except pdfium.PdfiumError as err:
            raise PdfProblem("pdf_unreadable", "The PDF page cannot be rendered.") from err
        return image, {
            "page_count": page_count,
            "page_used": 1,
            "page_size_pt": [round(w_pt, 1), round(h_pt, 1)],
            "dpi": PDF_RASTER_DPI,
        }
    finally:
        doc.close()


def pdf_info(raw: bytes) -> Dict[str, Any]:
    """{page_count, page_used, page_size_pt, dpi} without rendering (the PDF already rendered once)."""
    doc = pdfium.PdfDocument(raw)
    try:
        w_pt, h_pt = doc[0].get_size()
        return {
            "page_count": len(doc),
            "page_used": 1,
            "page_size_pt": [round(w_pt, 1), round(h_pt, 1)],
            "dpi": PDF_RASTER_DPI,
        }
    finally:
        doc.close()

