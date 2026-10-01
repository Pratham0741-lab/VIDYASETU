import hashlib
import logging
import os
import shutil
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
import pytesseract

CANDIDATE_PATHS = [
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
]


def get_tesseract_binary() -> Optional[str]:
    which_path = shutil.which("tesseract")
    if which_path:
        return which_path
    for p in CANDIDATE_PATHS:
        if os.path.exists(p):
            return p
    return None


TESSERACT_PATH = get_tesseract_binary()
if TESSERACT_PATH:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


def is_ocr_available() -> bool:
    return TESSERACT_PATH is not None or shutil.which("tesseract") is not None


def _lines_to_text(lines: List[List[Tuple[int, int, int, str]]]) -> str:
    """Tesseract lines (words: left, top, bottom, text) -> text, one visual row per line.

    Keeps the page's line structure, which field extraction relies on to find
    where a value ends. Lines Tesseract put in different blocks but on the same
    visual row (a table's label and value columns) are joined left to right.
    """
    boxes = []
    for words in lines:
        words.sort(key=lambda wd: wd[0])
        boxes.append({
            "left": words[0][0],
            "right": max(wd[0] for wd in words) + 1,
            "top": min(wd[1] for wd in words),
            "bottom": max(wd[2] for wd in words),
            "text": " ".join(wd[3] for wd in words),
        })
    boxes.sort(key=lambda b: (b["top"], b["left"]))
    rows: List[List[dict]] = []
    for b in boxes:
        for row in rows:
            top = min(r["top"] for r in row)
            bottom = max(r["bottom"] for r in row)
            overlap = min(bottom, b["bottom"]) - max(top, b["top"])
            side_by_side = all(b["left"] >= r["right"] or b["right"] <= r["left"] for r in row)
            if side_by_side and overlap >= 0.5 * min(bottom - top, b["bottom"] - b["top"]):
                row.append(b)
                break
        else:
            rows.append([b])
    return "\n".join(" ".join(r["text"] for r in sorted(row, key=lambda r: r["left"])) for row in rows)


def extract_raw_text(image: np.ndarray, raw_bytes: Optional[bytes] = None) -> Tuple[str, float]:
    """
    Extracts raw text and word-level average confidence from an image.
    Uses Tesseract OCR; if it is unavailable or reads nothing, the result is
    ("", 0.0). Only the pixels are read: raw_bytes is accepted for caller
    compatibility and deliberately ignored (file metadata is uploader-controlled).
    """
    text, conf, _ = extract_text_and_words(image)
    return text, conf


def extract_text_and_words(image: np.ndarray) -> Tuple[str, float, List[Dict[str, Any]]]:
    """
    Text, mean confidence and word boxes of `image` from the active engine
    (settings.ocr_engine: PaddleOCR by default, Tesseract as the fallback when
    Paddle is unavailable or reads nothing). Same contract as
    _tesseract_text_and_words.
    """
    page = ocr_page(image)
    if page.segments:
        return page.text, page.confidence, page.words
    return "", 0.0, []


def _tesseract_text_and_words(image: np.ndarray) -> Tuple[str, float, List[Dict[str, Any]]]:
    """
    extract_raw_text plus the words Tesseract found, each with its box in the
    coordinates of `image` as decoded (left, top, width, height), its
    confidence (0-1, or -1 when Tesseract gives none) and its line key. The
    text is exactly extract_raw_text's; the words are what it is built from.
    """
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image

    # Check if Tesseract is available
    if is_ocr_available():
        try:
            norm_img = cv2.normalize(gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
            data = pytesseract.image_to_data(norm_img, output_type=pytesseract.Output.DICT)
            confs = []
            words: List[Dict[str, Any]] = []
            lines: Dict[Tuple[int, int, int], List[Tuple[int, int, int, str]]] = {}
            n_boxes = len(data.get('text', []))
            for i in range(n_boxes):
                text = data['text'][i].strip()
                conf = float(data['conf'][i])
                if text:
                    key = (data['block_num'][i], data['par_num'][i], data['line_num'][i])
                    words.append({
                        "text": text,
                        "left": int(data['left'][i]),
                        "top": int(data['top'][i]),
                        "width": int(data['width'][i]),
                        "height": int(data['height'][i]),
                        "conf": round(conf / 100.0, 2) if conf >= 0 else -1.0,
                        "line": key,
                    })
                    lines.setdefault(key, []).append(
                        (data['left'][i], data['top'][i], data['top'][i] + data['height'][i], text)
                    )
                    if conf >= 0:
                        confs.append(conf / 100.0)

            full_text = _lines_to_text(list(lines.values()))
            avg_conf = float(np.mean(confs)) if confs else 0.70
            if full_text.strip():
                return full_text, round(avg_conf, 2), words
        except Exception:
            pass

    # No readable text is "no text". Never fall back to text carried in the
    # file (PNG tEXt/Description/ocr_text metadata): the uploader controls it, so
    # a blank image with forged metadata would yield forged high-confidence fields.
    return "", 0.0, []


# ---------------------------------------------------------------------------
# Best-effort OCR: preprocessing variants for a second (and later) pass. Each
# variant is a gray image; rotations are whole quarter turns. The first pass
# is always the plain image, whose word boxes are in the stored file's pixel
# grid (the only pass field_boxes may use).
# ---------------------------------------------------------------------------

# Pages whose long side is below this are upscaled, by a whole factor (a
# fractional resize of an already legible page makes Tesseract misread digits).
UPSCALE_BELOW_LONG_SIDE = 1200
UPSCALE_TARGET_LONG_SIDE = 2000


def to_gray(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image


def upscale_small(gray: np.ndarray) -> np.ndarray:
    """Small photos read far better at ~300 dpi equivalent: a whole-factor upscale towards 2000 px."""
    long_side = max(gray.shape[:2])
    if long_side >= UPSCALE_BELOW_LONG_SIDE or long_side == 0:
        return gray
    scale = float(min(4, max(2, round(UPSCALE_TARGET_LONG_SIDE / long_side))))
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def deskew(gray: np.ndarray) -> np.ndarray:
    """Straightens a page tilted by up to ~20 degrees (angle of the ink's minimum-area rectangle)."""
    ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(ink > 0))
    if len(coords) < 50:
        return gray
    angle = cv2.minAreaRect(coords[:, ::-1].astype(np.float32))[-1]
    # OpenCV >= 4.5 reports (0, 90]; map to the smallest correction.
    if angle > 45:
        angle -= 90
    if abs(angle) < 0.5 or abs(angle) > 20:
        return gray
    h, w = gray.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def enhance(gray: np.ndarray) -> np.ndarray:
    """Upscale, deskew, local contrast (CLAHE) and an unsharp mask against blur."""
    g = deskew(upscale_small(gray))
    g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
    blurred = cv2.GaussianBlur(g, (0, 0), 3)
    return cv2.addWeighted(g, 1.6, blurred, -0.6, 0)


def sharpen(gray: np.ndarray) -> np.ndarray:
    """Against blur: 2x upscale (pages under 1800 px) and a strong unsharp mask."""
    g = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC) if max(gray.shape) < 1800 else gray
    blurred = cv2.GaussianBlur(g, (0, 0), 2.0)
    return cv2.addWeighted(g, 2.2, blurred, -1.2, 0)


def binarize(gray: np.ndarray) -> np.ndarray:
    """Adaptive threshold of the enhanced image: survives uneven light and faint print."""
    g = cv2.medianBlur(enhance(gray), 3)
    return cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)


def rotate_quarter(gray: np.ndarray, turns: int) -> np.ndarray:
    codes = {1: cv2.ROTATE_90_CLOCKWISE, 2: cv2.ROTATE_180, 3: cv2.ROTATE_90_COUNTERCLOCKWISE}
    return cv2.rotate(gray, codes[turns]) if turns in codes else gray


OSD_MIN_CONFIDENCE = 1.5


def detect_quarter_turns(gray: np.ndarray) -> int:
    """Clockwise quarter turns that make the page upright (Tesseract OSD), 0 when unsure."""
    if not is_ocr_available():
        return 0
    try:
        osd = pytesseract.image_to_osd(upscale_small(gray), output_type=pytesseract.Output.DICT)
    except Exception:
        return 0  # too little text to tell
    if float(osd.get("orientation_conf", 0.0)) < OSD_MIN_CONFIDENCE:
        return 0
    return (int(osd.get("rotate", 0)) // 90) % 4


def ocr_variants(image: np.ndarray):
    """(label, gray image) per OCR pass, cheapest and most likely first. Lazy: a
    caller that is satisfied early never pays for the later variants. A page
    lying sideways or upside down is turned upright (OSD) for the second pass;
    blind quarter turns come last, for pages OSD could not judge."""
    gray = to_gray(image)
    yield "plain", gray
    turns = detect_quarter_turns(gray)
    if turns:
        gray = rotate_quarter(gray, turns)
        yield f"upright_{turns * 90}", enhance(gray)
    # Measured on blurred sample scans: a 2x upscale with a strong unsharp mask
    # reads more fields than the plain page or the CLAHE-enhanced one.
    yield "sharpened", sharpen(gray)
    yield "enhanced", enhance(gray)
    yield "binarized", binarize(gray)
    for extra in (1, 3, 2):
        yield f"rotated_{extra * 90}", enhance(rotate_quarter(gray, extra))


# ---------------------------------------------------------------------------
# PaddleOCR (PP-OCRv5 mobile detection + English recognition; the model is
# settings.paddle_rec_model): the primary engine. Models are baked into the image
# at build time (Dockerfile); nothing is downloaded at run time. Tesseract is
# the fallback (and still provides orientation detection).
# ---------------------------------------------------------------------------

_log = logging.getLogger("vidyasetu.ocr")


@dataclass
class Segment:
    """One detected text run (a line or a table cell) with its box and confidence."""

    text: str
    x0: int
    y0: int
    x1: int
    y1: int
    conf: float
    # Layout position: the line's centre with the page skew taken out, and its
    # true text height (a tilted line's box is taller than its text).
    cy: float = -1.0
    h: float = -1.0
    # The engine's own word boxes (text, x0, y0, x1, y1), when it gives them.
    word_boxes: List[Tuple[str, int, int, int, int]] = field(default_factory=list)

    @property
    def height(self) -> int:
        return max(1, self.y1 - self.y0)

    @property
    def mid(self) -> float:
        return self.cy if self.cy >= 0 else (self.y0 + self.y1) / 2

    @property
    def text_height(self) -> float:
        return self.h if self.h > 0 else float(self.height)


def rows_of(segments: List[Segment]) -> List[List[Segment]]:
    """Segments grouped into visual rows (vertical overlap of at least half the
    smaller height), each row left to right, rows top to bottom."""
    rows: List[List[Segment]] = []
    heights = sorted(s.text_height for s in segments)
    line = heights[len(heights) // 2] if heights else 1.0
    tall = [s for s in segments if s.text_height > 3 * line]
    for s in sorted((s for s in segments if s.text_height <= 3 * line), key=lambda s: s.mid):
        top_s, bottom_s = s.mid - s.text_height / 2, s.mid + s.text_height / 2
        for row in rows:
            top = min(r.mid - r.text_height / 2 for r in row)
            bottom = max(r.mid + r.text_height / 2 for r in row)
            overlap = min(bottom, bottom_s) - max(top, top_s)
            if overlap >= 0.5 * min(bottom - top, s.text_height):
                row.append(s)
                break
        else:
            rows.append([s])
    # Never a row anchor: it would pull every line it spans into one row.
    rows.extend([s] for s in tall)
    for row in rows:
        row.sort(key=lambda s: s.x0)
    rows.sort(key=lambda r: min(s.mid for s in r))
    return rows


@dataclass
class OcrPage:
    segments: List[Segment] = field(default_factory=list)
    engine: str = "none"

    @property
    def rows(self) -> List[List[Segment]]:
        return rows_of(self.segments)

    @property
    def text(self) -> str:
        return "\n".join(" ".join(s.text for s in row) for row in self.rows)

    @property
    def confidence(self) -> float:
        if not self.segments:
            return 0.0
        weights = [max(1, len(s.text)) for s in self.segments]
        return round(float(np.average([s.conf for s in self.segments], weights=weights)), 2)

    @property
    def words(self) -> List[Dict[str, Any]]:
        """Word boxes in the shape field_boxes expects, split out of each segment
        in proportion to character count (the engine boxes whole runs)."""
        out: List[Dict[str, Any]] = []
        for i, s in enumerate(self.segments):
            if s.word_boxes:
                for text, x0, y0, x1, y1 in s.word_boxes:
                    out.append({"text": text, "left": x0, "top": y0, "width": max(1, x1 - x0),
                                "height": max(1, y1 - y0), "conf": round(s.conf, 2), "line": (i, 0, 0)})
                continue
            total = max(1, len(s.text))
            pos = 0
            for t in s.text.split():
                start = s.text.find(t, pos)
                pos = start + len(t)
                x0 = s.x0 + int((s.x1 - s.x0) * start / total)
                x1 = s.x0 + int((s.x1 - s.x0) * pos / total)
                out.append({"text": t, "left": x0, "top": s.y0, "width": max(1, x1 - x0),
                            "height": s.height, "conf": round(s.conf, 2), "line": (i, 0, 0)})
        return out


_PADDLE: Optional[Any] = None
_PADDLE_FAILED = False
_PADDLE_LOCK = threading.Lock()


# Paddle's predictor belongs to the thread that created it: it is built and run
# on this one dedicated thread only (request handlers run on a thread pool).
_PADDLE_THREAD = ThreadPoolExecutor(max_workers=1, thread_name_prefix="paddle-ocr")


def _paddle() -> Optional[Any]:
    if _PADDLE is not None or _PADDLE_FAILED:
        return _PADDLE
    return _PADDLE_THREAD.submit(_create_paddle).result()


def _create_paddle() -> Optional[Any]:
    global _PADDLE, _PADDLE_FAILED
    with _PADDLE_LOCK:
        if _PADDLE is None and not _PADDLE_FAILED:
            try:
                os.environ.setdefault("DISABLE_MODEL_SOURCE_CHECK", "True")
                from paddleocr import PaddleOCR  # heavy import: only when first needed
                from app.config import settings

                _PADDLE = PaddleOCR(
                    text_detection_model_name=settings.paddle_det_model,
                    text_recognition_model_name=settings.paddle_rec_model,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    cpu_threads=settings.ocr_cpu_threads,
                )
            except Exception as err:  # not installed / models missing: Tesseract only
                _log.warning("PaddleOCR unavailable, using Tesseract: %s", err)
                _PADDLE_FAILED = True
    return _PADDLE


def is_paddle_available() -> bool:
    from app.config import settings

    return settings.ocr_engine == "paddle" and _paddle() is not None


def _paddle_segments(image: np.ndarray) -> List[Segment]:
    engine = _paddle()
    if engine is None:
        return []
    bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if len(image.shape) == 2 else image
    # On Paddle's own thread, one inference at a time (bounded memory).
    result = _PADDLE_THREAD.submit(lambda: engine.predict(bgr, return_word_box=True)[0]).result()
    segments: List[Segment] = []
    polys = result.get("rec_polys") or [None] * len(result["rec_texts"])
    word_texts = result.get("text_word") or [None] * len(result["rec_texts"])
    word_regions = result.get("text_word_region") or [None] * len(result["rec_texts"])
    angles: List[float] = []
    geometry = []
    for text, score, box, poly, wt, wr in zip(
        result["rec_texts"], result["rec_scores"], result["rec_boxes"], polys, word_texts, word_regions
    ):
        text = str(text).strip()
        if not text:
            continue
        x0, y0, x1, y1 = (int(v) for v in box)
        cx, cy, h = (x0 + x1) / 2, (y0 + y1) / 2, float(y1 - y0)
        if poly is not None and len(poly) == 4:
            p = np.asarray(poly, dtype=float)
            cx, cy = float(p[:, 0].mean()), float(p[:, 1].mean())
            h = float((np.linalg.norm(p[3] - p[0]) + np.linalg.norm(p[2] - p[1])) / 2)
            w = float(np.linalg.norm(p[1] - p[0]))
            if w > 4 * h:
                angles.append(float(np.arctan2(p[1][1] - p[0][1], p[1][0] - p[0][0])))
        geometry.append((text, x0, y0, x1, y1, round(float(score), 2), cx, cy, h, _words(wt, wr)))
    # Take the page's skew out of the line centres, so rows group correctly on a tilted photo.
    skew = float(np.median(angles)) if angles else 0.0
    for text, x0, y0, x1, y1, score, cx, cy, h, words in geometry:
        segments.append(Segment(text, x0, y0, x1, y1, score, cy=cy - np.tan(skew) * cx, h=max(1.0, h),
                                word_boxes=words))
    return segments


def _words(tokens: Optional[List[str]], regions: Optional[List[Any]]) -> List[Tuple[str, int, int, int, int]]:
    """The recogniser's character groups ("14", "/", "03", ": ") joined into
    whitespace-separated words with their boxes ("14/03/2025")."""
    if not tokens or not regions or len(tokens) != len(regions):
        return []
    words: List[Tuple[str, int, int, int, int]] = []
    text, box = "", None
    for tok, reg in zip(tokens, regions):
        pts = np.asarray(reg, dtype=float).reshape(-1, 2)
        tb = (int(pts[:, 0].min()), int(pts[:, 1].min()), int(pts[:, 0].max()), int(pts[:, 1].max()))
        core = str(tok).strip()
        if core:
            text += core
            box = tb if box is None else (min(box[0], tb[0]), min(box[1], tb[1]), max(box[2], tb[2]), max(box[3], tb[3]))
        if str(tok) != str(tok).rstrip() or not core:
            if text and box:
                words.append((text, *box))
            text, box = "", None
    if text and box:
        words.append((text, *box))
    # "No:INC-JH-2025-04471", "2,68,000(Rupees": glued tokens are two words.
    split: List[Tuple[str, int, int, int, int]] = []
    for text, x0, y0, x1, y1 in words:
        k = text.find(":")
        if not 0 < k < len(text) - 1:
            k = text.find("(") - 1
        if 0 < k < len(text) - 1:
            cut = x0 + int((x1 - x0) * (k + 1) / len(text))
            split.append((text[: k + 1], x0, y0, cut, y1))
            split.append((text[k + 1:], cut, y0, x1, y1))
        else:
            split.append((text, x0, y0, x1, y1))
    return split


def _tesseract_segments(image: np.ndarray) -> List[Segment]:
    _, _, words = _tesseract_text_and_words(image)
    lines: Dict[Any, List[Dict[str, Any]]] = {}
    for w in words:
        lines.setdefault(w["line"], []).append(w)
    out = []
    for ws in lines.values():
        ws.sort(key=lambda w: w["left"])
        confs = [w["conf"] for w in ws if w["conf"] >= 0]
        out.append(Segment(
            " ".join(w["text"] for w in ws),
            min(w["left"] for w in ws), min(w["top"] for w in ws),
            max(w["left"] + w["width"] for w in ws), max(w["top"] + w["height"] for w in ws),
            round(float(np.mean(confs)), 2) if confs else 0.5,
        ))
    return out


_CACHE: "OrderedDict[str, OcrPage]" = OrderedDict()
_CACHE_SIZE = 16
_CACHE_LOCK = threading.Lock()


def ocr_page(image: np.ndarray) -> OcrPage:
    """The page's text segments from the active engine, cached by pixel content
    (the api asks /classify and then /extract for the same file)."""
    key = hashlib.sha1(image.tobytes()).hexdigest() + str(image.shape)
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
            return hit
    page = OcrPage()
    if is_paddle_available():
        try:
            page = OcrPage(_paddle_segments(image), "paddle")
        except Exception as err:
            _log.warning("PaddleOCR failed on a page, using Tesseract: %s", err)
    if not page.segments and is_ocr_available():
        page = OcrPage(_tesseract_segments(image), "tesseract")
    with _CACHE_LOCK:
        _CACHE[key] = page
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return page


@dataclass
class OcrLine:
    text: str
    box: Tuple[int, int, int, int]
    conf: float


def ocr_lines(image: np.ndarray) -> List[OcrLine]:
    """Rows of the page (for reports): text, box and mean confidence."""
    out = []
    for row in rows_of(ocr_page(image).segments):
        out.append(OcrLine(
            " | ".join(s.text for s in row),
            (min(s.x0 for s in row), min(s.y0 for s in row), max(s.x1 for s in row), max(s.y1 for s in row)),
            round(float(np.mean([s.conf for s in row])), 2),
        ))
    return out
