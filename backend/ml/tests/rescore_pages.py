"""
Re-runs the layout extractors on OCR pages dumped by sample_eval.py
(pages_<tag>.json, outside the repo) and scores them against the labels:
seconds per iteration instead of a full OCR run. Plain OCR pass only, so the
numbers are a lower bound of the full multi-pass evaluation.

    python tests/rescore_pages.py --pages /out/pages_clean.json --samples /samples [--show MARKSHEET]
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from app.services.layout_extract import EXTRACTORS, Layout  # noqa: E402
from app.services.ocr_service import OcrPage, Segment  # noqa: E402
from sample_eval import FOLDERS, MANDATORY, _percentage, field_ok  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", required=True)
    ap.add_argument("--samples", required=True)
    ap.add_argument("--show")
    a = ap.parse_args()
    pages = json.load(open(a.pages, encoding="utf-8"))
    totals = {}
    for folder, doc_type in FOLDERS.items():
        labels = json.load(
            open(os.path.join(a.samples, folder, "labels.json"), encoding="utf-8")
        )["samples"]
        for name, label in sorted(labels.items()):
            key = f"{folder}/{name}"
            if (
                key not in pages
                or not label["good"]
                or label.get("language", "en") != "en"
            ):
                continue
            page = OcrPage([Segment(*s) for s in pages[key]], "dump")
            values, _ = EXTRACTORS[doc_type](Layout(page))
            t = totals.setdefault(doc_type, [0, 0, 0, 0])
            t[0] += 1
            mand = [f for f in MANDATORY[doc_type] if f in label["fields"]]
            ok_m = bool(mand) and all(
                field_ok(f, label["fields"][f], values) for f in mand
            )
            t[1] += ok_m
            for f, v in label["fields"].items():
                t[2] += 1
                ok = field_ok(f, v, values)
                t[3] += ok
                if a.show and a.show in doc_type and not ok:
                    got = _percentage(values) if f == "percentage" else values.get(f)
                    print(f"  XX {name} {f}: expected={v!r} got={got!r}")
    for k, (n, m, f, fo) in totals.items():
        print(f"{k:20} mandatory {m}/{n}  fields {fo}/{f}")
    print(
        "TOTAL",
        sum(t[1] for t in totals.values()),
        "/",
        sum(t[0] for t in totals.values()),
        " fields",
        sum(t[3] for t in totals.values()),
        "/",
        sum(t[2] for t in totals.values()),
    )


if __name__ == "__main__":
    main()
