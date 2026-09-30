"""OCR showcase: one real library document through the ML service's own OCR (no applicant).

The real scanned documents under docs/ (INCOME_CERTIFICATES, ST_CERTIFICATES, ...) are NEVER
attached to the synthetic demo applicants. To show real OCR on camera, run one of them straight
through the ml service (real OCR regardless of the api's ML_MODE), from inside the container:

    docker compose exec -T ml python -c "$(cat scripts/demo/ocr_showcase.py)" < docs/INCOME_CERTIFICATES/Income_certificate_04.jpeg

Prints the classified type, each extracted field with its confidence, and the raw text length.
Nothing is stored. These are real documents: what they contain may identify real people, so
show them only as the recorded demo requires and do not paste the output anywhere else.
"""

import base64
import json
import sys
import urllib.request

img = sys.stdin.buffer.read()
req = urllib.request.Request(
    "http://127.0.0.1:8000/v1/documents/extract",
    data=json.dumps({"image_base64": base64.b64encode(img).decode()}).encode(),
    headers={"Content-Type": "application/json"},
)
r = json.load(urllib.request.urlopen(req, timeout=120))
print(f"document_type: {r.get('document_type')} (confidence {r.get('document_type_confidence')})")
for k, v in (r.get("value") or {}).items():
    print(f"  {k}: {v}  (confidence {(r.get('confidence') or {}).get(k)})")
print(f"raw OCR text: {len(r.get('raw_text') or '')} characters")
