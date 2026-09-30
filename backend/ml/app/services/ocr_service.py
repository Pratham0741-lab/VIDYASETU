import os
import shutil
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
