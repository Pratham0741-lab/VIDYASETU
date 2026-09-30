"""Demo seed: render synthetic document images (the ml/tests/doc_render.py approach).

Run inside the ml container (it has OpenCV):
    docker compose exec -T ml python -c "$(cat scripts/demo/render_docs.py)" < jobs.json

stdin: JSON [{"key": "...", "text": "..."}]; stdout: one line per job,
"<key> <base64 PNG>". Every character of the text is drawn into the pixels
(word-wrapped, never truncated), so the real OCR engine reads the same facts;
the seed then adds the ML_MODE=mock fixture marker as a PNG text chunk (the
real service reads pixels only). Deterministic: the same text gives the same
bytes. Every page carries a SYNTHETIC / NOT A REAL DOCUMENT banner.
"""

import base64
import json
import sys

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


def render(text: str) -> bytes:
    max_width = PAGE_WIDTH - 2 * MARGIN
    lines = [w for line in text.split("\n") for w in _wrap(line, max_width)]
    height = MARGIN * 2 + LINE_HEIGHT * len(lines)
    img = np.full((height, PAGE_WIDTH, 3), 235, dtype=np.uint8)
    cv2.rectangle(img, (10, 10), (PAGE_WIDTH - 10, height - 10), (100, 100, 100), 2)
    y = MARGIN + 24
    for line in lines:
        cv2.putText(img, line, (MARGIN, y), FONT, SCALE, (30, 30, 30), THICKNESS, cv2.LINE_AA)
        y += LINE_HEIGHT
    ok, png = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return png.tobytes()


for job in json.load(sys.stdin):
    print(job["key"], base64.b64encode(render(job["text"])).decode("ascii"))
