import asyncio, base64, cv2, numpy as np
from httpx import AsyncClient, ASGITransport
from app.main import app
from doc_render import render_document_layout, true_region
from test_field_boxes import INCOME, png_b64, exif_rotated_jpeg, upright_to_stored_rot90ccw

def iou(b, t):
    bx,by,bw,bh=b["x"],b["y"],b["width"],b["height"]; tx,ty,tw,th=t
    ix=max(0,min(bx+bw,tx+tw)-max(bx,tx)); iy=max(0,min(by+bh,ty+th)-max(by,ty)); i=ix*iy
    return i/(bw*bh+tw*th-i), i/(tw*th)

async def run(label, b64, truths):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = (await ac.post("/v1/documents/extract", json={"image_base64": b64, "document_type": "INCOME_CERTIFICATE"})).json()
    print(label)
    for f, t in truths.items():
        b = r["boxes"].get(f)
        if b is None: print(f"  {f:22} value={r['value'][f]!r:24} box=None"); continue
        u, cov = iou(b, t)
        print(f"  {f:22} value={r['value'][f]!r:24} box=({b['x']},{b['y']},{b['width']},{b['height']}) truth={t} IoU={u:.2f} covers {cov:.0%} of truth")

img, words = render_document_layout(INCOME)
T = {"issued_date": true_region(words,"14/03/2025"), "certificate_number": true_region(words,"INC-JH-2025-04471"),
     "family_income_annual": true_region(words,"2,68,000"), "applicant_name": true_region(words,"Rahul","Kumar")}
asyncio.run(run("PNG, upright (page %dx%d)" % (img.shape[1], img.shape[0]), png_b64(img), T))
asyncio.run(run("JPEG stored rotated, EXIF orientation 6 (boxes in stored grid)", exif_rotated_jpeg(img), {k: upright_to_stored_rot90ccw(v, img.shape[1]) for k, v in T.items()}))
img2, w2 = render_document_layout(INCOME + "\nValid from 14/03/2025 for one year. Date: 14/03/2025")
asyncio.run(run("date printed twice (ambiguous)", png_b64(img2), {"issued_date": (0,0,1,1), "certificate_number": true_region(w2,"INC-JH-2025-04471")}))
