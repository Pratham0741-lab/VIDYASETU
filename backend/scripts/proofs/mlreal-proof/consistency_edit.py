from pathlib import Path

p = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/ml/app/services/consistency_service.py')
s = p.read_text(encoding='utf8')

VERDICT = '''
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


def check_consistency('''

old_head = '\ndef check_consistency('
assert s.count(old_head) == 1
s = s.replace(old_head, VERDICT, 1)

start = s.index('    values: Dict[str, Any] = {}')
end = s.index('    # If neither names nor DOBs could be compared')
NEW_BODY = '''    values: Dict[str, Any] = {}
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

'''
s = s[:start] + NEW_BODY + s[end:]
p.write_text(s, encoding='utf8', newline='\n')
print('edited', p)
