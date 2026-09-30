# Phase 13A A1 evidence: is each asserted value actually drawn into the test image?
import sys
sys.path.insert(0, "/app")
sys.path.insert(0, "/app/tests")
from test_extract import SAMPLE_DOCS, make_doc_image  # noqa: E402
import base64, io  # noqa: E402
from PIL import Image  # noqa: E402
from app.services.ocr_service import extract_raw_text  # noqa: E402
import numpy as np, cv2  # noqa: E402

EXPECT = {
    "INCOME_CERTIFICATE": ["14/03/2025"],
    "CASTE_CERTIFICATE": ["(SC)"],
    "FEE_RECEIPT": ["TXN99482104"],
    "BANK_PASSBOOK": ["SBIN0001234", "30948291048"],
    "BONAFIDE": ["2024-2025"],
    "DISABILITY_CERT": ["45%"],
    "OFFER_LETTER": ["Systems Engineer"],
}
for doc, needles in EXPECT.items():
    text = SAMPLE_DOCS[doc]
    lines = text.split("\n")
    drawn = "\n".join(l[:50] for l in lines[:10])
    img_b64 = make_doc_image(text)
    img = Image.open(io.BytesIO(base64.b64decode(img_b64)))
    print(f"== {doc}: {len(lines)} lines, longest {max(len(l) for l in lines)} chars; PNG text chunks: {list(img.info.keys())}")
    arr = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2BGR)
    ocr_text, ocr_conf = extract_raw_text(arr, None)
    for n in needles:
        line = next(l for l in lines if n in l)
        print(f"   {n!r}: in source line of {len(line)} chars at col {line.index(n)}-{line.index(n)+len(n)}; drawn into pixels: {n in drawn}; Tesseract read it: {n in ocr_text}")
