import base64, io, json, urllib.request, urllib.error
from PIL import Image, ImageDraw, ImageFont
# A real, legible document-like image, rendered in memory (no disk write).
img = Image.new("RGB", (1400, 700), "white")
d = ImageDraw.Draw(img)
try:
    font = ImageFont.load_default(size=40)
except TypeError:
    font = ImageFont.load_default()
lines = ["GOVERNMENT OF JHARKHAND", "INCOME CERTIFICATE", "Name: Kiran Tirkey", "Annual Income: Rs 420000", "Certificate No: JH-INC-2026-0042"]
for i, t in enumerate(lines):
    d.text((60, 60 + i * 110), t, fill="black", font=font)
buf = io.BytesIO(); img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()
def post(path, body):
    req = urllib.request.Request("http://127.0.0.1:8000" + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]
for path, body in [("/quality", {"image": b64}), ("/extract", {"image": b64, "document_type": "income_certificate"})]:
    status, resp = post(path, body)
    print(f"POST {path}: HTTP {status}")
    print(json.dumps(resp, indent=1)[:1500] if isinstance(resp, dict) else resp)
