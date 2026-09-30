"""Varied real-looking document set for the ml accuracy/calibration pass.

Group C's synthetic generator does not exist in the workspace, so this is the
minimum-viable substitute: 4 distinct documents per canonical type (different
layout, typeface, label wording, paper) - variant 3 of each type is
deliberately degraded (skew, blur, uneven light, JPEG, noise) - plus generic
documents for slots with no canonical type. No mock marker, no text metadata:
the only way to read these is real OCR.

Writes <out>/docs/*.png and <out>/manifest.json (ground truth per document).
"""
import io
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(sys.argv[1])
(OUT / "docs").mkdir(parents=True, exist_ok=True)
rng = random.Random(20260927)
F = "/usr/share/fonts/truetype/dejavu/"
FACES = {
    "sans": (F + "DejaVuSans.ttf", F + "DejaVuSans-Bold.ttf"),
    "serif": (F + "DejaVuSerif.ttf", F + "DejaVuSerif-Bold.ttf"),
    "mono": (F + "DejaVuSansMono.ttf", F + "DejaVuSansMono-Bold.ttf"),
    "default": (None, None),  # Pillow's built-in face
}
PAPER = {"white": 250, "offwhite": (238, 236, 230), "cream": (242, 232, 205), "grey": (224, 224, 219)}


def font(face, size, bold=False):
    path = FACES[face][1 if bold else 0]
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size=size)


def paper(size, colour, noise):
    w, h = size
    base = np.empty((h, w, 3), dtype=np.float32)
    base[:] = colour if isinstance(colour, tuple) else (colour, colour, colour)
    base += np.random.default_rng(rng.randrange(1 << 30)).normal(0, noise, (h, w, 1))
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + [cur]


def render(spec):
    """spec: size, paper, noise, face, header[], blocks[(kind, payload)], frame, ink."""
    w, h = spec["size"]
    img = paper((w, h), PAPER[spec["paper"]], spec.get("noise", 3))
    d = ImageDraw.Draw(img)
    ink = spec.get("ink", (25, 25, 25))
    face = spec["face"]
    m = spec.get("margin", int(w * 0.07))
    if spec.get("frame"):
        d.rectangle([m // 3, m // 3, w - m // 3, h - m // 3], outline=(60, 60, 60), width=3)
    y = m
    for i, line in enumerate(spec["header"]):
        f = font(face, spec.get("title", 40) if i == len(spec["header"]) - 1 else spec.get("head", 30), bold=True)
        tw = d.textlength(line, font=f)
        d.text(((w - tw) / 2, y), line, fill=ink, font=f)
        y += int(f.size * 1.6)
    d.line([m, y, w - m, y], fill=(90, 90, 90), width=2)
    y += 30
    body = font(face, spec.get("body", 28))
    lh = int(body.size * 1.75)
    for kind, payload in spec["blocks"]:
        if kind == "kv":
            for label, value in payload:
                d.text((m, y), f"{label}: {value}", fill=ink, font=body)
                y += lh
        elif kind == "table":
            col = m + int((w - 2 * m) * 0.38)
            for label, value in payload:
                d.text((m, y), label, fill=ink, font=body)
                d.text((col, y), value, fill=ink, font=body)
                d.line([m, y + lh - 10, w - m, y + lh - 10], fill=(150, 150, 150), width=1)
                y += lh
        elif kind == "prose":
            for line in wrap(d, payload, body, w - 2 * m):
                d.text((m, y), line, fill=ink, font=body)
                y += lh
        elif kind == "gap":
            y += payload
        elif kind == "sign":
            d.text((w - m - d.textlength(payload, font=body), y + 40), payload, fill=ink, font=body)
            d.ellipse([m, y, m + 120, y + 120], outline=(40, 50, 120), width=3)  # seal
            y += 170
    return img


def degrade(img, angle, blur, jpeg, light):
    """A phone snap / poor scan: skew, blur, uneven light, JPEG, noise."""
    bg = tuple(int(c) for c in np.array(img)[5, 5])
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=bg)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    gx = np.linspace(light, 1.0, w)[None, :, None]
    a = a * gx + np.random.default_rng(rng.randrange(1 << 30)).normal(0, 5, a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=jpeg)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


DOCS = []


def doc(doc_id, doc_type, name, spec, truth, variety, degraded=None):
    img = render(spec)
    if degraded:
        img = degrade(img, **degraded)
    path = OUT / "docs" / f"{doc_id}.png"
    img.save(path, format="PNG")
    DOCS.append({
        "id": doc_id, "type": doc_type, "name": name, "truth": truth, "file": f"docs/{doc_id}.png",
        "size": list(img.size), "face": spec["face"], "paper": spec["paper"], "layout": variety,
        "degraded": degraded,
    })


DEG = lambda a: {"angle": a, "blur": 1.1, "jpeg": 55, "light": 0.82}
GOV = ["GOVERNMENT OF JHARKHAND"]

# ---------------------------------------------------------------- CASTE
doc("caste_1", "CASTE_CERTIFICATE", "Sunil Oraon", dict(size=(1400, 1000), paper="white", face="sans", frame=True,
    header=GOV + ["OFFICE OF THE CIRCLE OFFICER, KANKE", "CASTE CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH/CC/2025/004512"), ("Name", "Sunil Oraon"), ("Father's Name", "Budhu Oraon"),
                    ("Caste/Tribe", "Oraon"), ("Category", "Scheduled Tribe (ST)"), ("Date", "12/08/2025")]),
            ("sign", "Circle Officer")]),
    {"category": "ST", "caste_cert_number": "JH/CC/2025/004512"}, "label:value")
doc("caste_2", "CASTE_CERTIFICATE", "Mary Sunita Ekka", dict(size=(1240, 1600), paper="cream", face="serif", frame=True,
    header=GOV + ["SUB-DIVISIONAL OFFICE, KHUNTI", "CASTE CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH-KH-ST-2024-7781")]), ("gap", 20),
            ("prose", "This is to certify that Smt. Mary Sunita Ekka, daughter of Shri Joseph Ekka, resident of village "
                      "Murhu in Khunti district, belongs to the Kharia community, which is recognised as a Scheduled "
                      "Tribe under the Constitution (Scheduled Tribes) Order, 1950."),
            ("gap", 20), ("kv", [("Dated", "03/02/2024")]), ("sign", "Sub-Divisional Officer, Khunti")]),
    {"category": "ST", "caste_cert_number": "JH-KH-ST-2024-7781"}, "prose")
doc("caste_3", "CASTE_CERTIFICATE", "Ravi Kumar Munda", dict(size=(1400, 1050), paper="offwhite", face="mono", noise=4,
    header=GOV + ["SCHEDULED TRIBE CERTIFICATE"], title=36,
    blocks=[("table", [("Applicant Name", "Ravi Kumar Munda"), ("Father / Husband", "Somra Munda"), ("Tribe", "Munda"),
                       ("Category", "ST"), ("Cert. No.", "ST/2023/GUM/1182"), ("Date of Issue", "21-11-2023")]),
            ("sign", "Competent Authority, Gumla")]),
    {"category": "ST", "caste_cert_number": "ST/2023/GUM/1182"}, "table")
doc("caste_4", "CASTE_CERTIFICATE", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=GOV + ["CASTE CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH-ST-2026-R7731"), ("Name", "Anita Lakra"), ("Category", "Scheduled Tribe (ST)"),
                    ("Issued by", "Sub-Divisional Officer, Ranchi"), ("Date", "14/03/2025")])]),
    {"category": "ST", "caste_cert_number": "JH-ST-2026-R7731"}, "label:value (prior-pass layout)", DEG(2.2))

# ---------------------------------------------------------------- INCOME
doc("income_1", "INCOME_CERTIFICATE", "Pooja Kumari Tirkey", dict(size=(1400, 1050), paper="white", face="sans", frame=True,
    header=GOV + ["OFFICE OF THE CIRCLE OFFICER, BERO", "INCOME CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH-INC-2025-11873"), ("Name", "Pooja Kumari Tirkey"), ("Father's Name", "Sukra Tirkey"),
                    ("Address", "Village Bero, Ranchi"), ("Annual Family Income", "Rs 1,45,000"), ("Date", "05/06/2025")]),
            ("sign", "Circle Officer")]),
    {"family_income_annual": 145000, "certificate_number": "JH-INC-2025-11873"}, "label:value")
doc("income_2", "INCOME_CERTIFICATE", "Birsa Munda", dict(size=(1240, 1600), paper="cream", face="serif", frame=True,
    header=GOV + ["OFFICE OF THE TAHSILDAR, TAMAR", "INCOME CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "RNC/INC/24/5530")]), ("gap", 20),
            ("prose", "This is to certify that Shri Birsa Munda, son of Late Karma Munda, resident of Tamar, Ranchi, "
                      "has an annual family income from all sources of Rs. 96,000 (Rupees Ninety Six Thousand only) "
                      "per annum."),
            ("gap", 20), ("kv", [("Dated", "17/09/2024")]), ("sign", "Tahsildar, Tamar")]),
    {"family_income_annual": 96000, "certificate_number": "RNC/INC/24/5530"}, "prose")
doc("income_3", "INCOME_CERTIFICATE", "Deepak Soren", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=GOV + ["INCOME CERTIFICATE"], title=36,
    blocks=[("table", [("Applicant Name", "Deepak Soren"), ("Relation", "S/o Mangal Soren"), ("Annual Income", "Rs 2,10,000"),
                       ("Certificate Number", "INC/DUM/2023/0993"), ("Date of Issue", "09-01-2024")]),
            ("sign", "Revenue Officer, Dumka")]),
    {"family_income_annual": 210000, "certificate_number": "INC/DUM/2023/0993"}, "table")
doc("income_4", "INCOME_CERTIFICATE", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=GOV + ["INCOME CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH-INC-2026-0042"), ("Name", "Anita Lakra"), ("Annual Family Income", "Rs 180000"),
                    ("Issued by", "Circle Officer, Ranchi"), ("Date", "14/03/2025")])]),
    {"family_income_annual": 180000, "certificate_number": "JH-INC-2026-0042"}, "label:value (prior-pass layout)", DEG(-1.8))

# ---------------------------------------------------------------- MARKSHEET
doc("marks_1", "MARKSHEET", "Kiran Tirkey", dict(size=(1240, 1650), paper="white", face="sans", frame=True,
    header=["JHARKHAND ACADEMIC COUNCIL, RANCHI", "INTERMEDIATE EXAMINATION 2024", "STATEMENT OF MARKS"], title=36,
    blocks=[("kv", [("Candidate Name", "Kiran Tirkey"), ("Roll No", "24110337"), ("School", "St. Xavier's College, Ranchi")]),
            ("table", [("English", "78 / 100"), ("Physics", "81 / 100"), ("Chemistry", "84 / 100"), ("Mathematics", "90 / 100"),
                       ("Biology", "79 / 100")]),
            ("kv", [("Marks Obtained", "412/500"), ("Percentage", "82.4%"), ("Result", "PASS - FIRST DIVISION")])]),
    {"roll_number": "24110337", "marks_obtained": 412, "total_marks": 500}, "label:value + subject table")
doc("marks_2", "MARKSHEET", "Rohit Kujur", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=["SECONDARY SCHOOL EXAMINATION 2023", "MARKS STATEMENT"], title=34,
    blocks=[("table", [("Name of Candidate", "Rohit Kujur"), ("Roll Number", "JH23S88104"), ("Total Marks", "388 out of 500"),
                       ("Percentage", "77.6%"), ("Division", "First")])]),
    {"roll_number": "JH23S88104"}, "table")
doc("marks_3", "MARKSHEET", "Sushma Devi Hansda", dict(size=(1240, 1500), paper="cream", face="serif", frame=True,
    header=["RANCHI UNIVERSITY", "SEMESTER IV EXAMINATION 2025", "GRADE CARD"], title=36,
    blocks=[("kv", [("Student Name", "Sushma Devi Hansda"), ("Registration No", "RU-2022-45581"), ("Programme", "B.A. Economics")]),
            ("table", [("Course", "Credits  Grade"), ("Microeconomics II", "4  A"), ("Statistics", "4  A+"), ("Indian Economy", "4  B+")]),
            ("kv", [("SGPA", "8.12"), ("CGPA", "7.95")])]),
    {"roll_number": "RU-2022-45581"}, "grade card")
doc("marks_4", "MARKSHEET", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=["JHARKHAND ACADEMIC COUNCIL", "STATEMENT OF MARKS"],
    blocks=[("kv", [("Candidate Name", "Anita Lakra"), ("Roll No", "JH12A4471"), ("Marks Obtained", "412/500"),
                    ("Percentage", "82.4%"), ("Examination", "2024")])]),
    {"roll_number": "JH12A4471", "marks_obtained": 412, "total_marks": 500}, "label:value (prior-pass layout)", DEG(1.5))

# ---------------------------------------------------------------- FEE RECEIPT
doc("fee_1", "FEE_RECEIPT", "Ajay Kumar Minj", dict(size=(1240, 1400), paper="white", face="sans", frame=True,
    header=["ST. XAVIER'S COLLEGE, RANCHI", "FEE RECEIPT"], title=36,
    blocks=[("kv", [("Receipt No", "SXC/2025/08812"), ("Student Name", "Ajay Kumar Minj"), ("Course", "B.Sc. Physics, Semester III"),
                    ("Tuition Fee", "Rs 12,500"), ("Total Amount Paid", "Rs 14,750.00"), ("Payment Mode", "UPI"),
                    ("Transaction ID", "UPI4481200931"), ("Payment Date", "18/07/2025")]), ("sign", "Accounts Officer")]),
    {"receipt_number": "SXC/2025/08812", "amount_paid": 14750}, "label:value")
doc("fee_2", "FEE_RECEIPT", "Priyanka Bara", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=["BIRSA INSTITUTE OF TECHNOLOGY", "FEES PAYMENT RECEIPT"], title=34,
    blocks=[("table", [("Receipt Number", "BIT-FR-24-3391"), ("Student Name", "Priyanka Bara"), ("Branch", "Civil Engineering"),
                       ("Amount Paid", "Rs 38,200"), ("Transaction ID", "NEFT24091177"), ("Date", "02/09/2024")])]),
    {"receipt_number": "BIT-FR-24-3391", "amount_paid": 38200}, "table")
doc("fee_3", "FEE_RECEIPT", "Manoj Kumar Oraon", dict(size=(1240, 1500), paper="cream", face="serif", frame=True,
    header=["MARWARI COLLEGE, RANCHI", "STUDENT RECEIPT - TUITION FEE"], title=34,
    blocks=[("kv", [("Receipt No", "MC/TF/2025/1204")]),
            ("prose", "Received with thanks from Manoj Kumar Oraon, B.Com Part I, the sum of Rs 6,400 towards tuition fee "
                      "and admission fee for the session 2025-26."),
            ("kv", [("Amount Paid", "Rs 6,400"), ("Payment Date", "11/07/2025")]), ("sign", "Cashier")]),
    {"receipt_number": "MC/TF/2025/1204", "amount_paid": 6400}, "prose")
doc("fee_4", "FEE_RECEIPT", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=["RANCHI WOMEN'S COLLEGE", "FEE RECEIPT"],
    blocks=[("kv", [("Receipt No", "RWC-2025-5521"), ("Student Name", "Anita Lakra"), ("Amount Paid", "Rs 9,800"),
                    ("Transaction ID", "UPI88120045"), ("Payment Date", "20/06/2025")])]),
    {"receipt_number": "RWC-2025-5521", "amount_paid": 9800}, "label:value", DEG(-2.4))

# ---------------------------------------------------------------- BANK PASSBOOK
doc("bank_1", "BANK_PASSBOOK", "Sunita Devi Hansda", dict(size=(1400, 1000), paper="white", face="sans", frame=True,
    header=["STATE BANK OF INDIA", "SAVINGS ACCOUNT PASSBOOK"], title=36,
    blocks=[("kv", [("Account Holder", "Sunita Devi Hansda"), ("Account No", "30948291048"), ("IFSC Code", "SBIN0001234"),
                    ("Branch", "Doranda, Ranchi"), ("CIF No", "85512093"), ("Nominee", "Registered")])]),
    {"bank_account": "SBIN0001234:30948291048"}, "label:value")
doc("bank_2", "BANK_PASSBOOK", "Rajesh Kerketta", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=["BANK OF INDIA", "PASSBOOK"], title=36,
    blocks=[("table", [("Account Holder Name", "Rajesh Kerketta"), ("A/c No", "448810110003921"), ("IFSC", "BKID0004488"),
                       ("Branch Name", "Gumla Main"), ("Account Type", "Savings")])]),
    {"bank_account": "BKID0004488:448810110003921"}, "table")
doc("bank_3", "BANK_PASSBOOK", "Mary Sunita Ekka", dict(size=(1240, 1300), paper="cream", face="serif", frame=True,
    header=["PUNJAB NATIONAL BANK", "SAVINGS BANK ACCOUNT"], title=34,
    blocks=[("kv", [("Account Holder", "Mary Sunita Ekka"), ("Account Number", "0912000108887766"), ("IFSC Code", "PUNB0091200"),
                    ("Address", "Murhu, Khunti"), ("MICR", "834024002")])]),
    {"bank_account": "PUNB0091200:0912000108887766"}, "label:value (serif)")
doc("bank_4", "BANK_PASSBOOK", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=["STATE BANK OF INDIA", "PASSBOOK"],
    blocks=[("kv", [("Account Holder", "Anita Lakra"), ("Account No", "30017703124"), ("IFSC Code", "SBIN0007701"),
                    ("Branch", "Ranchi Main")])]),
    {"bank_account": "SBIN0007701:30017703124"}, "label:value", DEG(1.9))

# ---------------------------------------------------------------- BONAFIDE
doc("bona_1", "BONAFIDE", "Neha Kumari Oraon", dict(size=(1240, 1500), paper="white", face="sans", frame=True,
    header=["RANCHI UNIVERSITY", "BONAFIDE CERTIFICATE"], title=36,
    blocks=[("prose", "This is to certify that Ms. Neha Kumari Oraon is a bonafide student of this institution, currently "
                      "studying in B.A. Part II."), ("gap", 20),
            ("kv", [("Academic Session", "2025-26"), ("Date", "01/07/2025")]), ("sign", "Principal")]),
    {"academic_year": "2025-26"}, "prose")
doc("bona_2", "BONAFIDE", "Sagar Kujur", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=["ST. XAVIER'S COLLEGE", "BONAFIDE CERTIFICATE"], title=34,
    blocks=[("table", [("Student Name", "Sagar Kujur"), ("Course", "B.Sc. Chemistry"), ("Year", "Second"),
                       ("Academic Session", "2025-26"), ("Date", "04/07/2025")]), ("sign", "Principal")]),
    {"academic_year": "2025-26"}, "table")
doc("bona_3", "BONAFIDE", "Ravi Kumar Munda", dict(size=(1240, 1500), paper="cream", face="serif", frame=True,
    header=["GOSSNER COLLEGE, RANCHI", "BONAFIDE CERTIFICATE"], title=34,
    blocks=[("prose", "This is to certify that Shri Ravi Kumar Munda, son of Somra Munda, is a bonafide student of this "
                      "college, currently studying in B.Com Part III during the academic session 2024-25."),
            ("kv", [("Dated", "15/07/2024")]), ("sign", "Head of the Department")]),
    {"academic_year": "2024-25"}, "prose (serif)")
doc("bona_4", "BONAFIDE", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=["RANCHI UNIVERSITY", "BONAFIDE CERTIFICATE"],
    blocks=[("kv", [("Student Name", "Anita Lakra")]), ("prose", "is a bonafide student of this institution."),
            ("kv", [("Academic Session", "2026-27"), ("Date", "01/07/2026")])]),
    {"academic_year": "2026-27"}, "label:value (prior-pass layout)", DEG(-1.6))

# ---------------------------------------------------------------- DISABILITY
doc("dis_1", "DISABILITY_CERT", "Rajesh Kerketta", dict(size=(1240, 1500), paper="white", face="sans", frame=True,
    header=GOV + ["DEPARTMENT OF HEALTH", "DISABILITY CERTIFICATE"], title=36,
    blocks=[("kv", [("Certificate No", "JH/DIS/2025/3312"), ("Name", "Rajesh Kerketta"), ("Age", "19 years"), ("Sex", "Male"),
                    ("Type of Disability", "Locomotor Disability"), ("Percentage of disability", "45%"), ("Date", "10/01/2026")]),
            ("sign", "Medical Board, Ranchi")]),
    {"disability_percentage": 45, "certificate_number": "JH/DIS/2025/3312"}, "label:value")
doc("dis_2", "DISABILITY_CERT", "Pooja Kumari Tirkey", dict(size=(1240, 1600), paper="cream", face="serif", frame=True,
    header=GOV + ["OFFICE OF THE CIVIL SURGEON, RANCHI", "DISABILITY CERTIFICATE"], title=34,
    blocks=[("kv", [("Certificate No", "CS/RNC/PWD/2024/778")]),
            ("prose", "This is to certify that Ms. Pooja Kumari Tirkey, aged 20 years, is a case of visual impairment and "
                      "has 60% permanent disability in relation to her eyes, as assessed by the medical board."),
            ("kv", [("Date", "22/03/2024")]), ("sign", "Civil Surgeon")]),
    {"disability_percentage": 60, "certificate_number": "CS/RNC/PWD/2024/778"}, "prose")
doc("dis_3", "DISABILITY_CERT", "Sagar Kujur", dict(size=(1400, 1050), paper="offwhite", face="mono", noise=4,
    header=["UNIQUE DISABILITY ID - CERTIFICATE", "PERSONS WITH DISABILITIES"], title=32,
    blocks=[("table", [("Applicant Name", "Sagar Kujur"), ("Certificate Number", "UDID-JH-2023-55120"),
                       ("Disability Type", "Hearing Impairment"), ("Disability Percentage", "40%"), ("Issued", "07/12/2023")])]),
    {"disability_percentage": 40, "certificate_number": "UDID-JH-2023-55120"}, "table")
doc("dis_4", "DISABILITY_CERT", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default", frame=True,
    header=GOV + ["DISABILITY CERTIFICATE"],
    blocks=[("kv", [("Certificate No", "JH-DIS-2026-5512"), ("Name", "Anita Lakra"), ("Percentage of disability", "40%"),
                    ("Date", "10/01/2026")])]),
    {"disability_percentage": 40, "certificate_number": "JH-DIS-2026-5512"}, "label:value (prior-pass layout)", DEG(2.0))

# ---------------------------------------------------------------- OFFER LETTER
doc("offer_1", "OFFER_LETTER", "Amit Kumar Ekka", dict(size=(1240, 1600), paper="white", face="sans",
    header=["INFOTECH SOLUTIONS PVT. LTD.", "OFFER LETTER"], title=36,
    blocks=[("kv", [("Date", "02/05/2025")]), ("prose", "Dear Amit Kumar Ekka,"),
            ("prose", "We are pleased to offer you employment as Software Engineer with our company, on the terms of "
                      "employment set out below."),
            ("kv", [("Annual Salary (CTC)", "Rs 6,50,000"), ("Date of Joining", "01/07/2025")]), ("sign", "HR Manager")]),
    {"annual_ctc": 650000}, "letter")
doc("offer_2", "OFFER_LETTER", "Neha Kumari Oraon", dict(size=(1400, 1000), paper="offwhite", face="mono", noise=4,
    header=["TATA STEEL LIMITED", "EMPLOYMENT OFFER"], title=34,
    blocks=[("table", [("Candidate Name", "Neha Kumari Oraon"), ("Designation", "Graduate Engineer Trainee"),
                       ("CTC", "INR 4,80,000"), ("Joining Date", "15/07/2025")]), ("sign", "Human Resources")]),
    {"annual_ctc": 480000}, "table")
doc("offer_3", "OFFER_LETTER", "Deepak Soren", dict(size=(1240, 1600), paper="cream", face="serif",
    header=["COAL INDIA LIMITED", "LETTER OF APPOINTMENT"], title=34,
    blocks=[("prose", "Dear Deepak Soren,"),
            ("prose", "With reference to your application and interview, we are pleased to offer you the position of "
                      "Junior Accountant. Your probation period will be six months."),
            ("kv", [("CTC", "Rs 5,20,000"), ("Date of Joining", "01/08/2025")]), ("sign", "HR Manager")]),
    {"annual_ctc": 520000}, "letter (serif)")
doc("offer_4", "OFFER_LETTER", "Anita Lakra", dict(size=(1400, 1000), paper="grey", face="default",
    header=["NEXGEN SOFTWARE", "OFFER LETTER"],
    blocks=[("prose", "Dear Anita Lakra,"), ("prose", "We are pleased to offer you employment as Data Analyst."),
            ("kv", [("CTC", "Rs 4,20,000"), ("Date of Joining", "01/08/2026")])]),
    {"annual_ctc": 420000}, "letter", DEG(-2.1))

# ---------------------------------------------------------------- GENERIC (no canonical type)
doc("gen_identity", None, "Anita Lakra", dict(size=(1400, 900), paper="white", face="sans", frame=True,
    header=GOV + ["IDENTITY CARD"], blocks=[("kv", [("Name", "Anita Lakra"), ("District", "Ranchi"), ("Date", "10/01/2026")])]),
    {}, "label:value")
doc("gen_domicile", None, "Kiran Tirkey", dict(size=(1240, 1500), paper="cream", face="serif", frame=True,
    header=GOV + ["DOMICILE CERTIFICATE"],
    blocks=[("prose", "This is to certify that Kiran Tirkey, daughter of Etwa Tirkey, is a permanent resident of village "
                      "Namkum in Ranchi district of the State of Jharkhand."), ("kv", [("Date", "04/04/2025")]),
            ("sign", "Deputy Commissioner, Ranchi")]),
    {}, "prose")
doc("gen_photo", None, "Sagar Kujur", dict(size=(1000, 1200), paper="offwhite", face="sans",
    header=["PHOTOGRAPH OF APPLICANT"], blocks=[("gap", 500), ("kv", [("Name", "Sagar Kujur")])]),
    {}, "photo page")
doc("gen_institution", None, "Priyanka Bara", dict(size=(1240, 1400), paper="white", face="mono",
    header=["INSTITUTION VERIFICATION FORM"],
    blocks=[("table", [("Institute Code", "U-0421"), ("Institute", "Birsa Institute of Technology"),
                       ("Verified Student", "Priyanka Bara"), ("Verified On", "12/08/2025")]), ("sign", "Nodal Officer")]),
    {}, "table")
doc("gen_exams", None, "Rohit Kujur", dict(size=(1240, 1400), paper="grey", face="serif",
    header=["LIST OF EXAMINATIONS PASSED"],
    blocks=[("table", [("Secondary", "2021  First"), ("Senior Secondary", "2023  First"), ("B.A. Part I", "2024  Second")]),
            ("kv", [("Name", "Rohit Kujur")])]),
    {}, "table")
doc("gen_aadhaar_like", None, "Mary Sunita Ekka", dict(size=(1400, 900), paper="offwhite", face="default", frame=True,
    header=["RESIDENT IDENTITY DOCUMENT"],
    blocks=[("kv", [("Name", "Mary Sunita Ekka"), ("Year of Birth", "2005"), ("Gender", "Female")])]),
    {}, "label:value", DEG(1.2))

(OUT / "manifest.json").write_text(json.dumps(DOCS, indent=1))
by_type = {}
for d in DOCS:
    by_type.setdefault(d["type"] or "(generic)", []).append(d)
for t, ds in by_type.items():
    print(f"{t:20s} {len(ds)}: " + "; ".join(f"{d['id']} [{d['layout']}, {d['face']}, {d['paper']}{', DEGRADED' if d['degraded'] else ''}]" for d in ds))
print(f"total {len(DOCS)} documents")
