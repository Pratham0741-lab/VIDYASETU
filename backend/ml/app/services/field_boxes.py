"""
Field boxes: where on the page each extracted value was read (Phase 13D).

Field extraction runs regular expressions over the flat OCR text and
normalises what it finds (dates to YYYY-MM-DD, amounts without separators),
so a value is tied back to the page by matching it against runs of OCR words
on one line, using the same normalisations:

  * a date value      - one word whose normalize_date() equals it;
  * a number value    - one word whose digits equal its digits;
  * any other value   - consecutive words on one line whose letters/digits
                        equal the value's words, in order.

A box is returned only when EXACTLY ONE run matches (zero or several -> no
box: never a guess), and only if every matched word has a Tesseract
confidence. Boxes are in the pixel grid of the ORIGINAL stored image: the
decoder applies EXIF orientation before OCR, so the box is mapped back
through that orientation (to_stored_coordinates). Page is always 1: the
service reads single images (a PDF cannot be decoded, so it has no OCR).
"""

import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from app.utils.pdf import COORDINATE_SPACE as PDF_COORDINATE_SPACE, is_pdf

COORDINATE_SPACE = "stored_image_pixels"
_DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y")
_MAX_RUN = 6


def _norm(text: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", text.upper())


def _as_date(word: str) -> Optional[str]:
    cleaned = word.strip(" .,;:()[]")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def _is_date_value(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None


def _runs_matching(words: List[Dict[str, Any]], value: Any) -> List[List[Dict[str, Any]]]:
    """Every run of words that reads as `value` (see module docstring)."""
    runs: List[List[Dict[str, Any]]] = []
    if value is None or value == "" or isinstance(value, bool):
        return runs
    if _is_date_value(value):
        return [[w] for w in words if _as_date(w["text"]) == value]
    if isinstance(value, (int, float)):
        target = _digits(str(int(value))) if float(value).is_integer() else None
        if not target:
            return runs
        return [[w] for w in words if _digits(w["text"]) == target and len(target) >= 3]

    tokens = [t for t in (_norm(p) for p in str(value).split()) if t]
    if not tokens or len(tokens) > _MAX_RUN:
        return runs
    by_line: Dict[Any, List[Dict[str, Any]]] = {}
    for w in words:
        by_line.setdefault(w["line"], []).append(w)
    for line_words in by_line.values():
        line_words = sorted(line_words, key=lambda w: w["left"])
        normed = [_norm(w["text"]) for w in line_words]
        for i in range(len(line_words) - len(tokens) + 1):
            if normed[i:i + len(tokens)] == tokens:
                runs.append(line_words[i:i + len(tokens)])
    return runs


def exif_orientation(raw_bytes: bytes) -> int:
    """The EXIF orientation tag of the stored file (1 = none / not present)."""
    try:
        with Image.open(io.BytesIO(raw_bytes)) as im:
            value = im.getexif().get(0x0112, 1)
            return int(value) if value in range(1, 9) else 1
    except Exception:
        return 1


def stored_size(raw_bytes: bytes) -> Optional[Tuple[int, int]]:
    """(width, height) of the stored pixel grid, before any orientation."""
    try:
        with Image.open(io.BytesIO(raw_bytes)) as im:
            return im.size
    except Exception:
        return None


def to_stored_coordinates(
    box: Tuple[int, int, int, int], orientation: int, stored: Tuple[int, int]
) -> Tuple[int, int, int, int]:
    """
    Maps a box (x, y, w, h) in the displayed (EXIF-oriented) image back to
    the stored pixel grid of size `stored` = (width, height).
    """
    if orientation == 1:
        return box
    wr, hr = stored
    x, y, w, h = box
    corners = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]

    def back(px: int, py: int) -> Tuple[int, int]:
        return {
            2: (wr - px, py),
            3: (wr - px, hr - py),
            4: (px, hr - py),
            5: (py, px),
            6: (py, hr - px),
            7: (wr - py, hr - px),
            8: (wr - py, px),
        }[orientation]

    pts = [back(px, py) for px, py in corners]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def field_boxes(
    values: Dict[str, Any],
    words: List[Dict[str, Any]],
    raw_bytes: bytes,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """For every extracted field: its page and box, or None (no single match)."""
    pdf = is_pdf(raw_bytes)
    # A PDF's boxes are in its page-1 raster (Phase 13E); no EXIF to undo.
    orientation = 1 if pdf else exif_orientation(raw_bytes)
    stored = None if pdf else stored_size(raw_bytes)
    out: Dict[str, Optional[Dict[str, Any]]] = {}
    for field, value in values.items():
        runs = _runs_matching(words, value)
        if len(runs) != 1 or any(w["conf"] < 0 for w in runs[0]):
            out[field] = None
            continue
        run = runs[0]
        left = min(w["left"] for w in run)
        top = min(w["top"] for w in run)
        right = max(w["left"] + w["width"] for w in run)
        bottom = max(w["top"] + w["height"] for w in run)
        box = (left, top, right - left, bottom - top)
        if orientation != 1:
            if stored is None:
                out[field] = None
                continue
            box = to_stored_coordinates(box, orientation, stored)
        out[field] = {
            "page": 1,
            "x": int(box[0]),
            "y": int(box[1]),
            "width": int(box[2]),
            "height": int(box[3]),
            "coordinate_space": PDF_COORDINATE_SPACE if pdf else COORDINATE_SPACE,
        }
    return out
