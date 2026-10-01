"""
Layout-aware field extraction for the four document types the api verifies
with rules (income, ST/caste, marksheet, bonafide).

Works on the OCR page's text segments with their boxes, not a flat text blob:
segments are grouped into rows by y-position; a field's value is found to the
right of its label on the same row, or below it in the same column (tables),
or in the sentence the certificate is written in ("... annual income of Rs.
80000 ..."). Labels are matched fuzzily (rapidfuzz) in English, Hindi and
Marathi; values are parsed with OCR-noise repair (O/0, l/1, S/5 inside
numbers), Devanagari digits and Indian formats (1,50,000, Rs/INR/₹,
DD/MM/YYYY, DD-Mon-YYYY).

Each extractor returns (values, confidences) with the same field names as
before (the api contract); a value that was not read is None at 0.0.
Nothing here is tied to the sample files: rules are per document type.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Callable, Dict, List, Optional, Tuple

from rapidfuzz import fuzz

from app.services.ocr_repair import repair_ocr_text
from app.services.ocr_service import OcrPage, Segment

Values = Dict[str, object]
Confs = Dict[str, float]

# ------------------------------------------------------------------ text helpers

_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_OTHER_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯௦௧௨௩௪௫௬௭௮௯", "01234567890123456789")


def ascii_digits(text: str) -> str:
    return text.translate(_DEVANAGARI_DIGITS).translate(_OTHER_DIGITS)


def norm(text: str) -> str:
    """Lower case, ASCII digits, punctuation to spaces (Devanagari kept)."""
    t = ascii_digits(text).lower()
    t = re.sub(r"[^\wऀ-ॿ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def clean(text: str) -> str:
    """OCR-noise repair for value parsing (labels fixed, digit look-alikes in numbers)."""
    return repair_ocr_text(ascii_digits(text))


# ------------------------------------------------------------------ page model


@dataclass
class Row:
    segs: List[Segment]

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segs)

    @property
    def y0(self) -> int:
        return min(s.y0 for s in self.segs)

    @property
    def y1(self) -> int:
        return max(s.y1 for s in self.segs)

    @property
    def conf(self) -> float:
        return sum(s.conf for s in self.segs) / len(self.segs)


class Layout:
    def __init__(self, page: OcrPage):
        self.rows = [Row(r) for r in page.rows]
        self.width = max((s.x1 for s in page.segments), default=1)
        self.height = max((s.y1 for s in page.segments), default=1)
        # Running text for sentence patterns: rows joined with spaces.
        self.flat = " ".join(r.text for r in self.rows)
        self.flat_clean = clean(self.flat)
        # Where each segment sits in the running text (rows and segments joined by spaces).
        self._spans: List[Tuple[int, int, float]] = []
        offset = 0
        for r in self.rows:
            for seg in r.segs:
                self._spans.append((offset, offset + len(seg.text), seg.conf))
                offset += len(seg.text) + 1

    def conf_at(self, pos: int) -> float:
        """OCR confidence of the segment at a position of the running text."""
        for start, end, conf in self._spans:
            if start <= pos <= end:
                return conf
        return 0.0

    def below(
        self, row_index: int, seg: Segment, depth: int = 2
    ) -> List[Tuple[int, Segment]]:
        """Segments in the next rows that share the column of `seg` (horizontal overlap)."""
        out = []
        for i in range(row_index + 1, min(len(self.rows), row_index + 1 + depth)):
            for s in self.rows[i].segs:
                overlap = min(s.x1, seg.x1) - max(s.x0, seg.x0)
                if overlap > 0.3 * min(s.x1 - s.x0, seg.x1 - seg.x0):
                    out.append((i, s))
        return out


@dataclass
class LabelHit:
    row: int
    seg_index: int
    seg: Segment
    end: int  # character offset in seg.text where the label ends
    score: float
    weight: float


def find_labels(
    layout: Layout, variants: List[Tuple[str, float]], threshold: float = 86
) -> List[LabelHit]:
    """Every segment containing (fuzzily) one of the label variants. variants:
    (label text, weight). Short labels must match exactly as a word."""
    hits: List[LabelHit] = []
    for ri, row in enumerate(layout.rows):
        for si, seg in enumerate(row.segs):
            low = ascii_digits(seg.text).lower()
            for label, weight in variants:
                lab = label.lower()
                if len(lab) <= 4:
                    m = re.search(r"(?<![\wऀ-ॿ])" + re.escape(lab) + r"(?![\wऀ-ॿ])", low)
                    if m:
                        hits.append(LabelHit(ri, si, seg, m.end(), 100.0, weight))
                    continue
                if len(low) < len(lab):
                    # partial_ratio would align the SHORTER string: a segment
                    # "TOTAL" is not the label "grand total".
                    score = fuzz.ratio(lab, low)
                    if score >= threshold:
                        hits.append(LabelHit(ri, si, seg, len(seg.text), score, weight))
                    continue
                al = fuzz.partial_ratio_alignment(lab, low)
                if al is not None and al.score >= threshold:
                    hits.append(LabelHit(ri, si, seg, al.dest_end, al.score, weight))
    return hits


def right_of(layout: Layout, hit: LabelHit, max_segs: int = 3) -> str:
    """The rest of the label's segment plus the segments to its right on the same row."""
    row = layout.rows[hit.row]
    rest = hit.seg.text[hit.end :]
    following = [
        s.text for s in row.segs[hit.seg_index + 1 : hit.seg_index + 1 + max_segs]
    ]
    return (rest + " " + " ".join(following)).strip()


# ------------------------------------------------------------------ value parsers

_CURRENCY = r"(?:rs\.?|inr|₹|रु\.?|रुपये|ரூ)"
_AMOUNT = re.compile(
    r"(?:"
    + _CURRENCY
    + r"\s*[:.]?\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{3,9}(?:\.\d{1,2})?)\s*(/-)?",
    re.IGNORECASE,
)


_LOOKALIKE = str.maketrans(
    {
        "O": "0",
        "o": "0",
        "Q": "0",
        "D": "0",
        "l": "1",
        "I": "1",
        "|": "1",
        "S": "5",
        "s": "5",
        "B": "8",
        "Z": "2",
    }
)


def fix_number_tokens(text: str) -> str:
    """A token that starts with a digit and is otherwise digits, separators and
    letters OCR confuses with digits is a number: "50ooo" -> "50000",
    "8oooo" -> "80000", "1,2O,OOO" -> "1,20,000"."""
    return re.sub(
        r"(?<![A-Za-z])\d[\dOoQDlI|SsBZ,.]{2,}(?![A-Za-z])",
        lambda m: m.group(0).translate(_LOOKALIKE),
        text,
    )


_NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fourty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}
# Hindi and Marathi spell every number 1-99 as its own word.
_NUMBER_WORDS.update(
    {
        "एक": 1,
        "दो": 2,
        "तीन": 3,
        "चार": 4,
        "पांच": 5,
        "छह": 6,
        "सात": 7,
        "आठ": 8,
        "नौ": 9,
        "दस": 10,
        "ग्यारह": 11,
        "बारह": 12,
        "तेरह": 13,
        "चौदह": 14,
        "पंद्रह": 15,
        "सोलह": 16,
        "सत्रह": 17,
        "अठारह": 18,
        "उन्नीस": 19,
        "बीस": 20,
        "इक्कीस": 21,
        "बाईस": 22,
        "तेईस": 23,
        "चौबीस": 24,
        "पच्चीस": 25,
        "छब्बीस": 26,
        "सत्ताईस": 27,
        "अट्ठाईस": 28,
        "उनतीस": 29,
        "तीस": 30,
        "इकतीस": 31,
        "बत्तीस": 32,
        "तैंतीस": 33,
        "चौंतीस": 34,
        "पैंतीस": 35,
        "छत्तीस": 36,
        "सैंतीस": 37,
        "अड़तीस": 38,
        "उनतालीस": 39,
        "चालीस": 40,
        "इकतालीस": 41,
        "बयालीस": 42,
        "तैंतालीस": 43,
        "चवालीस": 44,
        "पैंतालीस": 45,
        "छियालीस": 46,
        "सैंतालीस": 47,
        "अड़तालीस": 48,
        "उनचास": 49,
        "पचास": 50,
        "इक्यावन": 51,
        "बावन": 52,
        "तिरपन": 53,
        "चौवन": 54,
        "पचपन": 55,
        "छप्पन": 56,
        "सत्तावन": 57,
        "अट्ठावन": 58,
        "उनसठ": 59,
        "साठ": 60,
        "इकसठ": 61,
        "बासठ": 62,
        "तिरसठ": 63,
        "चौंसठ": 64,
        "पैंसठ": 65,
        "छियासठ": 66,
        "सड़सठ": 67,
        "अड़सठ": 68,
        "उनहत्तर": 69,
        "सत्तर": 70,
        "इकहत्तर": 71,
        "बहत्तर": 72,
        "तिहत्तर": 73,
        "चौहत्तर": 74,
        "पचहत्तर": 75,
        "छिहत्तर": 76,
        "सतहत्तर": 77,
        "अठहत्तर": 78,
        "उन्यासी": 79,
        "अस्सी": 80,
        "इक्यासी": 81,
        "बयासी": 82,
        "तिरासी": 83,
        "चौरासी": 84,
        "पचासी": 85,
        "छियासी": 86,
        "सत्तासी": 87,
        "अट्ठासी": 88,
        "नवासी": 89,
        "नब्बे": 90,
        "इक्यानवे": 91,
        "बानवे": 92,
        "तिरानवे": 93,
        "चौरानवे": 94,
        "पचानवे": 95,
        "छियानवे": 96,
        "सत्तानवे": 97,
        "अट्ठानवे": 98,
        "निन्यानवे": 99,
        "दोन": 2,
        "पाच": 5,
        "सहा": 6,
        "नऊ": 9,
        "दहा": 10,
        "अकरा": 11,
        "बारा": 12,
        "तेरा": 13,
        "चौदा": 14,
        "पंधरा": 15,
        "सोळा": 16,
        "सतरा": 17,
        "अठरा": 18,
        "एकोणीस": 19,
        "वीस": 20,
        "एकवीस": 21,
        "बावीस": 22,
        "तेवीस": 23,
        "चोवीस": 24,
        "पंचवीस": 25,
        "सव्वीस": 26,
        "सत्तावीस": 27,
        "अठ्ठावीस": 28,
        "एकोणतीस": 29,
        "एकतीस": 31,
        "तेहतीस": 33,
        "चौतीस": 34,
        "पस्तीस": 35,
        "सदतीस": 37,
        "अडतीस": 38,
        "एकोणचाळीस": 39,
        "चाळीस": 40,
        "एक्केचाळीस": 41,
        "बेचाळीस": 42,
        "त्रेचाळीस": 43,
        "चव्वेचाळीस": 44,
        "पंचेचाळीस": 45,
        "सेहेचाळीस": 46,
        "सत्तेचाळीस": 47,
        "अठ्ठेचाळीस": 48,
        "एकोणपन्नास": 49,
        "पन्नास": 50,
        "एक्कावन्न": 51,
        "बावन्न": 52,
        "त्रेपन्न": 53,
        "चोपन्न": 54,
        "पंचावन्न": 55,
        "छप्पन्न": 56,
        "सत्तावन्न": 57,
        "अठ्ठावन्न": 58,
        "एकोणसाठ": 59,
        "एकसष्ट": 61,
        "बासष्ट": 62,
        "त्रेसष्ट": 63,
        "चौसष्ट": 64,
        "पासष्ट": 65,
        "सहासष्ट": 66,
        "सदुसष्ट": 67,
        "अडुसष्ट": 68,
        "एकोणसत्तर": 69,
        "एक्काहत्तर": 71,
        "बाहत्तर": 72,
        "त्र्याहत्तर": 73,
        "चौऱ्याहत्तर": 74,
        "पंच्याहत्तर": 75,
        "शहात्तर": 76,
        "सत्त्याहत्तर": 77,
        "अठ्ठ्याहत्तर": 78,
        "एकोणऐंशी": 79,
        "ऐंशी": 80,
        "एक्याऐंशी": 81,
        "ब्याऐंशी": 82,
        "त्र्याऐंशी": 83,
        "चौऱ्याऐंशी": 84,
        "पंच्याऐंशी": 85,
        "शहाऐंशी": 86,
        "सत्त्याऐंशी": 87,
        "अठ्ठ्याऐंशी": 88,
        "एकोणनव्वद": 89,
        "नव्वद": 90,
        "एक्याण्णव": 91,
        "ब्याण्णव": 92,
        "त्र्याण्णव": 93,
        "चौऱ्याण्णव": 94,
        "पंच्याण्णव": 95,
        "शहाण्णव": 96,
        "सत्त्याण्णव": 97,
        "अठ्ठ्याण्णव": 98,
        "नव्व्याण्णव": 99,
        "पाँच": 5,
        "छः": 6,
        "पन्द्रह": 15,
    }
)
_SCALE_WORDS = {
    "hundred": 100,
    "thousand": 1000,
    "lakh": 100000,
    "lakhs": 100000,
    "lac": 100000,
    "lacs": 100000,
    "crore": 10_000_000,
    "सौ": 100,
    "शंभर": 100,
    "हजार": 1000,
    "हज़ार": 1000,
    "लाख": 100000,
    "करोड़": 10_000_000,
}


def _dev_key(word: str) -> str:
    return re.sub(r"[ंँ़्ः]", "", word).replace("ब", "व")


_FILLER_WORDS = {
    "and",
    "only",
    "rupees",
    "rupee",
    "rs",
    "out",
    "of",
    "मात्र",
    "रुपये",
    "केवल",
}
_VOCAB = list(_NUMBER_WORDS) + list(_SCALE_WORDS)
_DEVANAGARI_NUMBERS = {
    _dev_key(w): w for w in _VOCAB + list(_FILLER_WORDS) if not w.isascii()
}


def _number_word(token: str) -> Optional[str]:
    t = token.lower().strip(".,;:()*_-")
    if t in _NUMBER_WORDS or t in _SCALE_WORDS or t in _FILLER_WORDS:
        return t
    if re.fullmatch(r"[ऀ-ॿ]+", t):
        # Devanagari: exact after dropping the marks OCR loses or adds (nasal
        # dots, nukta, virama) and treating व/ब alike - fuzzy matching would
        # turn ordinary words into numbers.
        return _DEVANAGARI_NUMBERS.get(_dev_key(t))
    if len(t) < 3 or not re.fullmatch(r"[a-z]+", t):
        return None
    from rapidfuzz.distance import Levenshtein

    limit = 2 if len(t) >= 6 else 1
    best_word, best_d = None, limit + 1
    for word in _VOCAB:
        if not word.isascii() or abs(len(word) - len(t)) > limit:
            continue
        d = Levenshtein.distance(t, word, score_cutoff=limit)
        if d < best_d:
            best_word, best_d = word, d
    return best_word


def words_amounts(text: str) -> List[Tuple[int, int]]:
    """(value, position) for every number written in words ("One Lakh Twenty
    Thousand", "FOUR HUNDRED AND EIGHTY TWO", "नब्बे हजार"), OCR noise tolerated."""
    out: List[Tuple[int, int]] = []
    # "EIGHTYTHREE", "FIFTYTWO": compounds printed without a space.
    text = re.sub(
        r"(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)(?=(one|two|three|four|five|six|seven|eight|nine)\b)",
        lambda m: m.group(1) + " ",
        text,
        flags=re.I,
    )
    tokens = [(m.group(0), m.start()) for m in re.finditer(r"[A-Za-zऀ-ॿ]+", text)]
    i = 0
    while i < len(tokens):
        total = current = 0
        seen = 0
        start = tokens[i][1]
        j = i
        while j < len(tokens):
            w = _number_word(tokens[j][0])
            if w is None:
                break
            if w in _NUMBER_WORDS:
                current += _NUMBER_WORDS[w]
                seen += 1
            elif w in _SCALE_WORDS:
                scale = _SCALE_WORDS[w]
                if scale == 100:
                    current = (current or 1) * 100
                else:
                    total += (current or 1) * scale
                    current = 0
                seen += 1
            j += 1
        words_run = [_number_word(tokens[k][0]) for k in range(i, j)]
        while words_run and words_run[-1] in _FILLER_WORDS and words_run[-1] == "and":
            # "THREE HUNDRED AND" with the rest on another line: unfinished, not 300.
            seen = 0
            break
        digits = [_NUMBER_WORDS[w] for w in words_run if w in _NUMBER_WORDS]
        if (
            seen >= 2
            and len(digits) == seen
            and all(d <= 9 for d in digits)
            and "zero" in words_run
        ):
            # Read digit by digit, as marksheets do: "FIVE ZERO TWO" = 502.
            out.append((int("".join(str(d) for d in digits)), start))
            i = j
        elif seen >= 2:
            out.append((total + current, start))
            i = j
        else:
            i += 1
    return out


def amounts(text: str) -> List[Tuple[int, bool, int, int]]:
    """(value, has_currency, start, end) for every amount in the text."""
    t = fix_number_tokens(clean(text))
    out = []
    for m in _AMOUNT.finditer(t):
        raw = m.group(1)
        # part of an identifier (letters or slashes glued to it): not an amount
        before = t[max(0, m.start(1) - 1) : m.start(1)]
        after = t[m.end(1) : m.end(1) + 1]
        glued_symbol = False
        if re.match(r"[A-Za-z/\-]", before) and not re.search(
            _CURRENCY + r"\s*[:.]?\s*$", t[: m.start(1)], re.I
        ):
            # One isolated letter before "125000/-" is a rupee sign OCR misread.
            if (
                re.match(r"[A-Za-z]", before)
                and not re.match(
                    r"[A-Za-z0-9]", t[max(0, m.start(1) - 2) : m.start(1) - 1] or " "
                )
                and m.group(2)
                and float(raw.replace(",", "")) >= 1000
            ):
                glued_symbol = True
            else:
                continue
        if re.match(r"[A-Za-z]", after or "") or (
            after == "/" and t[m.end(1) : m.end(1) + 2] != "/-"
        ):
            continue
        value = float(raw.replace(",", ""))
        has_currency = (
            bool(re.match(_CURRENCY, m.group(0).strip(), re.I))
            or bool(m.group(2))
            or glued_symbol
        )
        out.append((int(round(value)), has_currency, m.start(), m.end()))
    return out


_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
_DATE_PATTERNS = [
    (
        re.compile(
            r"(?<![\w/\-])(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?![\w/]|-\d)"
        ),
        "dmy",
    ),
    (re.compile(r"\b(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\b"), "ymd"),
    (
        re.compile(
            r"\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,']*(\d{4}|\d{2})\b",
            re.I,
        ),
        "dMy",
    ),
    (
        re.compile(
            r"\b([A-Za-z]{3,9})[\s.,]*(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})\b", re.I
        ),
        "Mdy",
    ),
]


def _mkdate(y: int, m: int, d: int) -> Optional[str]:
    if y < 100:
        y += 2000 if y <= date.today().year % 100 + 1 else 1900
    if not 1950 <= y <= date.today().year + 1:
        return None  # "2913-05-30": a misread digit, not a date
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def dates(text: str) -> List[Tuple[str, int]]:
    """(ISO date, position) for every full date in the text."""
    t = ascii_digits(text)
    t = re.sub(r"(?<=\d)[Oo](?=\d)|(?<=\d)[Oo]\b|\b[Oo](?=\d)", "0", t)
    out = []
    for pattern, kind in _DATE_PATTERNS:
        for m in pattern.finditer(t):
            a, b, c = m.groups()
            iso = None
            if kind == "dmy":
                iso = _mkdate(int(c), int(b), int(a))
            elif kind == "ymd":
                iso = _mkdate(int(a), int(b), int(c))
            else:
                month_word, day, year = (b, a, c) if kind == "dMy" else (a, b, c)
                mon = _MONTHS.get(month_word[:3].lower())
                if mon:
                    iso = _mkdate(int(year), mon, int(day))
            if iso and not any(p == m.start() for _, p in out):
                out.append((iso, m.start()))
    return sorted(out, key=lambda x: x[1])


_TITLES = r"(?:mr|mrs|ms|miss|mst|shri|shree|sri|sh|smt|srimathi|srimati|shrimati|kumari|kumar[il1|]|kum|ku|km|master|dr|selvi|thiru|late|श्री|शरी|श्रीमती|सुश्री|कुमारी|कु)"
_TITLE_RUN = re.compile(
    r"^(?:\s*(?:" + _TITLES + r"|kumar(?=\.\s*[A-Z]))(?![A-Za-z])\.?\s*[/,]?\s*)+", re.I
)
# Words that are never part of a person's name: a candidate containing one is a misread label.
_NOT_NAME = re.compile(
    r"\b(?:signature|signed|valid|income|monthly|annual|certificate|certif\w*|government|office|department|"
    r"district|tehsil\w*|revenue|issued|date|name|applicant|candidate|student|board|council|university|"
    r"college|school|institute|examination|marks|result|scheme|state|india|seal|secretary|officer|"
    r"father|mother|address|village|taluk|mandal|this|that|the|from|sources|study|analysis|culture|"
    r"report|project|thesis|system|organizational|organisational|medium|practical|theory|words?|subjects?|"
    r"number|no|ref|reference|appeared|passed|pass|roll|seat|total|grade|division|english|hindi|marathi|"
    r"mathematics|maths|science|social|sanskrit|language|regular|private|centre|center|code|session|"
    r"month|year|march|april|may|june|february|in|of|and|or|are|as|is|was|has|with|by|to|for|on|at|"
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|"
    r"sixty|seventy|eighty|ninety|hundred|thousand|lakh|only|rupees|"
    r"obtained|maximum|minimum|max|min|full|grand|aggregate|percentage|result|qualified|work|"
    r"proj|stream|faculty|group|class|standard|std|issue|issued|dated|place|seal|sign|verified|"
    r"msbshse|cbse|board|digital|copy|statement|sheet|memorandum|cum|assessment|internal|external|"
    r"activity|sc|st|obc|figures|remarks|distn|distinction|first|second|third|agriculture|salary|wages|"
    r"business|rental|pension|profession|others|relationship|occupation|member)\b|"
    r"सरकार|सेवा|कार्यालय|प्रमाण|शासन|विभाग|जिला|तहसील",
    re.I,
)
_NAME_STOP = re.compile(
    r"(?:\b(?:s\s*/\s*o|d\s*/\s*o|w\s*/\s*o|c\s*/\s*o|h\s*/\s*o|son|daughter|wife|husband|father|mother|guardian|"
    r"resident|residing|r/o|bearing|roll|reg(?:istration|d)?|registered|has|who|is|was|belongs?|belonging|of\s+village|"
    r"aged?|date|dob|having|under|studying|admitted|enrolled|certificate|with|whose|from|in\s+the|for|"
    r"राहणार|यांची|यांना|यांचा|पिता|पुत्र|पुत्री|निवासी)\b|[,(;:|]|\d)",
    re.I,
)


def parse_name(text: str, max_words: int = 6) -> Optional[str]:
    """A person's name at the start of `text`: titles dropped, cut at the first
    relation word / punctuation / digit. Latin or Devanagari."""
    t = re.sub(r"(?<=\w)_(?=\w)", " ", text).strip(" .:-_—=|*\"'")
    t = re.sub(r"(?<=[a-z]{2})(?=[A-Z][a-z]{2})", " ", t)
    t = re.sub(r"^[_\-.\s]+", "", t)
    # Devanagari name followed by its Latin form in brackets: prefer the Latin.
    paren = re.match(r"^([ऀ-ॿ .]+)\(\s*([A-Za-z .]+)\)", t)
    if paren:
        t = paren.group(2)
    t = _TITLE_RUN.sub("", t)
    cut = _NAME_STOP.search(t)
    if cut:
        t = t[: cut.start()]
    t = re.sub(r"[_\-]{2,}.*$", "", t)
    words = [w for w in re.split(r"\s+", t.replace(".", ". ").strip()) if w]
    words = [w.strip(".") for w in words if re.fullmatch(r"[A-Za-z.'ऀ-ॿ]+", w)]
    words = [w for w in words if w]
    if not words or len(words) > max_words:
        words = words[:max_words]
    if not words:
        return None
    # Cut at the first word that is never part of a name ("... MUZAMMIL.M school of ...").
    for k, w in enumerate(words):
        if _NOT_NAME.fullmatch(w) or _NOT_NAME.search(w + " "):
            words = words[:k]
            break
    # OCR garbage is not a name: every Latin word needs a vowel and no run of 4+ consonants.
    if any(
        re.fullmatch(r"[A-Za-z]{2,}", w)
        and (
            not re.search(r"[aeiouyAEIOUY]", w) or re.search(r"[^aeiouyAEIOUY]{4,}", w)
        )
        for w in words
    ):
        return None
    if sum(1 for w in words if len(w) == 2 and w.isascii()) >= 2:
        return None
    if (
        len(words) == 1
        and fuzz.ratio(words[0].lower(), "shri") >= 60
        or (
            len(words) == 1
            and words[0].lower() in ("srimathi", "srimati", "sushri", "kumari")
        )
    ):
        return None
    name = " ".join(words)
    letters = re.sub(r"[^A-Za-zऀ-ॿ]", "", name)
    if len(letters) < 3 or (len(words) == 1 and len(letters) < 4):
        return None
    if re.search(r"[A-Za-z]", name):
        name = " ".join(
            w.capitalize() if len(w) > 1 else w.upper() for w in name.split()
        )
    return name


_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9/\-_.]*[A-Za-z0-9]")


def parse_identifier(text: str, min_digits: int = 3) -> Optional[str]:
    """The first certificate / roll-number-like token: digits (at least
    min_digits), optionally letters and / - separators."""
    t = clean(text).strip(" .:-#")
    t = re.sub(r"^(?:no|number)\b\.?\s*[:\-]?\s*", "", t, flags=re.I)
    for m in _ID.finditer(t):
        token = m.group(0).strip(".")
        if sum(c.isdigit() for c in token) >= min_digits and len(token) >= 4:
            # "e-CAS/3901 of 2017": keep the "of YYYY" suffix out
            return token
    return None


def best(cands: List[Tuple[float, object, float]]) -> Tuple[Optional[object], float]:
    """Highest-scoring candidate: (value, confidence)."""
    if not cands:
        return None, 0.0
    score, value, conf = max(cands, key=lambda c: c[0])
    return value, conf


def _conf(score: float, ocr: float, top: float = 0.95) -> float:
    """Field confidence: the OCR's own confidence, scaled by how strong the
    evidence is (label weight / candidate score, saturating at 3)."""
    return round(max(0.3, min(top, ocr * (0.8 + 0.05 * min(max(score, 0.0), 3.0)))), 2)


def _identifier_conf(ident: str, conf: float) -> float:
    """A short, unstructured number ("4471") is a weak reading of a certificate number."""
    structured = len(ident) >= 8 and (
        re.search(r"[A-Za-z]", ident) or re.search(r"[/\-]", ident)
    )
    return conf if structured or len(ident) >= 10 else round(conf * 0.55, 2)


# ------------------------------------------------------------------ shared fields

_ISSUE_LABELS = [
    ("date of issue", 3.0),
    ("issue date", 3.0),
    ("issued on", 3.0),
    ("issuance date", 3.0),
    ("issued date", 3.0),
    ("certificate issued date", 3.0),
    ("जारी दिनांक", 3.0),
    ("date of publication", 2.0),
    ("dated", 2.0),
    ("date", 2.0),
    ("दिनांक", 2.0),
    ("दिनाक", 2.0),
    ("तारीख", 2.0),
    ("तिथि", 1.0),
]
_NOT_ISSUE = re.compile(
    r"birth|जन्म|dob|valid|validity|वैध|upto|up to|until|print|signed|signing|application date|"
    r"order|notification|act\b|amended|from\s+\d",
    re.I,
)


def issued_date(layout: Layout) -> Tuple[Optional[str], float]:
    cands: List[Tuple[float, object, float]] = []
    for hit in find_labels(layout, _ISSUE_LABELS, threshold=90):
        row = layout.rows[hit.row]
        if _NOT_ISSUE.search(row.text):
            continue
        context = (layout.rows[hit.row - 1].text if hit.row else "") + " " + row.text
        if re.search(
            r"notification|vide|in\s+accordance|order\s+no|letter\s+no|अधिसूचना",
            context,
            re.I,
        ):
            continue
        # A label at the start of its segment ("Date: ..."), not "... dated ..." mid-sentence.
        inline = (
            len(hit.seg.text[: hit.end].strip())
            > len(norm(hit.seg.text[: hit.end])) + 12
            or hit.end > 30
        )
        texts = [right_of(layout, hit)] + [
            s.text for _, s in layout.below(hit.row, hit.seg, 1)
        ]
        for k, t in enumerate(texts):
            found = dates(t)
            if found:
                pos = hit.row / max(1, len(layout.rows))
                score = (
                    hit.weight - 0.5 * k + 0.1 * (1 - pos) - (1.0 if inline else 0.0)
                )
                # A full date (four-digit year) right after its label is a strong reading.
                bonus = 0.05 if re.search(r"\d{4}", t) else 0.0
                conf = min(0.95, _conf(hit.weight, hit.seg.conf) + bonus)
                cands.append((score, found[0][0], conf))
                break
    value, conf = best(cands)
    if value is None:
        # A lone date on a row of its own near the signature / header (no label).
        for ri, row in enumerate(layout.rows):
            if _NOT_ISSUE.search(row.text) or re.search(
                r"birth|जन्म", layout.rows[ri - 1].text if ri else "", re.I
            ):
                continue
            found = dates(row.text)
            if found and len(norm(row.text)) <= 24:
                cands.append((0.5, found[0][0], 0.5))
        value, conf = best(cands)
    return value, conf


def certificate_number(
    layout: Layout, labels: List[Tuple[str, float]]
) -> Tuple[Optional[str], float]:
    cands: List[Tuple[float, object, float]] = []
    for hit in find_labels(layout, labels, threshold=88):
        texts = [right_of(layout, hit, 2)] + [
            s.text for _, s in layout.below(hit.row, hit.seg, 1)
        ]
        for k, t in enumerate(texts):
            ident = parse_identifier(t)
            if ident and not dates(ident):
                conf = _identifier_conf(ident, _conf(hit.weight, hit.seg.conf, 0.9))
                cands.append((hit.weight - 0.5 * k, ident, conf))
                break
    return best(cands)


_CERTIFY = (
    r"(?:certif(?:y|ied)\s+that|certify|प्रमाणित\s+किया\s+जाता\s+है\s+कि|प्रमाणित\s+करण्यात\s+येते\s+की|"
    r"marks\s+obtained\s+by|statement\s+of\s+marks\s+obtained\s+by|bonafide\s+(?:record\s+of\s+)?work\s+(?:carried\s+out\s+)?by|"
    r"bonafide\s+work\s+of|carried\s+out\s+(?:independently\s+)?by|sources\s+of)"
)


def name_from_sentence(layout: Layout) -> List[Tuple[float, object, float]]:
    cands: List[Tuple[float, object, float]] = []
    for m in re.finditer(_CERTIFY, layout.flat, re.I):
        rest = layout.flat[m.end() : m.end() + 120]
        if re.search(
            r"project|report|thesis|titled|record\s+of\s+work|dissertation",
            rest[:60],
            re.I,
        ) and not re.search(r"\bby\b|\bof\b", m.group(0), re.I):
            continue  # "certify that the project titled ..." - the name comes later, after "by"
        rest = re.sub(
            r"^[\s:,\-_.]*(?:the\s+)?(?:(?:applicant|candidate|student|project|report|thesis)\b[^A-Z]{0,40})?",
            "",
            rest,
        )
        rest = re.sub(r"^[\s_.\-]*", "", rest)
        # a project-certificate wording ("that the project ... by NAME") is handled by "by"
        name = parse_name(rest)
        first = rest.strip(" :.-_").split()[0] if rest.strip(" :.-_") else ""
        if (
            name
            and " " not in name
            and not re.fullmatch(
                r"[A-Z]{4,}\.?",
                _TITLE_RUN.sub("", rest).strip().split()[0]
                if _TITLE_RUN.sub("", rest).strip()
                else first,
            )
        ):
            name = None  # one word: only when printed in capitals ("MOHANA")
        if name and not re.match(
            r"(?i)(the|this|annual|income|project|report|thesis|above|below|candidate)\b",
            name,
        ):
            # The name's OCR must be confident: a blurred line reads as a plausible-looking non-name.
            conf = layout.conf_at(m.end() + max(0, rest.find(name.split()[0][:3])))
            if conf < 0.8:
                continue
            strong = re.search(r"work|carried|by", m.group(0), re.I)
            cands.append((3.5 if strong else 3.0, name, round(min(0.9, conf), 2)))
    # Marathi: "श्री. NAME राहणार"
    for m in re.finditer(
        r"श्री\.?\s*([ऀ-ॿ ]{3,40}?)\s+(?:राहणार|यांची|यांना|यांचा)", layout.flat
    ):
        cands.append((2.5, " ".join(m.group(1).split()), 0.8))
    return cands


def name_from_labels(
    layout: Layout, labels: List[Tuple[str, float]], exclude: str
) -> List[Tuple[float, object, float]]:
    cands: List[Tuple[float, object, float]] = []
    for row in layout.rows:
        for si, seg in enumerate(row.segs[:-1]):
            if (
                seg.text.strip()
                and not _TITLE_RUN.sub("", seg.text).strip(" .:/,-")
                and "/" in seg.text
            ):
                nxt = row.segs[si + 1]
                name = parse_name(nxt.text)
                if name and nxt.conf >= 0.85:
                    cands.append((3.2, name, _conf(3.2, nxt.conf, 0.92)))
    for hit in find_labels(layout, labels, threshold=88):
        label_text = layout.rows[hit.row].text
        if re.search(exclude, hit.seg.text[: hit.end + 12], re.I):
            continue
        row = layout.rows[hit.row]
        nearby = " ".join(
            r.text for r in layout.rows[max(0, hit.row - 2) : hit.row + 2]
        )
        if _OFFICER.search(nearby):
            continue  # the signing officer's "Name :", not the holder's
        right = (
            row.segs[hit.seg_index + 1] if hit.seg_index + 1 < len(row.segs) else None
        )
        rest = hit.seg.text[hit.end :].strip(" :.-")
        # "(SURNAME FIRST)" / "(IN CAPITALS)" only qualifies the label: the value follows.
        rest = re.sub(r"^\(.*?\)\s*[:/]?", "", rest).strip(" :.-/")
        if rest:
            # "Name of the family member": the label's own cell decides, never the next column.
            sources = [(rest, hit.seg.conf)]
        else:
            # The value's own confidence (not the label's) decides.
            sources = [(right.text, right.conf)] if right else []
            sources += [(s.text, s.conf) for _, s in layout.below(hit.row, hit.seg, 1)]
        for k, (t, conf) in enumerate(sources):
            if re.search(exclude, t[:30], re.I) or conf < 0.85:
                continue
            name = parse_name(t)
            # A single word only when printed in capitals ("RAJNEESH"), not a stray word.
            if name and (
                " " in name
                or re.fullmatch(
                    r"[A-Z]{4,}", t.strip(" :.-").split()[0] if t.strip(" :.-") else ""
                )
            ):
                cands.append(
                    (hit.weight - 0.4 * k, name, _conf(hit.weight, conf, 0.92))
                )
                break
        del label_text
    return cands


_OFFICER = re.compile(
    r"tahsildar|tehsildar|officer|designation|signature|signed|secretary|controller|principal|registrar|"
    r"\bdean\b|head\s+of|commissioner|magistrate|authority",
    re.I,
)
_RELATIVE = r"father|mother|husband|guardian|पिता|माता|पति|आईचे|वडिलांचे|school|institution|college|विद्यालय"


# ------------------------------------------------------------------ income certificate

_INCOME_WORDS = re.compile(
    r"income|annual|family|आय|उत्पन्न|वार्षिक|आमदनी|वरुमानम|வருமான|per\s+annum|p\.?\s*a\.?\b",
    re.I,
)
_MONTHLY = re.compile(r"monthly|per\s+month|मासिक|महिना", re.I)
_YEARLY = re.compile(r"annual|per\s+annum|yearly|वार्षिक", re.I)
_NOT_AMOUNT_ROW = re.compile(
    r"pin\s*code|pincode|aadhaar|aadhar|mobile|phone|ph\.?\s*no|g\.?o\.?|notification|act\s+\d|token|"
    r"application|registration|serial|sl\.?\s*no|certificate\s*no|reference|in\s+words|अक्षरी|शब्दों|"
    r"bsnl|landline|call\s+the|helpline|ward\s+no|h\.?\s*no|door\s+no|survey",
    re.I,
)
_INCOME_COLUMN = [
    ("annual income", 3.0),
    ("वार्षिक उत्पन्न", 3.0),
    ("वार्षिक आय", 3.0),
    ("total income", 3.0),
    ("income (in rs", 3.0),
    ("income(in", 3.0),
    ("कुल आय", 3.0),
    ("total annual income", 3.5),
]


def _one_digit_apart(a: int, b: int) -> bool:
    """One digit misread, dropped or added ("7500" for 75000, "748000" for 48000)."""
    from rapidfuzz.distance import Levenshtein

    return Levenshtein.distance(str(a), str(b), score_cutoff=1) <= 1


def income(layout: Layout) -> Tuple[Values, Confs]:
    values: Values = {
        "family_income_annual": None,
        "issued_date": None,
        "certificate_number": None,
        "applicant_name": None,
    }
    confs: Confs = {k: 0.0 for k in values}

    cands: List[Tuple[float, object, float]] = []
    raw_of: Dict[Tuple[float, object], int] = {}
    row_of: Dict[Tuple[float, object], int] = {}
    column_hits = find_labels(layout, _INCOME_COLUMN, threshold=88)
    for ri, row in enumerate(layout.rows):
        text = row.text
        if re.search(r"in\s+words|अक्षरी|शब्दों\s+में", text, re.I) and not re.search(
            r"\d{4}", text
        ):
            continue
        prev = " ".join(r.text for r in layout.rows[max(0, ri - 3) : ri])
        for seg in row.segs:
            for value, has_cur, start, _ in amounts(seg.text):
                if not (500 <= value <= 50_000_000):
                    continue
                context = seg.text[max(0, start - 60) : start]
                before = (prev + " " + text[: text.find(seg.text) + start])[-450:]
                if _NOT_AMOUNT_ROW.search(context) or (
                    _NOT_AMOUNT_ROW.search(text) and not has_cur
                ):
                    continue
                if 1900 <= value <= 2100 and not has_cur:
                    continue
                if re.search(
                    r"\d{2}[/\-.]\d{2}[/\-.]" + str(value), ascii_digits(text)
                ):
                    continue  # the year of a date
                score = 0.0
                score += 3.0 if has_cur else 0.0
                score += (
                    3.0
                    if _INCOME_WORDS.search(text)
                    else (1.5 if _INCOME_WORDS.search(prev) else 0.0)
                )
                score += (
                    2.0 if re.search(r"\btotal\b|कुल|एकूण|gross", text, re.I) else 0.0
                )
                in_column = [
                    h
                    for h in column_hits
                    if 0 < ri - h.row <= 6
                    and min(seg.x1, h.seg.x1) - max(seg.x0, h.seg.x0) > 0
                ]
                if in_column:
                    # Under the income column; in a multi-year table the latest
                    # year (the lowest row) is the one that counts.
                    score += 3.0 + 0.6 * (ri - max(h.row for h in in_column))
                m_month = [m.end() for m in _MONTHLY.finditer(before)]
                m_year = [m.end() for m in _YEARLY.finditer(before)]
                monthly = bool(m_month) and (not m_year or m_month[-1] > m_year[-1])
                raw = value
                if monthly:
                    value = value * 12
                    score -= 0.5
                if value % 10 == 0 or has_cur:
                    score += 0.5
                cands.append((score, value, _conf(min(score, 6) / 1.2, seg.conf)))
                raw_of[(score, value)] = raw
                row_of[(score, value)] = ri
    # The amount in words ("Rupees One Lakh Twenty Thousand only") confirms a
    # figure, or stands in for one OCR could not read.
    in_words = [
        (v, pos)
        for v, pos in words_amounts(layout.flat)
        if 100 <= v <= 50_000_000
        and (
            re.search(
                r"rupees|rs\b|रुपये|in\s+words|अक्षरी|\(",
                layout.flat[max(0, pos - 40) : pos],
                re.I,
            )
            or re.search(
                r"thousand|lakh|हजार|हज़ार|लाख", layout.flat[pos : pos + 60], re.I
            )
        )
    ]
    starts, offset = [], 0
    for r in layout.rows:
        starts.append(offset)
        offset += len(r.text) + 1
    for w, pos in in_words:
        wrow = max(i for i, st in enumerate(starts) if st <= pos)
        near = [c for c in cands if abs(row_of.get((c[0], c[1]), -9) - wrow) <= 1]
        exact = [c for c in cands if raw_of.get((c[0], c[1]), c[1]) == w or c[1] == w]
        close = [
            c
            for c in near
            if abs(raw_of.get((c[0], c[1]), c[1]) - w) <= 0.15 * w
            or _one_digit_apart(raw_of.get((c[0], c[1]), c[1]), w)
            # "₹ 48000" read as "748000": the rupee sign became a digit
            or str(raw_of.get((c[0], c[1]), c[1]))[1:] == str(w)
        ]
        if exact:
            cands = [
                (c[0] + 3.0, c[1], max(c[2], 0.9)) if c in exact else c for c in cands
            ]
        elif close:
            # The figure next to the words was misread by a digit or two: the words win.
            fixed = []
            for c in cands:
                if c in close:
                    factor = c[1] / max(1, raw_of.get((c[0], c[1]), c[1]))
                    fixed.append((c[0] + 1.0, int(w * factor), 0.85))
                else:
                    fixed.append(c)
            cands = fixed
        elif not near and w >= 1000:
            # No figure was read where the words are: the words stand in for it.
            cands.append((4.5, w, 0.75))
    value, conf = best([c for c in cands if c[0] >= 3.0])
    values["family_income_annual"], confs["family_income_annual"] = value, conf

    values["issued_date"], confs["issued_date"] = issued_date(layout)
    values["certificate_number"], confs["certificate_number"] = certificate_number(
        layout,
        [
            ("certificate no", 3.0),
            ("certificate number", 3.0),
            ("cert. no", 3.0),
            ("प्रमाणपत्र क्रमांक", 3.0),
            ("प्रमाण-पत्र संख्या", 3.0),
            ("प्रमाणपत्र संख्या", 3.0),
            ("प्रमाणपत्र क्र", 3.0),
            ("क्रमांक", 2.0),
            ("application no", 2.0),
            ("document serial no", 1.5),
            ("case no", 2.5),
            ("no.", 1.0),
            ("q.cron", 1.5),
            ("प्रमाण पत्र नं", 3.0),
        ],
    )

    names = name_from_sentence(layout) + name_from_labels(
        layout,
        [
            ("name of person to whom certificate is issued", 3.5),
            ("name of the applicant", 3.0),
            ("applicant name", 3.0),
            ("sri/srimathi/kumari", 2.5),
            ("प्रमाणित किया जाता है कि", 2.5),
            ("name", 1.0),
        ],
        _RELATIVE,
    )
    values["applicant_name"], confs["applicant_name"] = best(names)
    return values, confs


# ------------------------------------------------------------------ ST / caste certificate

_COMBINED = re.compile(
    r"\(?\s*sch\w*\s+(?:cast\w*|trib\w*)\s*\)?\s*(?:/|and|&|or)\s*\(?\s*sch\w*\s+(?:cast\w*|trib\w*)\s*\)?|"
    r"\(\s*sch\w*\s+(?:cast\w*|trib\w*)\s*\)|"
    r"sch\w*\s+(?:cast\w*|trib\w*)\s+(?:list|lists|order|orders|\(modification)|"
    r"(?:cast\w*|trib\w*)\s*/\s*(?:cast\w*|trib\w*)",
    re.I,
)


_KEYWORDS = {
    "scheduled": "Scheduled",
    "schedule": "Scheduled",
    "caste": "Caste",
    "castes": "Castes",
    "tribe": "Tribe",
    "tribes": "Tribes",
}
_ABBREVIATED_ORDER = re.compile(
    r"(?:\(?\s*S\.?\s?[CT]\.?\s*\)?\s*(?:&|and|/)?\s*)+orders?\b", re.I
)


def _canonical_keywords(text: str) -> str:
    """OCR-mangled "SCREDULED", "SCHEDUL.ED", "TRILE", "Castc" -> the keyword."""
    text = re.sub(r"(?<=[A-Za-z])\.(?=[A-Za-z]{2})", "", text)

    def fix(m: "re.Match[str]") -> str:
        w = m.group(0)
        low = w.lower()
        if low in _KEYWORDS:
            return w
        for key, canon in _KEYWORDS.items():
            if abs(len(key) - len(low)) <= 1 and fuzz.ratio(low, key) >= (
                78 if len(key) >= 8 else 80
            ):
                return canon
        return w

    return re.sub(r"[A-Za-z]{4,11}", fix, text)


def category(layout: Layout) -> Tuple[Optional[str], float]:
    text = _canonical_keywords(re.sub(r"\s+", " ", layout.flat))
    # Constitution orders are references, never the holder's category.
    text = _ABBREVIATED_ORDER.sub(" ", text)
    stripped = _COMBINED.sub(" ", text)
    st = len(
        re.findall(
            r"sch\w*\s+trib\w*|\bS\.?\s?T\.?\b(?=\s*[)\]]?\s*(?:community|caste|category|$|\)))|अनुसूचित\s+जनजाति|tribe\s+certificate|member\s+of\s+scheduled\s+tribe",
            stripped,
            re.I,
        )
    )
    sc = len(re.findall(r"sch\w*\s+cast\w*|\(\s*SC\s*\)|अनुसूचित\s+जाति", stripped, re.I))
    obc = len(re.findall(r"other\s+backward|\bO\.?B\.?C\b|पिछड़ा|पिछडा", stripped, re.I))
    pvtg = len(re.findall(r"particularly\s+vulnerable|\bPVTG\b", stripped, re.I))
    # The clause that decides: "belongs to ... recognised as a Scheduled X"
    decisive = re.search(
        r"(?:recogni[sz]ed|specified|declared)\s+as\s+(?:a\s+)?sch\w*\s+(cast|trib)",
        stripped,
        re.I,
    )
    counts = {"ST": st, "SC": sc, "OBC": obc, "PVTG": pvtg}
    if decisive:
        counts["ST" if decisive.group(1).lower().startswith("trib") else "SC"] += 2
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    if ranked[0][1] == 0 or ranked[0][1] == ranked[1][1]:
        return None, 0.0
    margin = ranked[0][1] - ranked[1][1]
    return ranked[0][0], round(min(0.95, 0.6 + 0.1 * margin), 2)


def caste(layout: Layout) -> Tuple[Values, Confs]:
    values: Values = {
        "category": None,
        "caste_cert_number": None,
        "issued_date": None,
        "applicant_name": None,
    }
    confs: Confs = {k: 0.0 for k in values}
    values["category"], confs["category"] = category(layout)
    values["issued_date"], confs["issued_date"] = issued_date(layout)
    values["caste_cert_number"], confs["caste_cert_number"] = certificate_number(
        layout,
        [
            ("certificate no", 3.0),
            ("certificate number", 3.0),
            ("case no", 2.5),
            ("regd no", 2.5),
            ("registration no", 2.0),
            ("प्रमाणपत्र क्रमांक", 3.0),
            ("s.no", 1.0),
            ("no.", 1.0),
            ("no :", 1.0),
            ("outward no", 2.0),
        ],
    )
    names = name_from_sentence(layout) + name_from_labels(
        layout, [("name of the candidate", 3.0), ("name", 1.0)], _RELATIVE
    )
    values["applicant_name"], confs["applicant_name"] = best(names)
    return values, confs


# ------------------------------------------------------------------ marksheet

_TOTAL_LABELS = [
    ("grand total", 3.5),
    ("total marks obtained", 3.5),
    ("aggregate", 3.0),
    ("total marks", 3.0),
    ("obtained marks out of total marks", 3.5),
    ("total score", 2.5),
    ("महायोग", 3.0),
    ("कुल प्राप्तांक", 3.0),
    ("एकूण गुण", 3.0),
    ("कुल योग", 2.5),
    ("कुल पूर्णांक", 2.0),
    ("total max. marks", 2.0),
    ("total", 1.5),
    ("कुल", 1.0),
    ("सम्पूर्ण योग", 3.0),
]
_PERCENT_LABELS = [
    ("percentage", 3.5),
    ("टक्केवारी", 3.5),
    ("प्रतिशत", 3.0),
    ("percent", 3.0),
]


_LEADING_LOOKALIKE = str.maketrans(
    {"S": "5", "O": "0", "B": "8", "Z": "2", "T": "7", "l": "1", "I": "1"}
)


def _numbers(text: str) -> List[float]:
    t = fix_number_tokens(clean(text))
    t = re.sub(
        r"(?<![A-Za-z])[SOBZTlI](?=[0-9OoQD]{2,3}(?![A-Za-z0-9]))",
        lambda m: m.group(0).translate(_LEADING_LOOKALIKE),
        t,
    )
    t = re.sub(r"(?<=\d)[OoQD]|[OoQD](?=\d)", "0", t)
    t = re.sub(r"\b(?:19|20)\d{2}\s*[-–]\s*\d{2,4}\b", " ", t)
    return [float(x) for x in re.findall(r"(?<![\d.])\d{1,4}(?:\.\d{1,2})?(?![\d])", t)]


def _total_pair(nums: List[float]) -> Optional[Tuple[float, float]]:
    """(obtained, maximum) from the numbers on a total row: the maximum is the
    largest round number (multiple of 25, 200-1500); the obtained marks are the
    LAST other number not above it (rows read "max [pass] obtained"; when the
    obtained comes first, "0490 0650", the last is the maximum and the other
    one is taken)."""
    ints = [n for n in nums if n.is_integer() and 0 < n <= 1500]
    maxima = [n for n in ints if 200 <= n and n % 25 == 0]
    if not maxima:
        return None
    mx = max(maxima)
    others = [n for n in ints if n != mx and mx * 0.2 <= n <= mx]
    if not others:
        return None
    return others[-1], mx


def marksheet(layout: Layout) -> Tuple[Values, Confs]:
    values: Values = {
        "roll_number": None,
        "candidate_name": None,
        "percentage": None,
        "marks_obtained": None,
        "total_marks": None,
        "passing_year": None,
    }
    confs: Confs = {k: 0.0 for k in values}

    # Explicit "obtained / maximum" anywhere ("569/750", "333/500", "293 (Out of 500)")
    pairs: List[Tuple[float, Tuple[float, float], float]] = []
    maxima_near: set = set()
    for ri, row in enumerate(layout.rows):
        t = clean(row.text)
        for m in re.finditer(r"(?<![\d/])(\d{3,4})\s*/\s*(\d{3,4})(?![\d/])", t):
            o, mx = float(m.group(1)), float(m.group(2))
            if 200 <= mx <= 1500 and mx % 25 == 0 and mx * 0.2 <= o <= mx:
                pairs.append((4.0, (o, mx), row.conf))
        m = re.search(r"out\s+of\s+(\d{3,4})", t, re.I)
        if m:
            mx = float(m.group(1))
            nums = [
                n
                for n in _numbers(t[m.end() :])
                + sum(
                    (_numbers(s.text) for s in layout.rows[ri + 1].segs)
                    if ri + 1 < len(layout.rows)
                    else [],
                    [],
                )
                if n.is_integer() and 0 < n <= mx and n != mx
            ]
            if nums:
                pairs.append((3.5, (nums[0], mx), row.conf))

    for hit in find_labels(layout, _TOTAL_LABELS, threshold=80):
        row = layout.rows[hit.row]
        if re.search(r"in\s+words|शब्द|अक्षरी", hit.seg.text, re.I):
            continue
        if hit.score < 90 and len(hit.seg.text) > 40:
            continue  # a fuzzy label hit inside a long sentence
        # Every number on the label's row (totals sit on either side of the label),
        # else the row below (a header row with the values underneath).
        nums = [
            n for sg in row.segs if sg is not hit.seg for n in _numbers(sg.text)
        ] + _numbers(hit.seg.text[hit.end :])
        pair = _total_pair(nums)
        if not pair and hit.row + 1 < len(layout.rows):
            pair = _total_pair(nums + _numbers(layout.rows[hit.row + 1].text))
        if not pair and hit.row > 0:
            # A label printed slightly lower than its figures.
            pair = _total_pair(_numbers(layout.rows[hit.row - 1].text) + nums)
        if pair:
            pairs.append((hit.weight, pair, row.conf))
        for k in range(max(0, hit.row - 3), min(len(layout.rows), hit.row + 3)):
            maxima_near.update(
                n
                for n in _numbers(layout.rows[k].text)
                if n.is_integer() and 200 <= n <= 1500 and n % 25 == 0
            )
    # Marks in words ("FOUR HUNDRED FIFTY THREE") confirm the obtained total.
    worded_at = [(v, pos) for v, pos in words_amounts(layout.flat) if 100 <= v <= 1500]
    worded = {v for v, _ in worded_at}
    # Written under an "in words" label, the total outranks a misread figure pair.
    labelled_words = any(
        re.search(
            r"in\s*words|शब्द|अक्षरी|total.{0,25}$",
            layout.flat[max(0, pos - 45) : pos],
            re.I,
        )
        for _, pos in worded_at
    )
    if worded:
        pairs = [(w + (2.0 if p[0] in worded else 0.0), p, c) for w, p, c in pairs]
        if not any(p[0] in worded for _, p, _ in pairs):
            # The worded total with the nearest maximum printed around the total label.
            maxima = sorted({p[1] for _, p, _ in pairs} | maxima_near)
            for v in worded:
                fitting = [mx for mx in maxima if v < mx]
                if fitting:
                    pairs.append(
                        (4.0 if labelled_words else 2.5, (float(v), fitting[0]), 0.8)
                    )

    pct_cands: List[Tuple[float, object, float]] = []
    for hit in find_labels(layout, _PERCENT_LABELS, threshold=90):
        if re.search(
            r"percentile|percentage\s+marks|distinction|\d+\s*%\s*marks",
            layout.rows[hit.row].text,
            re.I,
        ):
            continue
        texts = [right_of(layout, hit, 3)] + [
            s.text for _, s in layout.below(hit.row, hit.seg, 2)
        ]
        for k, t in enumerate(texts):
            m = re.search(
                r"(?<![\d.])(\d{2}\.\d{1,2}|100(?:\.0{1,2})?)\s*%?(?![\d])", clean(t)
            )
            if m and 10 <= float(m.group(1)) <= 100:
                pct_cands.append(
                    (
                        hit.weight - 0.3 * k,
                        float(m.group(1)),
                        _conf(hit.weight, hit.seg.conf),
                    )
                )
                break

    if not pairs:
        # Last resort: a row that is nothing but "obtained maximum" (its label unreadable).
        for row in layout.rows:
            letters = re.sub(r"[^A-Za-zऀ-ॿ]", "", row.text)
            nums = [n for n in _numbers(row.text) if n.is_integer()]
            if len(letters) <= 14 and len(nums) == 2:
                pair = _total_pair(nums)
                if pair and pair[1] % 50 == 0 and pair[1] >= 300:
                    pairs.append((1.0, pair, row.conf))
    pair_value = max(pairs, key=lambda p: (p[0], p[1][1])) if pairs else None
    if pair_value:
        (o, mx) = pair_value[1]
        values["marks_obtained"], values["total_marks"] = int(o), int(mx)
        c = _conf(pair_value[0], pair_value[2])
        confs["marks_obtained"] = confs["total_marks"] = c
    pct, pct_conf = best(pct_cands)
    if pct is not None and pair_value:
        computed = 100.0 * values["marks_obtained"] / values["total_marks"]
        if abs(computed - float(pct)) > 1.0:
            # A printed percentage that disagrees with the printed total is more
            # likely a misread: the total (two numbers that agree) wins.
            pct, pct_conf = round(computed, 2), min(confs["marks_obtained"], 0.75)
    if pct is None and pair_value:
        pct = round(100.0 * values["marks_obtained"] / values["total_marks"], 2)
        pct_conf = confs["marks_obtained"]
    values["percentage"], confs["percentage"] = pct, pct_conf

    names = name_from_labels(
        layout,
        [
            ("candidate's full name", 3.5),
            ("candidates full name", 3.5),
            ("name of the candidate", 3.5),
            ("candidate's name", 3.5),
            ("candidate name", 3.5),
            ("certified that", 3.0),
            ("this is to certify that", 3.0),
            ("certify that", 3.0),
            ("marks obtained by", 3.0),
            ("name", 2.0),
            ("नाम", 2.0),
            ("उमेदवाराचे संपूर्ण नाव", 3.0),
        ],
        _RELATIVE + r"|विद्यालय|board",
    )
    names += [(c[0] - 0.5, c[1], c[2]) for c in name_from_sentence(layout)]
    values["candidate_name"], confs["candidate_name"] = best(names)

    values["roll_number"], confs["roll_number"] = certificate_number(
        layout,
        [
            ("roll no", 3.0),
            ("roll number", 3.0),
            ("seat no", 3.0),
            ("seat number", 3.0),
            ("रोल नंबर", 3.0),
            ("अनुक्रमांक", 2.5),
            ("आसन क्रमांक", 3.0),
            ("roll", 2.0),
        ],
    )

    years: List[Tuple[float, object, float]] = []
    for row in layout.rows:
        if re.search(r"birth|जन्म|dob", row.text, re.I):
            continue
        if re.search(
            r"exam|परीक्षा|march|february|april|may|june|session|year|hslc|ssc|hsc|\b20\d\d\b",
            row.text,
            re.I,
        ):
            for y in re.findall(
                r"(?<!\d)((?:19|20)\d{2})(?!\d)", ascii_digits(row.text)
            ):
                y = int(y)
                if 1980 <= y <= date.today().year:
                    weight = (
                        2.0
                        if re.search(
                            r"exam|परीक्षा|march|february|hslc|ssc|hsc", row.text, re.I
                        )
                        else 1.0
                    )
                    years.append((weight, y, 0.8))
    values["passing_year"], confs["passing_year"] = best(years)
    return values, confs


# ------------------------------------------------------------------ bonafide

_INSTITUTION_WORDS = re.compile(
    r"universit|institut|college|polytechnic|vidyalaya|vidyapeeth|vidyapith|academy|school\s+of\s+|iit\b|nit\b|iiit",
    re.I,
)
_NOT_INSTITUTION = re.compile(
    r"^(?:this|the|our|of)\b|this\s+institut|of\s+the\s+institut|b\.?\s?tech|b\.?\s?e\b|m\.?\s?tech|computer\s+science|"
    r"engineering\s+of|semester|year\b|department of|dept\.?\s+of|faculty of|^school of|board of|council|approved by|affiliated|accredited|"
    r"recogni[sz]ed|website|e-?mail|phone|estd|established|act\s+\d|managed by|ph\.?:|"
    r"national\s+importance|act\s+of\s+parliament|^\[|deemed\s+to\s+be|seat\s+no|bearing|"
    r"roll\s+no|enrol",
    re.I,
)


def institution(layout: Layout) -> Tuple[Optional[str], float]:
    cands: List[Tuple[float, object, float]] = []
    pattern = re.compile(
        r"(?:bonafide\s+student\s+of|student\s+of|studying\s+in|admitted\s+in|under)\s+(?:the\s+)?"
        r"([A-Z][A-Za-z.&' ]{3,80}?(?:Universit\w*|Institut\w*|College|Polytechnic|Vidyalaya|Academy)"
        r"(?:\s+of\s+[A-Z][A-Za-z&' ]{2,40}?)?)"
        r"(?=[\s,;(.]|$)",
        re.I,
    )
    for m in pattern.finditer(layout.flat):
        name = re.sub(r"\s+", " ", m.group(1)).strip(" .,")
        if not _NOT_INSTITUTION.search(name) and len(name) >= 6:
            cands.append((3.0, name, 0.85))
    top = layout.height * 0.35
    heights = sorted((s.height for r in layout.rows for s in r.segs), reverse=True)
    tall = heights[min(len(heights) - 1, 3)] if heights else 1
    for ri, row in enumerate(layout.rows):
        if row.y0 > top and ri > 6:
            continue
        for si, seg in enumerate(row.segs):
            text = seg.text.strip(" .,:;")
            if (
                not _INSTITUTION_WORDS.search(text)
                or _NOT_INSTITUTION.search(text)
                or len(text) < 6
            ):
                continue
            if re.search(r"certif|bonafide|whomsoever|concern", text, re.I):
                continue
            score = (
                1.5 + min(1.5, seg.height / max(1, tall)) + (0.5 if ri <= 3 else 0.0)
            )
            name = re.sub(r"\s+", " ", text)
            # A logo word on the row above ("RAMAIAH" over "Institute of Technology")
            if re.match(r"(?i)(institute|university|college)\b", name) and ri > 0:
                above = layout.rows[ri - 1].text.strip()
                if 2 <= len(above) <= 30 and not _NOT_INSTITUTION.search(above):
                    name = above + " " + name
            cands.append((score, name, round(min(0.9, 0.6 + 0.3 * seg.conf), 2)))
    return best(cands)


def bonafide(layout: Layout) -> Tuple[Values, Confs]:
    values: Values = {
        "student_name": None,
        "institution_name": None,
        "academic_year": None,
        "issued_date": None,
    }
    confs: Confs = {k: 0.0 for k in values}
    names = name_from_sentence(layout) + name_from_labels(
        layout, [("name of the student", 3.0), ("student name", 3.0)], _RELATIVE
    )
    values["student_name"], confs["student_name"] = best(names)
    values["institution_name"], confs["institution_name"] = institution(layout)

    years: List[Tuple[float, object, float]] = []
    t = ascii_digits(layout.flat)
    for m in re.finditer(
        r"(?:academic\s+(?:year|session)|session|during|for\s+the\s+year)[^0-9]{0,25}((?:19|20)\d{2})\s*[-–/]?\s*((?:19|20)?\d{2})",
        t,
        re.I,
    ):
        start = int(m.group(1))
        end = m.group(2)
        end_full = int(end) if len(end) == 4 else (start // 100) * 100 + int(end)
        if end_full in (start + 1, start + 2, start + 3):
            years.append((3.0, f"{start}-{end_full}", 0.85))
    if not years:
        for m in re.finditer(r"\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)?\d{2})\b", t):
            start, end = int(m.group(1)), m.group(2)
            end_full = int(end) if len(end) == 4 else (start // 100) * 100 + int(end)
            if end_full == start + 1:
                years.append((1.5, f"{start}-{end_full}", 0.6))
    values["academic_year"], confs["academic_year"] = best(years)
    values["issued_date"], confs["issued_date"] = issued_date(layout)
    return values, confs


EXTRACTORS: Dict[str, Callable[[Layout], Tuple[Values, Confs]]] = {
    "INCOME_CERTIFICATE": income,
    "CASTE_CERTIFICATE": caste,
    "MARKSHEET": marksheet,
    "BONAFIDE": bonafide,
}
