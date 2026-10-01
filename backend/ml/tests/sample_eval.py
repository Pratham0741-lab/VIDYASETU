"""
Accuracy evaluation over the local sample documents (backend/docs/*_CERTIFICATES,
gitignored, never committed: they hold personal data). Each folder carries a
hand-written labels.json: per file, good (the mandatory value is printed and
legible) and the expected fields.

Runs the production pipeline exactly as the api calls it: classify the file,
then extract with the slot's document type. Per document it reports the OCR
lines with their boxes, expected vs extracted per field, and a pass-rate
table; results go to --out (a folder OUTSIDE the repo: the report contains
the sample text).

    python tests/sample_eval.py --samples /samples --out /out [--degrade rotate5|blur|crop3] [--only INCOME]

Used by tests/test_sample_eval.py (skipped when no samples are mounted).
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from rapidfuzz import fuzz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


FOLDERS = {
    "INCOME_CERTIFICATES": "INCOME_CERTIFICATE",
    "ST_CERTIFICATES": "CASTE_CERTIFICATE",
    "10TH_CERTIFICATES": "MARKSHEET",
    "12TH_CERTIFICATES": "MARKSHEET",
    "BONAFIDE_CERTIFICATES": "BONAFIDE",
}

# The value the type's verification rule cannot do without (document-verification.ts).
MANDATORY = {
    "INCOME_CERTIFICATE": ["family_income_annual"],
    "CASTE_CERTIFICATE": ["category"],
    "MARKSHEET": ["percentage"],
    "BONAFIDE": ["institution_name"],
}

DEGRADATIONS = ("rotate5", "blur", "crop3")


# ------------------------------------------------------------------ comparison


def _norm(s: Any) -> str:
    return re.sub(r"[^0-9a-zऀ-ॿ]+", " ", str(s).lower()).strip()


def _num(v: Any) -> Optional[float]:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"\d+(?:\.\d+)?", v.replace(",", ""))
        return float(m.group(0)) if m else None
    return None


def _percentage(values: Dict[str, Any]) -> Optional[float]:
    p = _num(values.get("percentage"))
    if p is not None and 0 < p <= 100:
        return p
    o, t = _num(values.get("marks_obtained")), _num(values.get("total_marks"))
    if o is not None and t and 0 < o <= t:
        return round(100.0 * o / t, 2)
    return None


def field_ok(field: str, expected: Any, values: Dict[str, Any]) -> bool:
    got = _percentage(values) if field == "percentage" else values.get(field)
    if got in (None, "", []):
        return False
    if field in ("applicant_name", "candidate_name", "student_name"):
        joined = (
            fuzz.ratio(_norm(expected).replace(" ", ""), _norm(got).replace(" ", ""))
            >= 85
        )
        return (
            joined
            or fuzz.token_sort_ratio(_norm(expected), _norm(got)) >= 80
            or (
                fuzz.partial_ratio(_norm(expected), _norm(got)) >= 90
                and len(_norm(got)) >= len(_norm(expected)) * 0.6
            )
        )
    if field == "institution_name":
        return fuzz.token_set_ratio(_norm(expected), _norm(got)) >= 85
    if field in ("family_income_annual", "marks_obtained", "total_marks"):
        return _num(got) == float(expected)
    if field == "percentage":
        return abs(float(got) - float(expected)) <= 0.1
    if field == "passing_year":
        return _num(got) == float(expected)
    if field == "academic_year":
        a, b = re.search(r"20\d\d", str(expected)), re.search(r"20\d\d", str(got))
        return bool(a and b and a.group(0) == b.group(0))
    if field == "category":
        return str(got).upper() == str(expected).upper()
    if field.endswith("date"):
        return str(got)[:10] == str(expected)
    # certificate / roll numbers: same characters, ignoring separators, case and
    # the letter/digit look-alikes OCR swaps (an officer checks these by eye).
    fold = str.maketrans("0o1il|5s8b2z", "oolllls sbbzz".replace(" ", "")[:12])

    def key(v: Any) -> str:
        return re.sub(r"[^0-9a-z]", "", str(v).lower()).translate(fold)

    return key(got) == key(expected)


# ------------------------------------------------------------------ degradation


def degrade(img: np.ndarray, how: Optional[str]) -> np.ndarray:
    if not how:
        return img
    h, w = img.shape[:2]
    if how == "rotate5":
        m = cv2.getRotationMatrix2D((w / 2, h / 2), 5, 1.0)
        cos, sin = abs(m[0, 0]), abs(m[0, 1])
        nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
        m[0, 2] += nw / 2 - w / 2
        m[1, 2] += nh / 2 - h / 2
        return cv2.warpAffine(img, m, (nw, nh), borderValue=(255, 255, 255))
    if how == "blur":
        return cv2.GaussianBlur(img, (0, 0), 1.5)
    if how == "crop3":
        dy, dx = int(h * 0.03), int(w * 0.03)
        return img[dy : h - dy, dx : w - dx]
    raise ValueError(how)


def _png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


# ------------------------------------------------------------------ run


def ocr_lines_for_report(
    image: np.ndarray,
) -> List[Tuple[str, Tuple[int, int, int, int], float]]:
    """(text, box, confidence) per OCR line, from whatever engine is active."""
    try:
        from app.services.ocr_service import ocr_lines  # the layout API, when present

        return [(ln.text, ln.box, ln.conf) for ln in ocr_lines(image)]
    except ImportError:
        from app.services.ocr_service import extract_text_and_words

        _, _, words = extract_text_and_words(image)
        lines: Dict[Any, List[Dict[str, Any]]] = {}
        for w in words:
            lines.setdefault(w["line"], []).append(w)
        out = []
        for ws in lines.values():
            x0 = min(w["left"] for w in ws)
            y0 = min(w["top"] for w in ws)
            x1 = max(w["left"] + w["width"] for w in ws)
            y1 = max(w["top"] + w["height"] for w in ws)
            conf = float(np.mean([w["conf"] for w in ws if w["conf"] >= 0] or [0]))
            out.append(
                (" ".join(w["text"] for w in ws), (x0, y0, x1, y1), round(conf, 2))
            )
        return sorted(out, key=lambda t: (t[1][1], t[1][0]))


def evaluate(
    samples: str,
    out: Optional[str] = None,
    how: Optional[str] = None,
    only: Optional[str] = None,
    report_lines: bool = True,
) -> Dict[str, Any]:
    import resource  # POSIX only: the evaluation runs in the ml container

    from app.services.classify_service import classify_document
    from app.services.extract_service import extract_document_fields
    from app.utils.image import decode_base64_image_with_bytes

    results: List[Dict[str, Any]] = []
    report: List[str] = []
    pages: Dict[str, Any] = {}
    for folder, doc_type in FOLDERS.items():
        if only and only.upper() not in folder:
            continue
        labels_path = os.path.join(samples, folder, "labels.json")
        if not os.path.exists(labels_path):
            continue
        labels = json.load(open(labels_path, encoding="utf-8"))["samples"]
        for name in sorted(labels):
            label = labels[name]
            raw = open(os.path.join(samples, folder, name), "rb").read()
            image, raw_bytes = decode_base64_image_with_bytes(
                base64.b64encode(raw).decode()
            )
            if how:
                image = degrade(image, how)
                raw_bytes = base64.b64decode(_png_b64(image))
            t0 = time.perf_counter()
            cls = classify_document(image, raw_bytes)
            ext = extract_document_fields(image, raw_bytes, document_type=doc_type)
            seconds = time.perf_counter() - t0
            values = ext["value"]
            expected = label.get("fields", {})
            per_field = {f: field_ok(f, v, values) for f, v in expected.items()}
            mandatory = [f for f in MANDATORY[doc_type] if f in expected]
            classified_ok = (
                (cls["value"] != doc_type)
                if label.get("not_this_type")
                else (cls["value"] == doc_type)
            )
            row = {
                "folder": folder,
                "file": name,
                "document_type": doc_type,
                # English-only OCR for now: Hindi/Marathi-only samples are out of scope.
                "good": label["good"] and label.get("language", "en") == "en",
                "not_this_type": bool(label.get("not_this_type")),
                "classified": cls["value"],
                "classification_confidence": cls["confidence"],
                "classified_ok": classified_ok,
                "expected": expected,
                "extracted": values,
                "confidence": ext["confidence"],
                "fields_ok": per_field,
                "mandatory_ok": bool(mandatory)
                and all(per_field[f] for f in mandatory),
                "seconds": round(seconds, 2),
            }
            results.append(row)
            if out:
                from app.services.ocr_service import ocr_page, to_gray

                pages[f"{folder}/{name}"] = [
                    [sg.text, sg.x0, sg.y0, sg.x1, sg.y1, sg.conf, sg.cy, sg.h]
                    for sg in ocr_page(to_gray(image)).segments
                ]
            report.append(
                f"\n=== {folder}/{name}  good={row['good']}  class={cls['value']} ({cls['confidence']})  {seconds:.1f}s"
            )
            if report_lines:
                for text, box, conf in ocr_lines_for_report(image):
                    report.append(
                        f"  [{box[0]:4d},{box[1]:4d},{box[2]:4d},{box[3]:4d}] {conf:.2f}  {text}"
                    )
            for f, v in expected.items():
                got = _percentage(values) if f == "percentage" else values.get(f)
                report.append(
                    f"  {'OK ' if per_field[f] else 'XX '} {f}: expected={v!r} got={got!r} conf={ext['confidence'].get(f)}"
                )
    summary = summarise(results)
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    summary["peak_rss_mb"] = round(peak_mb, 1)
    summary["seconds_per_document"] = round(
        float(np.mean([r["seconds"] for r in results])) if results else 0.0, 2
    )
    if out:
        os.makedirs(out, exist_ok=True)
        tag = how or "clean"
        json.dump(
            {"summary": summary, "results": results},
            open(os.path.join(out, f"eval_{tag}.json"), "w", encoding="utf-8"),
            ensure_ascii=False,
            indent=1,
            default=str,
        )
        open(os.path.join(out, f"report_{tag}.txt"), "w", encoding="utf-8").write(
            "\n".join(report)
        )
        # The plain pass's OCR segments, to iterate on extraction without re-running OCR.
        json.dump(
            pages,
            open(os.path.join(out, f"pages_{tag}.json"), "w", encoding="utf-8"),
            ensure_ascii=False,
        )
    return {"summary": summary, "results": results}


def summarise(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_type: Dict[str, Dict[str, Any]] = {}
    for r in results:
        t = by_type.setdefault(
            r["document_type"],
            {
                "samples": 0,
                "good": 0,
                "mandatory_ok": 0,
                "fields": 0,
                "fields_ok": 0,
                "classified_ok": 0,
            },
        )
        t["samples"] += 1
        t["classified_ok"] += int(r["classified_ok"])
        if r["good"]:
            t["good"] += 1
            t["mandatory_ok"] += int(r["mandatory_ok"])
            t["fields"] += len(r["fields_ok"])
            t["fields_ok"] += sum(r["fields_ok"].values())
    total = {
        k: sum(t[k] for t in by_type.values())
        for k in (
            "samples",
            "good",
            "mandatory_ok",
            "fields",
            "fields_ok",
            "classified_ok",
        )
    }
    return {"by_type": by_type, "total": total}


def print_table(summary: Dict[str, Any], title: str) -> None:
    print(f"\n{title}")
    print(
        f"{'type':<20}{'samples':>8}{'good':>6}{'mandatory':>11}{'fields':>12}{'classify':>10}"
    )
    for name, t in list(summary["by_type"].items()) + [("TOTAL", summary["total"])]:
        mand = f"{t['mandatory_ok']}/{t['good']}"
        fld = f"{t['fields_ok']}/{t['fields']}"
        cls = f"{t['classified_ok']}/{t['samples']}"
        print(f"{name:<20}{t['samples']:>8}{t['good']:>6}{mand:>11}{fld:>12}{cls:>10}")
    print(
        f"peak RSS {summary.get('peak_rss_mb')} MB, {summary.get('seconds_per_document')} s/document"
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default=os.environ.get("SAMPLES_DIR", "/samples"))
    ap.add_argument("--out", default=os.environ.get("EVAL_OUT"))
    ap.add_argument("--degrade", choices=DEGRADATIONS)
    ap.add_argument("--only")
    ap.add_argument("--no-lines", action="store_true")
    a = ap.parse_args()
    res = evaluate(a.samples, a.out, a.degrade, a.only, not a.no_lines)
    print_table(res["summary"], f"{a.degrade or 'clean'} ({date.today()})")
