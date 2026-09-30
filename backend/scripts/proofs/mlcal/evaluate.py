"""Runs every document of the frozen set through the real ml routes (in-process
ASGI, real Tesseract/OpenCV) and writes one JSON record per document.

usage: python evaluate.py <code_root containing app/> <set_dir> <out.json> [id ...]
"""
import asyncio
import base64
import json
import sys
import time

sys.path.insert(0, sys.argv[1])
from httpx import ASGITransport, AsyncClient  # noqa: E402
from app.main import app  # noqa: E402

SET, OUT = sys.argv[2], sys.argv[3]
ONLY = set(sys.argv[4:])
NAME_FIELD = {
    "CASTE_CERTIFICATE": "applicant_name", "INCOME_CERTIFICATE": "applicant_name", "DISABILITY_CERT": "applicant_name",
    "MARKSHEET": "candidate_name", "OFFER_LETTER": "candidate_name", "FEE_RECEIPT": "student_name",
    "BONAFIDE": "student_name", "BANK_PASSBOOK": "account_holder_name",
}


async def main():
    manifest = json.load(open(f"{SET}/manifest.json"))
    rows = []
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ml") as c:
        for d in manifest:
            if ONLY and d["id"] not in ONLY:
                continue
            b64 = base64.b64encode(open(f"{SET}/{d['file']}", "rb").read()).decode()
            t0 = time.time()
            q = (await c.post("/v1/documents/quality", json={"image_base64": b64})).json()
            k = (await c.post("/v1/documents/classify", json={"image_base64": b64})).json()
            body = {"image_base64": b64}
            if d["type"]:
                body["document_type"] = d["type"]
            e = (await c.post("/v1/documents/extract", json=body)).json()
            nf = NAME_FIELD.get(e.get("document_type"), None)
            rows.append({
                "id": d["id"], "type": d["type"], "truth_name": d["name"], "truth": d["truth"],
                "layout": d["layout"], "degraded": bool(d["degraded"]),
                "quality": {"usable": q["value"]["usable"], "issues": q["value"]["issues"],
                            "confidence": q["confidence"], "details": q["details"]},
                "classify": {"value": k["value"], "confidence": k["confidence"], "alternatives": k["alternatives"]},
                "extract": {"type_used": e.get("document_type"), "value": e["value"], "confidence": e["confidence"],
                            "name_field": nf, "name": e["value"].get(nf) if nf else None,
                            "name_conf": e["confidence"].get(nf) if nf else None},
                "seconds": round(time.time() - t0, 2),
            })
            r = rows[-1]
            print(f"{d['id']:17s} q={'OK ' if r['quality']['usable'] else 'REJ'}{str(r['quality']['issues']):34s} "
                  f"cls={r['classify']['value']}@{r['classify']['confidence']:<5} "
                  f"name={json.dumps(r['extract']['name'])}@{r['extract']['name_conf']}", flush=True)
    json.dump(rows, open(OUT, "w"), indent=1)


asyncio.run(main())
