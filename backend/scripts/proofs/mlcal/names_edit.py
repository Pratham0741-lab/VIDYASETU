import re
from pathlib import Path

p = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/ml/app/services/extract_service.py')
s = p.read_text(encoding='utf8')

# ---- 1. the shared name reader: stop at the line end / the next field label of this type
start = s.index('def extract_person_name_with_quality(')
end = s.index('class FieldExtractor:')
NEW_FN = r'''def _label(pattern: str) -> str:
    """A field label at the start of a line, optionally followed by ':' or '-'
    (label:value lines and two-column tables, where OCR puts the value after
    the label on the same line)."""
    return rf"^[ \t]*(?:{pattern})[ \t]*[:\-]?[ \t]*"


# Labels that follow a name on each document type (same line in some layouts,
# e.g. "Name: X   Age: 19"). A name ends where the next field label begins.
_COMMON_NEXT = [
    r"father'?s?(?:\s*/\s*husband'?s?)?\s+name", r"father\s*/\s*husband", r"mother'?s?\s+name",
    r"husband'?s?\s+name", r"guardian", r"s/o", r"d/o", r"w/o", r"address", r"date", r"signature",
]
NEXT_FIELD_LABELS: Dict[str, List[str]] = {
    "INCOME_CERTIFICATE": _COMMON_NEXT + [r"annual", r"income", r"occupation", r"relation", r"certificate", r"village"],
    "CASTE_CERTIFICATE": _COMMON_NEXT + [r"caste", r"tribe", r"category", r"community", r"village", r"district",
                                         r"certificate", r"cert\."],
    "MARKSHEET": _COMMON_NEXT + [r"roll", r"registration", r"reg\.", r"enrol?lment", r"seat", r"school", r"college",
                                 r"programme", r"course", r"examination", r"centre"],
    "FEE_RECEIPT": _COMMON_NEXT + [r"course", r"class", r"branch", r"semester", r"programme", r"receipt", r"roll",
                                   r"amount", r"tuition", r"fee"],
    "BANK_PASSBOOK": _COMMON_NEXT + [r"account", r"a/c", r"ifsc", r"cif", r"branch", r"nominee", r"micr",
                                     r"customer", r"mobile"],
    "BONAFIDE": _COMMON_NEXT + [r"course", r"class", r"year", r"academic", r"session", r"roll", r"programme",
                                r"department"],
    "DISABILITY_CERT": _COMMON_NEXT + [r"age", r"sex", r"gender", r"type", r"percentage", r"disability",
                                       r"certificate", r"registration"],
    "OFFER_LETTER": _COMMON_NEXT + [r"designation", r"position", r"ctc", r"salary", r"joining", r"employee"],
}


def extract_person_name_with_quality(
    text: str, prefix_patterns: List[str], stop_labels: Optional[List[str]] = None
) -> Optional[Tuple[str, float]]:
    """
    Extracts person name and assesses evidence quality.
    Returns (name_str, quality_factor) where quality_factor is:
    - 0.93 for complete, multi-token capitalized name
    - 0.55 for degraded / single-token name

    The name is read from after a prefix to the end of that line (OCR keeps the
    page's lines), cut at the first next-field label of the document type
    (stop_labels) or a clause delimiter - never across into another field.
    """
    stop = re.compile(r"\b(?:" + "|".join(stop_labels) + r")\b", re.IGNORECASE) if stop_labels else None
    for pat in prefix_patterns:
        for match in re.finditer(pat, text, re.IGNORECASE | re.MULTILINE):
            start_pos = match.end()
            line_end = text.find("\n", start_pos)
            line = text[start_pos:] if line_end == -1 else text[start_pos:line_end]
            # Take the clause up to a delimiter, then up to the next field label
            clause = re.split(r"[,;\(\)]", line)[0]
            if stop:
                cut = stop.search(clause)
                if cut:
                    clause = clause[:cut.start()]
            raw_tokens = clause.split()
            name_tokens = []
            for token in raw_tokens:
                cleaned_token = re.sub(r"[^\w]", "", token)
                if not cleaned_token:
                    continue
                lower_token = cleaned_token.lower()
                # Skip leading titles if name hasn't started yet
                if not name_tokens and lower_token in TITLES:
                    continue
                # If stop word or digits reached, end name extraction
                if lower_token in STOP_NAME_WORDS or cleaned_token.isdigit():
                    break
                # Valid name token: alphabetic and capitalized
                if cleaned_token.isalpha():
                    name_tokens.append(cleaned_token.capitalize())
                else:
                    break

            if len(name_tokens) >= 2:
                return " ".join(name_tokens), 0.93
            elif len(name_tokens) == 1 and len(name_tokens[0]) > 2:
                return name_tokens[0], 0.55
    return None


'''
s = s[:start] + NEW_FN + s[end:]

# ---- 2. per-type prefixes (label-at-line-start for labelled layouts; prose phrases as before)
CALLS = [  # (type, old prefix list body, new prefix list body) in file order
    ("INCOME_CERTIFICATE",
     '''                r"sources\\s+of\\s+",
                r"certify\\s+that\\s+",
                r"in\\s+respect\\s+of\\s+",
                r"applicant\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                r"certify\\s+that\\s+",
                r"in\\s+respect\\s+of\\s+",
                _label(r"(?:applicant'?s?\\s+)?name(?:\\s+of\\s+(?:the\\s+)?applicant)?"),'''),
    ("CASTE_CERTIFICATE",
     '''                r"certify\\s+that\\s+",
                r"applicant\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                r"certify\\s+that\\s+",
                _label(r"(?:applicant'?s?\\s+)?name(?:\\s+of\\s+(?:the\\s+)?applicant)?"),'''),
    ("MARKSHEET",
     '''                r"candidate\\s+name\\s*[:\\-]\\s*",
                r"student\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                _label(r"(?:candidate'?s?|student'?s?)\\s+name|name\\s+of\\s+(?:the\\s+)?(?:candidate|student)|name"),'''),
    ("FEE_RECEIPT",
     '''                r"student\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                _label(r"student'?s?\\s+name|name\\s+of\\s+(?:the\\s+)?student|name"),
                r"received\\s+(?:with\\s+thanks\\s+)?from\\s+",'''),
    ("BANK_PASSBOOK",
     '''                r"account\\s*holder(?:\\s+name)?\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                _label(r"account\\s*holder(?:'?s?\\s+name)?|customer\\s+name|name"),'''),
    ("BONAFIDE",
     '''                r"certify\\s+that\\s+",
                r"student\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                r"certify\\s+that\\s+",
                _label(r"student'?s?\\s+name|name\\s+of\\s+(?:the\\s+)?student|name"),'''),
    ("DISABILITY_CERT",
     '''                r"certify\\s+that\\s+",
                r"applicant\\s+name\\s*[:\\-]\\s*",
                r"name\\s*[:\\-]\\s*",''',
     '''                r"certify\\s+that\\s+",
                _label(r"(?:applicant'?s?\\s+)?name(?:\\s+of\\s+(?:the\\s+)?applicant)?"),'''),
    ("OFFER_LETTER",
     '''                r"dear\\s+",
                r"candidate\\s*name\\s*[:\\-]\\s*",
                r"offer\\s+to\\s+",''',
     '''                r"dear\\s+",
                _label(r"candidate'?s?\\s*name|name"),
                r"offer\\s+to\\s+",'''),
]
pos = 0
for doc_type, old, new in CALLS:
    i = s.index(old, pos)
    close = s.index("            ],\n        )", i)
    assert close - i - len(old) < 10, (doc_type, s[i:close + 30])
    repl = new + "\n            ],\n            NEXT_FIELD_LABELS[\"" + doc_type + "\"],\n        )"
    s = s[:i] + repl + s[close + len("            ],\n        )"):]
    pos = i + len(repl)
assert s.count('NEXT_FIELD_LABELS["') == 8
p.write_text(s, encoding='utf8', newline='\n')
print('edited', p)
