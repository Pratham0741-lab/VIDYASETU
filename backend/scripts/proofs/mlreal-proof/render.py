"""Renders the real-mode proof images (no mock marker anywhere in them).

Documents are drawn like a flatbed scan: off-white paper (~226 grey) with
light sensor noise and a printed border frame. Plain white with empty margins
would trip two known, still-open ml heuristics (glare on white paper and
cut_off_edge on blank margins); that is stated in the proof report.
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(sys.argv[1])
random.seed(7)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def scan(lines, size=(1400, 1000), title_size=44, body_size=34):
    w, h = size
    img = Image.new("L", size, 226)
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = max(0, min(255, 226 + int(random.gauss(0, 4))))
    d = ImageDraw.Draw(img)
    d.rectangle([22, 22, w - 23, h - 23], outline=40, width=4)
    d.rectangle([34, 34, w - 35, h - 35], outline=90, width=2)
    y = 80
    for i, text in enumerate(lines):
        f = font(title_size if i < 2 else body_size)
        d.text((90, y), text, fill=20, font=f)
        y += 78 if i < 2 else 66
    return img.convert("RGB")


def save(name, img):
    img.save(OUT / name, format="PNG")
    print(f"{name}: {img.size[0]}x{img.size[1]}, {(OUT / name).stat().st_size} bytes")


NAME = "Anita Lakra"
income = lambda cert_no, name=NAME: [
    "GOVERNMENT OF JHARKHAND",
    "INCOME CERTIFICATE",
    f"Certificate No: {cert_no}",
    f"Name: {name}",
    "Annual Family Income: Rs 180000",
    "Issued by: Circle Officer, Ranchi",
    "Date: 14/03/2025",
]
caste = lambda name=NAME: [
    "GOVERNMENT OF JHARKHAND",
    "CASTE CERTIFICATE",
    "Certificate No: JH-ST-2026-R7731",
    f"Name: {name}",
    "Category: Scheduled Tribe (ST)",
    "Issued by: Sub-Divisional Officer, Ranchi",
    "Date: 14/03/2025",
]
marksheet = lambda name=NAME: [
    "JHARKHAND ACADEMIC COUNCIL",
    "STATEMENT OF MARKS",
    f"Candidate Name: {name}",
    "Roll No: JH12A4471",
    "Marks Obtained: 412/500",
    "Percentage: 82.4%",
    "Examination 2024",
]
bonafide = [
    "RANCHI UNIVERSITY",
    "BONAFIDE CERTIFICATE",
    f"Student Name: {NAME}",
    "is a bonafide student of this institution.",
    "Academic Session: 2026-27",
    "Date: 01/07/2026",
]
disability = [
    "GOVERNMENT OF JHARKHAND",
    "DISABILITY CERTIFICATE",
    "Certificate No: JH-DIS-2026-5512",
    f"Name: {NAME}",
    "Percentage of disability: 40%",
    "Date: 10/01/2026",
]
generic = lambda title: ["GOVERNMENT OF JHARKHAND", title, f"Name: {NAME}", "District: Ranchi", "Date: 10/01/2026"]

# 1. quality-fail: a phone snap of the income certificate - tiny and out of focus.
save("quality_fail.png", scan(income("JH-INC-2026-0042")).resize((360, 257)).filter(ImageFilter.GaussianBlur(3)))
# 2. clean: legible caste certificate (ST certificate slot).
save("clean_caste.png", scan(caste()))
# 3. low-confidence: income certificate whose number is short and unstructured.
save("low_income.png", scan(income("0042")))
# 4. the remaining checklist slots; the 'marksheet' slot carries another person's name.
save("income_full.png", scan(income("JH-INC-2026-0042")))
save("marksheet.png", scan(marksheet()))
save("marksheet_other_person.png", scan(marksheet("Sunita Munda")))
save("bonafide.png", scan(bonafide))
save("disability.png", scan(disability))
for key, title in [("aadhaar", "IDENTITY CARD"), ("domicile", "DOMICILE CERTIFICATE"),
                   ("certificates", "CERTIFICATE OF EXAMINATIONS PASSED"),
                   ("photo", "PHOTOGRAPH OF APPLICANT"),
                   ("institution", "INSTITUTION VERIFICATION")]:
    save(f"{key}.png", scan(generic(title)))
