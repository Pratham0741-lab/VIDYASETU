import asyncio, base64
from httpx import AsyncClient, ASGITransport
from app.main import app
from doc_render import render_pdf, handmade_pdf, true_region
from test_pdf import CERT
B = lambda b: base64.b64encode(b).decode()
def iou(b, t):
    bx,by,bw,bh=b["x"],b["y"],b["width"],b["height"]; tx,ty,tw,th=t
    ix=max(0,min(bx+bw,tx+tw)-max(bx,tx)); iy=max(0,min(by+bh,ty+th)-max(by,ty)); i=ix*iy
    return i/(bw*bh+tw*th-i), i/(tw*th)
async def go():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        pdf, words = render_pdf(CERT)
        q = (await ac.post("/v1/documents/quality", json={"image_base64": B(pdf)})).json()
        print(f"generated PDF ({len(pdf)} bytes): quality usable={q['value']['usable']} issues={q['value']['issues']} pdf={q['details']['pdf']} raster={q['details']['resolution']}")
        r = (await ac.post("/v1/documents/extract", json={"image_base64": B(pdf), "document_type": "INCOME_CERTIFICATE"})).json()
        T = {"issued_date": true_region(words,"14/03/2025"), "certificate_number": true_region(words,"INC-JH-2025-04471"), "family_income_annual": true_region(words,"2,68,000"), "applicant_name": true_region(words,"Rahul","Kumar")}
        for f, t in T.items():
            b = r["boxes"][f]; u, c = iou(b, t)
            print(f"  {f:22} value={r['value'][f]!r:22} box=({b['x']},{b['y']},{b['width']},{b['height']}) truth={t} IoU={u:.2f} covers {c:.0%} space={b['coordinate_space']}")
        box = r["boxes"]["issued_date"]
        c = await ac.post("/v1/documents/crop", json={"image_base64": B(pdf), **{k: box[k] for k in ("x","y","width","height")}, "margin": 24})
        print(f"  crop of the PDF's issue date: HTTP {c.status_code} region={c.json().get('region')}")
        two, _ = render_pdf(CERT, extra_pages=[CERT.replace("INC-JH-2025-04471","INC-JH-2099-99999")])
        q2 = (await ac.post("/v1/documents/quality", json={"image_base64": B(two)})).json()["details"]["pdf"]
        r2 = (await ac.post("/v1/documents/extract", json={"image_base64": B(two), "document_type": "INCOME_CERTIFICATE"})).json()["value"]["certificate_number"]
        print(f"two-page PDF: {q2} -> certificate_number read: {r2} (page 1 only)")
        for label, data in [("encrypted", handmade_pdf(encrypt=True)), ("corrupt", b"%PDF-1.4\n" + bytes(range(256))*4), ("oversized (5000x5000 pt)", handmade_pdf(media_box="0 0 5000 5000"))]:
            q = (await ac.post("/v1/documents/quality", json={"image_base64": B(data)})).json()
            e = await ac.post("/v1/documents/extract", json={"image_base64": B(data), "document_type": "INCOME_CERTIFICATE"})
            print(f"{label:26} quality: usable={q['value']['usable']} issues={q['value']['issues']} | extract: HTTP {e.status_code} {e.json()}")
asyncio.run(go())
