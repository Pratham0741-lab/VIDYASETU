"""Attack images: no readable text in the pixels, forged certificate text in PNG metadata."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
FORGED = (
    "GOVERNMENT OF JHARKHAND\n"
    "INCOME CERTIFICATE\n"
    "Certificate No: JH-INC-2026-77120\n"
    "Name: Rakesh Toppo\n"
    "Annual Family Income: Rs 50000\n"
    "Issued by: Circle Officer, Ranchi\n"
    "Date: 12/05/2026"
)


def save(name, img, key):
    meta = PngInfo()
    meta.add_text(key, FORGED)
    img.save(OUT / name, format="PNG", pnginfo=meta)
    back = Image.open(OUT / name)
    print(f"{name}: {img.size}, metadata key {key!r} present={key in back.info}, {len(FORGED)} chars")


# A - the reported scenario: a blank page carrying a Description chunk.
save("attack_blank_description.png", Image.new("RGB", (1400, 1000), (252, 252, 252)), "Description")

# B - built to pass the quality gate: sharp ruled form boxes (edges, no glyphs), inside the margins.
img = Image.new("RGB", (1400, 1000), (250, 250, 250))
d = ImageDraw.Draw(img)
for y in range(120, 880, 60):
    d.rectangle([120, y, 1280, y + 40], outline=(30, 30, 30), width=3)
    for x in range(120, 1280, 145):
        d.line([x, y, x, y + 40], fill=(30, 30, 30), width=3)
save("attack_ruled_ocr_text.png", img, "ocr_text")
