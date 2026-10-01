"""
Accuracy on the local sample documents (backend/docs/*_CERTIFICATES with
labels.json; never committed). Skipped unless the samples are mounted:

    docker run --rm --network none -m 4g -v <backend>/docs:/samples:ro \\
      -e SAMPLES_DIR=/samples vidyasetu-ml-test:local python -m pytest -q tests/test_sample_eval.py

English-only OCR for now: Hindi/Marathi-only samples are reported, not counted.
"""

import os

import pytest

from sample_eval import evaluate

SAMPLES = os.environ.get("SAMPLES_DIR", "/samples")
pytestmark = pytest.mark.skipif(
    not os.path.exists(os.path.join(SAMPLES, "INCOME_CERTIFICATES", "labels.json")),
    reason="sample documents not mounted (SAMPLES_DIR)",
)

# Floors from the evaluation (re-run tests/sample_eval.py and raise them as accuracy improves).
MIN_MANDATORY = 0.95  # good samples whose mandatory value is read correctly
MIN_FIELDS = 0.85  # all labelled fields of good samples
MIN_DEGRADED_FIELDS = (
    0.90  # fields still read after rotation 5°, blur or a 3% crop, relative to clean
)


def _rate(summary, num, den):
    t = summary["total"]
    return t[num] / max(1, t[den])


@pytest.fixture(scope="module")
def clean():
    """One clean run per session (each run OCRs every sample)."""
    return evaluate(SAMPLES, os.environ.get("EVAL_OUT"), report_lines=False)["summary"]


def test_clean_samples(clean):
    s = clean
    assert _rate(s, "mandatory_ok", "good") >= MIN_MANDATORY, s
    assert _rate(s, "fields_ok", "fields") >= MIN_FIELDS, s
    assert s["peak_rss_mb"] < 4096, s


@pytest.mark.parametrize("how", ["rotate5", "blur", "crop3"])
def test_degraded_samples(how, clean):
    clean = clean["total"]["fields_ok"]
    degraded = evaluate(SAMPLES, how=how, report_lines=False)["summary"]["total"][
        "fields_ok"
    ]
    assert degraded >= MIN_DEGRADED_FIELDS * clean, (how, degraded, clean)
