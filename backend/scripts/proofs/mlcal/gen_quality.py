"""Targeted images for the glare (item 1) and cut_off_edge (item 2) checks."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LINES = ["GOVERNMENT OF JHARKHAND", "INCOME CERTIFICATE", "Certificate No: JH-INC-2025-11873",
         "Name: Pooja Kumari Tirkey", "Father's Name: Sukra Tirkey", "Address: Village Bero, Ranchi",
         "Annual Family Income: Rs 1,45,000", "This certificate is valid for the financial year 2025-26",
         "and is issued on the basis of the enquiry report of the circle.", "Date: 05/06/2025"]


def page(paper_rgb, size=(1400, 1000), margin=(100, 90), lines=LINES, noise=2.0, font_size=30):
    w, h = size
    a = np.empty((h, w, 3), dtype=np.float32)
    a[:] = paper_rgb
    a += rng.normal(0, noise, (h, w, 1))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(SANS, font_size)
    y = margin[1]
    for line in lines:
        d.text((margin[0], y), line, fill=(25, 25, 25), font=f)
        y += int(font_size * 1.9)
    return img


def flash(img, cx, cy, sigma_frac=0.07, strength=1.25):
    """A flash/reflection hotspot: pushes paper AND ink toward white, saturating the core."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    s = sigma_frac * w
    g = np.clip(strength * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * s * s)), 0, 1)[..., None]
    return Image.fromarray(np.clip(a + (255 - a) * g, 0, 255).astype(np.uint8))


def save(name, img):
    img.save(OUT / f"{name}.png")
    print(name, img.size)


# Item 1 - glare
save("glare_white_clean", page((252, 252, 252)))
save("glare_cream_clean", page((242, 232, 205)))
save("glare_hotspot", flash(page((210, 208, 200)), 760, 460))           # phone photo, flash on the text
save("glare_bright_hotspot", flash(page((240, 240, 238)), 760, 460))    # very bright paper AND a hotspot
# extras: must not be mistaken for glare
grad = np.asarray(page((252, 252, 252))).astype(np.float32) * np.linspace(1.0, 0.84, 1400)[None, :, None]
save("glare_white_gradient", Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8)))
desk = Image.new("RGB", (1600, 1200), (58, 52, 48))
desk.paste(page((250, 250, 250)), (100, 100))
save("glare_white_on_dark_desk", desk)

# Item 2 - cut_off_edge
save("margin_normal", page((250, 250, 250)))
save("margin_large_intentional", page((250, 250, 250), size=(1400, 1800), margin=(110, 100),
                                      lines=LINES[:5], font_size=28))  # short letter, mostly whitespace
full = page((250, 250, 250), size=(1400, 1000), margin=(100, 90), font_size=34)
save("margin_cropped_right_bottom", full.crop((0, 0, 700, 560)))       # lines cut mid-word, a line cut through
save("margin_cropped_corner", full.crop((120, 105, 1400, 1000)))        # top-left corner cut into the text
