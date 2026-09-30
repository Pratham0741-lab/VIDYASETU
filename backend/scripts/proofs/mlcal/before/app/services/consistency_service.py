import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import jellyfish
from rapidfuzz import fuzz

from app.config import settings


TITLES = {
    "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "shri", "shree", "smt", "smt.", "dr", "dr.", "prof", "prof."
}


def normalize_name(raw_name: str) -> str:
    """Normalizes a name string by trimming, lowercasing, and stripping honorific titles."""
    if not raw_name:
        return ""
    cleaned = raw_name.strip().lower()
    # Strip common leading Indian honorifics
    tokens = cleaned.split()
    while tokens and tokens[0].rstrip(".") in TITLES:
        tokens.pop(0)
    return " ".join(tokens)


def indian_phonetic_normalize(text: str) -> str:
    """
    Normalizes frequent Indian transliteration and phonetic variants:
    e.g. v <-> b, sh <-> s, ksh <-> x, ee <-> i, oo <-> u, laxmi <-> lakshmi.
    """
    s = text.lower()
    s = s.replace("ksh", "x").replace("x", "k")
    s = s.replace("sh", "s")
    s = s.replace("ee", "i").replace("oo", "u")
    s = s.replace("b", "v")
    s = s.replace("th", "t").replace("dh", "d")
    s = s.replace("ph", "f").replace("ch", "c")
    return s


def compare_name_pair(n1: str, n2: str) -> Tuple[float, str]:
    """
    Compares two Indian names using phonetic algorithms (Metaphone, Soundex),
    token set/sort metrics, initial expansions, and edit distance.

    Returns:
        (confidence_score, match_type)
    """
    s1 = normalize_name(n1)
    s2 = normalize_name(n2)
    if not s1 or not s2:
        return 0.0, "EMPTY_INPUT"

    # 1. Exact string match
    if s1 == s2:
        return 1.0, "EXACT_MATCH"

    # 2. Spacing / Punctuation variant (e.g. "Ram Kumar" vs "Ramkumar")
    s1_compact = re.sub(r"[^a-z0-9]", "", s1)
    s2_compact = re.sub(r"[^a-z0-9]", "", s2)
    if s1_compact == s2_compact:
        return 0.95, "SPACING_VARIANT"

    t1 = [t.strip(".") for t in s1.split() if t.strip(".")]
    t2 = [t.strip(".") for t in s2.split() if t.strip(".")]

    # 3. Initial expansion (e.g. "Ram Kumar" vs "R. Kumar" or "Aditya Vikram Birla" vs "A. Vikram Birla")
    if len(t1) == len(t2) and len(t1) >= 2:
        initial_match = True
        matched_full_tokens = 0
        full_chars = 0
        for tok1, tok2 in zip(t1, t2):
            if tok1 == tok2:
                matched_full_tokens += 1
                full_chars += len(tok1)
            elif (len(tok1) == 1 and tok2.startswith(tok1)) or (len(tok2) == 1 and tok1.startswith(tok2)):
                pass
            else:
                initial_match = False
                break
        if initial_match and matched_full_tokens >= 1:
            total_chars = max(sum(len(t) for t in t1), sum(len(t) for t in t2))
            char_ratio = full_chars / total_chars if total_chars > 0 else 0.5
            jw = jellyfish.jaro_winkler_similarity(s1, s2)
            # NOTE: The coefficients 0.55/0.32/0.10 were calibrated to reproduce the handover's illustrative 0.83 benchmark for the initial-expansion case, not independently derived — so a future reader doesn't mistake them for empirically fitted weights.
            score = round(0.55 + 0.32 * char_ratio + 0.10 * jw, 2)
            return score, "INITIAL_EXPANSION"

    # Initial expansion with compound name (e.g. "Ramkumar" vs "R. Kumar")
    if (len(t1) == 1 and len(t2) >= 2 and len(t2[0]) == 1 and s1_compact.startswith(t2[0]) and s1_compact.endswith(t2[-1])) or \
       (len(t2) == 1 and len(t1) >= 2 and len(t1[0]) == 1 and s2_compact.startswith(t1[0]) and s2_compact.endswith(t1[-1])):
        total_chars = max(len(s1_compact), len(s2_compact))
        full_chars = len(t2[-1]) if len(t1) == 1 else len(t1[-1])
        char_ratio = full_chars / total_chars if total_chars > 0 else 0.5
        jw = jellyfish.jaro_winkler_similarity(s1, s2)
        # NOTE: The coefficients 0.55/0.32/0.10 were calibrated to reproduce the handover's illustrative 0.83 benchmark for the initial-expansion case, not independently derived — so a future reader doesn't mistake them for empirically fitted weights.
        score = round(0.55 + 0.32 * char_ratio + 0.10 * jw, 2)
        return score, "INITIAL_EXPANSION"

    # 4. Middle name addition / token subset (e.g. "Amit Kumar Shinde" vs "Amit Shinde")
    set1, set2 = set(t1), set(t2)
    if (set1.issubset(set2) or set2.issubset(set1)) and len(t1) >= 2 and len(t2) >= 2:
        # Check first and last names agree
        if t1[0] == t2[0] and t1[-1] == t2[-1]:
            return 0.88, "NAME_SUBSET"
        return 0.80, "PARTIAL_SUBSET"

    # 5. Indian phonetic normalization (e.g. "Laxmi Devi" vs "Lakshmi Devi", "Vikas" vs "Bikash")
    ph1 = indian_phonetic_normalize(s1_compact)
    ph2 = indian_phonetic_normalize(s2_compact)
    if ph1 == ph2:
        return 0.92, "INDIAN_PHONETIC_EQUIVALENT"

    # 6. Standard Phonetic match via Metaphone / Soundex
    m1 = jellyfish.metaphone(s1_compact)
    m2 = jellyfish.metaphone(s2_compact)
    snd1 = jellyfish.soundex(s1_compact)
    snd2 = jellyfish.soundex(s2_compact)
    jw = jellyfish.jaro_winkler_similarity(s1, s2)
    ts = fuzz.token_sort_ratio(s1, s2) / 100.0

    if (m1 and m1 == m2) or (snd1 and snd1 == snd2):
        score = round(max(0.85, 0.70 + 0.25 * jw), 2)
        return score, "PHONETIC_MATCH"

    # 7. Fuzzy edit distance / token metrics for minor typos (e.g. OCR character swaps)
    score = 0.5 * jw + 0.5 * ts

    # If first names completely mismatch and neither is an initial, heavily penalize
    if t1 and t2 and t1[0] != t2[0] and not (len(t1[0]) == 1 or len(t2[0]) == 1):
        first_jw = jellyfish.jaro_winkler_similarity(t1[0], t2[0])
        if first_jw < 0.75:
            # Different given names (e.g. "Rahul Singh" vs "Rohit Sharma", "Amit Kumar" vs "Sunil Kumar")
            score = min(score, 0.35 * first_jw + 0.15)

    final_score = round(min(1.0, max(0.0, score)), 2)
    match_type = "FUZZY_MATCH" if final_score >= settings.name_similarity_threshold else "DIFFERENT_NAME"
    return final_score, match_type


def normalize_dob(date_str: str) -> Optional[str]:
    """Normalizes birth date string to standard YYYY-MM-DD format."""
    if not date_str:
        return None
    cleaned = date_str.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def compare_dob_pair(d1: str, d2: str) -> Tuple[float, str]:
    """
    Compares two date-of-birth values.
    Returns (confidence_score, match_type).
    """
    norm1 = normalize_dob(d1)
    norm2 = normalize_dob(d2)

    if not norm1 or not norm2:
        return 0.0, "INVALID_DOB_FORMAT"

    # Exact calendar match
    if norm1 == norm2:
        return 1.0, "EXACT_DOB_MATCH"

    # Check for off-by-one OCR digit error or year mismatch
    try:
        dt1 = datetime.strptime(norm1, "%Y-%m-%d")
        dt2 = datetime.strptime(norm2, "%Y-%m-%d")

        # Same day and month, year within 1 (common OCR transposition or age error)
        if dt1.month == dt2.month and dt1.day == dt2.day and abs(dt1.year - dt2.year) <= 1:
            return 0.65, "NEAR_YEAR_DOB_MATCH"

        # Levenshtein distance on date strings (e.g. 1 digit difference like 14 vs 11)
        lev = jellyfish.levenshtein_distance(norm1, norm2)
        if lev == 1:
            return 0.60, "SINGLE_DIGIT_OCR_DOB_VARIANT"
    except Exception:
        pass

    return 0.0, "DOB_MISMATCH"


def extract_field_from_dict(doc: Dict[str, Any], candidate_keys: List[str]) -> Optional[str]:
    """Extracts field value from either top-level or nested 'fields' dictionary."""
    for key in candidate_keys:
        if key in doc and doc[key] is not None:
            return str(doc[key]).strip()
    # Check nested 'fields'
    if "fields" in doc and isinstance(doc["fields"], dict):
        for key in candidate_keys:
            if key in doc["fields"] and doc["fields"][key] is not None:
                return str(doc["fields"][key]).strip()
    return None


# ---------------------------------------------------------------------------
# Verdict certainty.
#
# `confidence` in the /consistency response is the certainty that the boolean
# verdict is correct - the same meaning as on every other endpoint (see
# docs/ML_OCR_track_handover.md, "What confidence means"). The raw similarity
# from compare_name_pair / compare_dob_pair is reported separately, as
# details.similarity. A clear match and a clear mismatch are both
# high-certainty; only genuinely ambiguous evidence is low, which the api
# treats as UNCERTAIN (officer review), never as a pass or a fail.
#
# The verdict is token-aware (given name vs surname). Whole-string phonetic
# codes collide whenever two names share a given name (Soundex encodes only
# the first letters), which made "Sunita Munda" / "Sunita Hansda" a match.
# ---------------------------------------------------------------------------
CERTAIN_MATCH = 0.99          # identical after normalisation
SPACING_MATCH = 0.95          # "Ram Kumar" / "Ramkumar"
TRANSLITERATION_MATCH = 0.92  # documented Indian transliteration equivalents (Laxmi / Lakshmi)
TOKEN_ORDER_MATCH = 0.90      # same tokens, different order (surname-first forms)
MIDDLE_NAME_MATCH = 0.90      # given name and surname agree; a middle name added or dropped
BOTH_DIFFER_MISMATCH = 0.97   # given name and surname both clearly different
ONE_DIFFERS_MISMATCH = 0.90   # given name or surname clearly different (Munda / Hansda)
DOB_MISMATCH_CERTAINTY = 0.95 # two readable, clearly different dates
TRAILING_EXTRA_MATCH = 0.75   # one name is the other plus trailing words
INITIAL_MATCH = 0.72          # one initial stands in for a spelled-out token
SPELLING_VARIANT = 0.65       # one-letter / transposition variant: an OCR slip or another person
INITIALS_MATCH = 0.62         # two or more initials
AMBIGUOUS = 0.60              # e.g. same leading names with differently-extended tails
UNREADABLE = 0.50             # a value that cannot be parsed: no evidence either way


def _tokens(name: str) -> List[str]:
    return [t.strip(".") for t in normalize_name(name).split() if t.strip(".")]


def _token_relation(a: str, b: str) -> str:
    """same | initial | variant | different, for two name tokens."""
    if a == b or indian_phonetic_normalize(a) == indian_phonetic_normalize(b):
        return "same"
    if (len(a) == 1 and b.startswith(a)) or (len(b) == 1 and a.startswith(b)):
        return "initial"
    if min(len(a), len(b)) >= 4 and jellyfish.damerau_levenshtein_distance(a, b) <= 1:
        return "variant"
    return "different"


def judge_name_pair(n1: str, n2: str) -> Tuple[bool, float, str]:
    """(verdict: same person?, certainty of that verdict, basis)."""
    t1, t2 = _tokens(n1), _tokens(n2)
    if not t1 or not t2:
        return False, UNREADABLE, "EMPTY_INPUT"
    if t1 == t2:
        return True, CERTAIN_MATCH, "EXACT_MATCH"
    c1, c2 = "".join(t1), "".join(t2)
    if c1 == c2:
        return True, SPACING_MATCH, "SPACING_VARIANT"
    if indian_phonetic_normalize(c1) == indian_phonetic_normalize(c2):
        return True, TRANSLITERATION_MATCH, "INDIAN_PHONETIC_EQUIVALENT"
    if sorted(t1) == sorted(t2):
        return True, TOKEN_ORDER_MATCH, "TOKEN_ORDER_VARIANT"

    # A one-token name has no given-name / surname split to align.
    if len(t1) == 1 or len(t2) == 1:
        single, other = (t1[0], t2) if len(t1) == 1 else (t2[0], t1)
        rels = [_token_relation(single, tok) for tok in other]
        if all(r == "different" for r in rels):
            return False, ONE_DIFFERS_MISMATCH, "DIFFERENT_NAME"
        if len(other) == 1 and rels[0] == "variant":
            return True, SPELLING_VARIANT, "SPELLING_VARIANT"
        return True, AMBIGUOUS, "PARTIAL_NAME"

    # Same leading names (at least given name + one more), then extra words.
    common = 0
    for a, b in zip(t1, t2):
        if _token_relation(a, b) != "same":
            break
        common += 1
    if common >= 2:
        if common == min(len(t1), len(t2)):
            return True, TRAILING_EXTRA_MATCH, "TRAILING_EXTRA_TOKENS"
        # "Ram Kumar Singh" / "Ram Kumar Verma" and an OCR overrun look alike.
        return True, AMBIGUOUS, "DIFFERENT_TRAILING_TOKENS"

    given = _token_relation(t1[0], t2[0])
    surname = _token_relation(t1[-1], t2[-1])
    if given == "different" and surname == "different":
        return False, BOTH_DIFFER_MISMATCH, "DIFFERENT_NAME"
    if given == "different":
        return False, ONE_DIFFERS_MISMATCH, "DIFFERENT_GIVEN_NAME"
    if surname == "different":
        return False, ONE_DIFFERS_MISMATCH, "DIFFERENT_SURNAME"

    rels = [given, surname]
    m1, m2 = t1[1:-1], t2[1:-1]
    middle_dropped = False
    if m1 and m2:
        if len(m1) != len(m2):
            return True, AMBIGUOUS, "DIFFERENT_MIDDLE_NAMES"
        middle = [_token_relation(a, b) for a, b in zip(m1, m2)]
        if "different" in middle:
            return True, AMBIGUOUS, "DIFFERENT_MIDDLE_NAMES"
        rels += middle
    elif m1 or m2:
        middle_dropped = True

    if "variant" in rels:
        return True, SPELLING_VARIANT, "SPELLING_VARIANT"
    initials = rels.count("initial")
    if initials:
        return True, (INITIAL_MATCH if initials == 1 else INITIALS_MATCH), "INITIAL_EXPANSION"
    if middle_dropped:
        return True, MIDDLE_NAME_MATCH, "MIDDLE_NAME_OMITTED"
    return True, TRANSLITERATION_MATCH, "TOKEN_TRANSLITERATION"


def judge_dob_pair(d1: str, d2: str) -> Tuple[bool, float, str]:
    """(verdict: same date?, certainty of that verdict, basis)."""
    _, basis = compare_dob_pair(d1, d2)
    if basis == "EXACT_DOB_MATCH":
        return True, CERTAIN_MATCH, basis
    if basis == "DOB_MISMATCH":
        return False, DOB_MISMATCH_CERTAINTY, basis
    if basis == "INVALID_DOB_FORMAT":
        return False, UNREADABLE, basis
    # Near-year or one-digit difference: an OCR slip or a genuinely different date.
    return False, AMBIGUOUS, basis


def _aggregate(pairs: List[Tuple[bool, float]]) -> Tuple[bool, float]:
    """All pairs must match. A mismatch is as certain as its strongest evidence;
    a match only as certain as its weakest pair."""
    mismatches = [c for v, c in pairs if not v]
    if mismatches:
        return False, max(mismatches)
    return True, min(c for _, c in pairs)


def check_consistency(documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Cross-checks extracted field sets across multiple documents of the same applicant.

    Args:
        documents: List of document dicts with extracted fields (names, DOBs).

    Returns:
        Standard consistency response dict with value, confidence, and details.
    """
    # Fewer than two documents, or nothing comparable, is a normal "cannot
    # tell" outcome (no checks, reason stated) - not a client error. The api
    # treats an empty check set as UNCERTAIN.
    if len(documents) < 2:
        return {
            "value": {},
            "confidence": {},
            "details": {"reason": "fewer than two documents to compare", "documents_compared": len(documents)},
        }

    # 1. Collect Names
    name_keys = ["applicant_name", "candidate_name", "student_name", "account_holder_name", "name"]
    names: List[str] = []
    for doc in documents:
        n = extract_field_from_dict(doc, name_keys)
        if n:
            names.append(n)

    # 2. Collect DOBs
    dob_keys = ["dob", "date_of_birth", "birth_date", "dob_date"]
    dobs: List[str] = []
    for doc in documents:
        d = extract_field_from_dict(doc, dob_keys)
        if d:
            dobs.append(d)

    values: Dict[str, Any] = {}
    confidences: Dict[str, float] = {}
    similarity: Dict[str, float] = {}
    details: Dict[str, Any] = {}

    # 3. Pairwise names: verdict + certainty (judge_name_pair), raw similarity
    #    (compare_name_pair) reported alongside, never as the confidence.
    if len(names) >= 2:
        verdicts, sims, notes = [], [], []
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                sim, _ = compare_name_pair(names[i], names[j])
                verdict, certainty, basis = judge_name_pair(names[i], names[j])
                verdicts.append((verdict, certainty))
                sims.append(sim)
                notes.append(f"{names[i]} <-> {names[j]}: {basis} (match={verdict}, certainty={certainty}, similarity={sim})")
        verdict, certainty = _aggregate(verdicts)
        values["names_match"] = verdict
        confidences["names_match"] = round(certainty, 2)
        similarity["names_match"] = min(sims)
        details["compared_values"] = names
        details["name_match_types"] = notes

    # 4. Pairwise dates of birth, same scheme.
    if len(dobs) >= 2:
        verdicts, sims, notes = [], [], []
        for i in range(len(dobs)):
            for j in range(i + 1, len(dobs)):
                sim, _ = compare_dob_pair(dobs[i], dobs[j])
                verdict, certainty, basis = judge_dob_pair(dobs[i], dobs[j])
                verdicts.append((verdict, certainty))
                sims.append(sim)
                notes.append(f"{dobs[i]} <-> {dobs[j]}: {basis} (match={verdict}, certainty={certainty}, similarity={sim})")
        verdict, certainty = _aggregate(verdicts)
        values["dob_match"] = verdict
        confidences["dob_match"] = round(certainty, 2)
        similarity["dob_match"] = min(sims)
        details["compared_dobs"] = dobs
        details["dob_match_types"] = notes

    if similarity:
        details["similarity"] = similarity

    # If neither names nor DOBs could be compared
    if "names_match" not in values and "dob_match" not in values:
        details["reason"] = "no comparable applicant fields (names or dates of birth) in two or more documents"

    return {
        "value": values,
        "confidence": confidences,
        "details": details,
    }
