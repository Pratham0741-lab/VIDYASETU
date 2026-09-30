# Phase 17 F4: text extraction and page rendering of the Hindi PDFs (before / after the font),
# with pypdfium2 in the ml container. Input: JSON {name: base64 pdf} on stdin. Output: the text of
# page 1 and a PNG (base64) per PDF.
import base64, io, json, sys
import pypdfium2 as pdfium
docs = json.load(sys.stdin)
for name, b64 in docs.items():
    pdf = pdfium.PdfDocument(base64.b64decode(b64))
    page = pdf[0]
    text = page.get_textpage().get_text_range()
    fonts = sorted({f for f in []})
    print(f"=== {name}: {len(pdf)} page(s); page-1 text (first 400 chars):")
    print(text[:400].replace('\r', ''))
    img = page.render(scale=1.6).to_pil()
    w, h = img.size
    img = img.crop((0, 0, w, min(h, int(h * 0.55))))
    buf = io.BytesIO(); img.save(buf, format="PNG")
    print(f"PNG {name} {base64.b64encode(buf.getvalue()).decode()}")
