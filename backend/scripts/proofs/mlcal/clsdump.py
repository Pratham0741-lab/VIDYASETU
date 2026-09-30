import json, sys, cv2
sys.path.insert(0, sys.argv[1])
from app.services.ocr_service import extract_raw_text
from app.services.classify_service import score_document_text
man = json.load(open('/w/set/manifest.json'))
out = []
for d in man:
    text, _ = extract_raw_text(cv2.imread('/w/set/' + d['file']))
    scores, probs = score_document_text(" ".join(text.split()))
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best = max(probs, key=probs.get)
    out.append({"id": d["id"], "type": d["type"], "degraded": bool(d["degraded"]), "scores": scores,
                "top": ranked[0], "second": ranked[1], "p": round(probs[best], 4), "pred": best})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
