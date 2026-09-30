"""
Synthetic document images for the ML tests.

Every character of the source text is drawn into the pixels: lines are
word-wrapped to the page width (never truncated) at a size Tesseract reads
reliably. The PNG carries no text chunk - the service reads pixels only (the
metadata fallback was removed; tests/test_ocr_metadata_security.py), so a
fixture must not hold any fact the image does not show.

Hershey fonts are ASCII-only: Devanagari in the source text is drawn as '?'
glyphs (the assertions never depend on it).
"""

import base64

import cv2
import numpy as np

FONT = cv2.FONT_HERSHEY_SIMPLEX
SCALE = 0.8
THICKNESS = 2
PAGE_WIDTH = 1500
MARGIN = 40
LINE_HEIGHT = 44


def _wrap(line: str, max_width: int) -> list[str]:
    words, out, current = line.split(" "), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        width = cv2.getTextSize(candidate, FONT, SCALE, THICKNESS)[0][0]
        if current and width > max_width:
            out.append(current)
            current = word
        else:
            current = candidate
    out.append(current)
    return out


def render_document(text: str) -> str:
    """Base64 PNG with the whole text drawn legibly; no embedded text."""
    max_width = PAGE_WIDTH - 2 * MARGIN
    lines = [w for line in text.split("\n") for w in _wrap(line, max_width)]
    height = MARGIN * 2 + LINE_HEIGHT * len(lines)
    img = np.full((height, PAGE_WIDTH, 3), 235, dtype=np.uint8)
    cv2.rectangle(img, (10, 10), (PAGE_WIDTH - 10, height - 10), (100, 100, 100), 2)
    y = MARGIN + 24
    for line in lines:
        cv2.putText(img, line, (MARGIN, y), FONT, SCALE, (30, 30, 30), THICKNESS, cv2.LINE_AA)
        y += LINE_HEIGHT
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def render_document_layout(text: str) -> tuple[np.ndarray, list[dict]]:
    """
    render_document's page as a BGR array, plus the true box of every drawn
    word: {text, line, x, y, width, height} in page pixels, from the same
    font metrics putText uses (x from the width of the line up to the word;
    y from the baseline, the text height and the baseline depth).
    Phase 13D: the ground truth the field-box tests compare against.
    """
    max_width = PAGE_WIDTH - 2 * MARGIN
    lines = [w for line in text.split("\n") for w in _wrap(line, max_width)]
    height = MARGIN * 2 + LINE_HEIGHT * len(lines)
    img = np.full((height, PAGE_WIDTH, 3), 235, dtype=np.uint8)
    cv2.rectangle(img, (10, 10), (PAGE_WIDTH - 10, height - 10), (100, 100, 100), 2)
    words: list[dict] = []
    y = MARGIN + 24
    for n, line in enumerate(lines):
        cv2.putText(img, line, (MARGIN, y), FONT, SCALE, (30, 30, 30), THICKNESS, cv2.LINE_AA)
        parts = line.split(" ")
        for i, part in enumerate(parts):
            prefix = " ".join(parts[:i]) + (" " if i else "")
            x = MARGIN + (cv2.getTextSize(prefix, FONT, SCALE, THICKNESS)[0][0] if prefix else 0)
            (w, h), base = cv2.getTextSize(part, FONT, SCALE, THICKNESS)
            words.append({"text": part, "line": n, "x": x, "y": y - h, "width": w, "height": h + base})
        y += LINE_HEIGHT
    return img, words


def true_region(words: list[dict], *texts: str) -> tuple[int, int, int, int]:
    """Union box (x, y, w, h) of the first consecutive run of `texts` in `words`."""
    seq = list(texts)
    for i in range(len(words) - len(seq) + 1):
        run = words[i:i + len(seq)]
        if [w["text"] for w in run] == seq and len({w["line"] for w in run}) == 1:
            x0 = min(w["x"] for w in run)
            y0 = min(w["y"] for w in run)
            x1 = max(w["x"] + w["width"] for w in run)
            y1 = max(w["y"] + w["height"] for w in run)
            return x0, y0, x1 - x0, y1 - y0
    raise AssertionError(f"{texts} not drawn")


def render_pdf(text: str, extra_pages: list[str] | None = None, dpi: int = 200) -> tuple[bytes, list[dict]]:
    """
    Phase 13E: render_document_layout's page(s) as a PDF whose page size is
    the image at `dpi`, so rasterising page 1 at the same dpi gives back the
    same pixel grid - the true word boxes of page 1 are returned alongside.

    The page image is stored LOSSLESSLY (raw RGB, /FlateDecode), like a
    digital certificate. (Pillow's PDF writer stores JPEG: its ringing around
    dark text on the grey page reads as glare to the quality gate.)
    """
    import zlib

    img, words = render_document_layout(text)
    images = [img] + [render_document_layout(extra)[0] for extra in extra_pages or []]
    objs: list[bytes] = [b"", b""]  # 1 catalog, 2 pages - filled in below
    kids = []
    for im in images:
        h, w = im.shape[:2]
        data = zlib.compress(cv2.cvtColor(im, cv2.COLOR_BGR2RGB).tobytes(), 6)
        head = (
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
            b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>" % (w, h, len(data))
        )
        objs.append(head + b"\nstream\n" + data + b"\nendstream")
        img_obj = len(objs)
        pw, ph = w * 72 / dpi, h * 72 / dpi
        content = b"q %.4f 0 0 %.4f 0 0 cm /Im0 Do Q" % (pw, ph)
        objs.append(b"<< /Length %d >>" % len(content) + b"\nstream\n" + content + b"\nendstream")
        content_obj = len(objs)
        objs.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.4f %.4f] /Contents %d 0 R "
            b"/Resources << /XObject << /Im0 %d 0 R >> >> >>" % (pw, ph, content_obj, img_obj)
        )
        kids.append(len(objs))
    objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out), words


def handmade_pdf(media_box: str = "0 0 595 842", encrypt: bool = False) -> bytes:
    """
    Phase 13E: a tiny hand-built PDF with a correct xref - a blank page of the
    given MediaBox, optionally with a Standard security handler (/Encrypt)
    whose owner/user keys match no password, so PDFium asks for one.
    """
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        ("<< /Type /Page /Parent 2 0 R /MediaBox [%s] >>" % media_box).encode(),
    ]
    if encrypt:
        key = b"<" + b"41" * 32 + b">"
        objs.append(b"<< /Filter /Standard /V 1 /R 2 /O " + key + b" /U " + key + b" /P -44 >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    trailer = b"<< /Size %d /Root 1 0 R" % (len(objs) + 1)
    if encrypt:
        trailer += b" /Encrypt 4 0 R /ID [<0123456789ABCDEF0123456789ABCDEF><0123456789ABCDEF0123456789ABCDEF>]"
    out += b"trailer\n" + trailer + b" >>\nstartxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)
