"""
Repairs typical OCR noise so the extractors' keyword and regex matching still
finds fields on blurry, rotated or cropped scans. Pure text in, text out.

- Label words: a misread label ("Certifcate", "lncome", "Anual") is replaced
  by the nearest known label word (edit distance, tighter for short words).
- Numbers, dates and certificate numbers: letters OCR confuses with digits
  (O->0, l/I/|->1, S->5, B->8, Z->2) inside mostly-digit runs.
- Spacing and punctuation: "12 /04/ 2024" -> "12/04/2024", "Name ;" -> "Name :".

Values read from repaired text are slightly less certain than from raw text;
extract_service applies that penalty.
"""

import re
from functools import lru_cache
from typing import Optional

LABEL_WORDS = (
    "annual",
    "family",
    "income",
    "gross",
    "sources",
    "issued",
    "issue",
    "date",
    "dated",
    "certificate",
    "number",
    "name",
    "applicant",
    "caste",
    "tribe",
    "category",
    "community",
    "scheduled",
    "district",
    "village",
    "tehsil",
    "roll",
    "registration",
    "enrolment",
    "enrollment",
    "marks",
    "obtained",
    "total",
    "percentage",
    "examination",
    "passing",
    "year",
    "receipt",
    "transaction",
    "amount",
    "paid",
    "tuition",
    "account",
    "holder",
    "bank",
    "branch",
    "ifsc",
    "bonafide",
    "institute",
    "institution",
    "college",
    "university",
    "academic",
    "session",
    "course",
    "disability",
    "percent",
    "type",
    "joining",
    "designation",
    "salary",
    "student",
    "father",
    "mother",
    "husband",
    "guardian",
    "occupation",
    "rupees",
    "annum",
    "certify",
    "certified",
    "belongs",
    "semester",
    "programme",
    "employment",
    "position",
)
_LABELS = frozenset(LABEL_WORDS)

# Letters OCR reads in place of digits (inside a mostly-digit run) ...
_TO_DIGIT = str.maketrans(
    {
        "O": "0",
        "o": "0",
        "Q": "0",
        "l": "1",
        "I": "1",
        "|": "1",
        "S": "5",
        "s": "5",
        "B": "8",
        "Z": "2",
        "z": "2",
    }
)
# ... and digits read in place of letters (inside a word).
_TO_LETTER = str.maketrans({"0": "o", "1": "l", "5": "s", "8": "b", "|": "l", "$": "s"})

_CURRENCY = re.compile(r"^(rs\.?|inr|₹)", re.IGNORECASE)


def _distance(a: str, b: str, limit: int) -> int:
    """Levenshtein distance, giving up (returns limit + 1) once it must exceed limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > limit:
            return limit + 1
        prev = cur
    return prev[-1]


@lru_cache(maxsize=4096)
def nearest_label(word: str, in_label_context: bool = False) -> Optional[str]:
    """The label word a noisy token stands for, or None. Tokens under 6 letters
    are fuzzy-matched only in label context (before ':' or another label word),
    so names are not "corrected"."""
    w = word.lower().translate(_TO_LETTER)
    if w in _LABELS:
        return w
    if len(w) < 4 or (len(w) < 6 and not in_label_context):
        return None
    limit = 1 if len(w) <= 8 else 2
    best, best_d, tie = None, limit + 1, False
    for label in LABEL_WORDS:
        d = _distance(w, label, limit)
        if d < best_d:
            best, best_d, tie = label, d, False
        elif d == best_d:
            tie = True
    return best if best is not None and best_d <= limit and not tie else None


def _restyle(label: str, like: str) -> str:
    if like.isupper():
        return label.upper()
    if like[:1].isupper():
        return label.capitalize()
    return label


_WORD = re.compile(r"[A-Za-z][A-Za-z0158|$]{2,}")


def _repair_words(line: str) -> str:
    # Pass 1: long tokens (unambiguous). Pass 2: short tokens, judged by what follows.
    line = _WORD.sub(
        lambda m: _restyle(nearest_label(m.group(0)) or m.group(0), m.group(0))
        if m.group(0).lower() not in _LABELS
        else m.group(0),
        line,
    )

    def short(m: "re.Match[str]") -> str:
        token = m.group(0)
        if token.lower() in _LABELS:
            return token
        after = line[m.end() :].lstrip()
        nxt = re.match(r"[A-Za-z]+", after)
        context = after.startswith((":", "-")) or bool(
            nxt and nxt.group(0).lower() in _LABELS
        )
        label = nearest_label(token, context)
        return _restyle(label, token) if label else token

    return _WORD.sub(short, line)


_LOOKALIKE_RUN = re.compile(r"[0-9OoQlI|SsBZz]+")


def _repair_run(match: "re.Match[str]") -> str:
    run = match.group(0)
    digits = sum(c.isdigit() for c in run)
    return run.translate(_TO_DIGIT) if digits > 0 and digits * 2 >= len(run) else run


def _repair_number_token(token: str) -> str:
    """Runs of digits and digit look-alikes (at least half real digits) get the
    look-alikes fixed: "2O24" -> "2024", "l0/04" -> "10/04"; "SBIN0001234" keeps
    its letters (N breaks the run, "SBI" has no digit)."""
    prefix = ""
    m = _CURRENCY.match(token)
    if m:
        prefix, token = m.group(0), token[m.end() :]
    if not any(c.isdigit() for c in token):
        return prefix + token
    # A grouped amount ("1,2O,OOO"): judged as a whole, separators aside.
    # Starts with a real digit, so "Rs. 1,2O,OOO" is an amount, not a word.
    grouped = re.fullmatch(
        r"(\d[0-9OoQlI|SsBZz]*(?:[,.][0-9OoQlI|SsBZz]+)+)([.,/\-]*)", token
    )
    if grouped:
        return prefix + grouped.group(1).translate(_TO_DIGIT) + grouped.group(2)
    return prefix + _LOOKALIKE_RUN.sub(_repair_run, token)


def repair_ocr_text(text: str) -> str:
    """OCR text with label words, digits and separators repaired; line structure kept."""
    if not text:
        return text
    out = []
    for line in text.split("\n"):
        line = line.replace(";", ":")
        # Spaces OCR inserts around date / number separators.
        line = re.sub(r"(\d)\s*([/\-.])\s*(?=\d)", r"\1\2", line)
        line = " ".join(_repair_number_token(t) for t in line.split(" "))
        # Alphabetic-looking tokens (may carry 0/1/5/8/| from OCR) -> label words.
        line = _repair_words(line)
        out.append(line)
    return "\n".join(out)
