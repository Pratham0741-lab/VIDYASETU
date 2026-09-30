import re
from typing import Any, Dict, List, Tuple
import cv2
import numpy as np
from app.config import settings
from app.logging import logger
from app.services.ocr_service import extract_raw_text

# The 8 canonical document types from api/prisma/schema.prisma
DOCUMENT_TYPES = [
    "CASTE_CERTIFICATE",
    "INCOME_CERTIFICATE",
    "MARKSHEET",
    "FEE_RECEIPT",
    "BANK_PASSBOOK",
    "BONAFIDE",
    "DISABILITY_CERT",
    "OFFER_LETTER",
]
CANONICAL_DOCUMENT_TYPES = DOCUMENT_TYPES

# Classification Rule Signatures
DOC_RULES: Dict[str, Dict[str, Any]] = {
    "CASTE_CERTIFICATE": {
        "primary": [
            r"\bcaste\b", r"\bcommunity\b", r"\btribe\b", r"\bscheduled caste\b",
            r"\bscheduled tribe\b", r"\bother backward\b", r"\bobc\b", r"\bsc/st\b",
            r"जाति प्रमाण पत्र", r"caste certificate", r"social justice", r"reservation"
        ],
        "secondary": [
            r"\btahsildar\b", r"\bsub-divisional magistrate\b", r"\bdistrict magistrate\b",
            r"\bcompetent authority\b", r"\brevenue officer\b", r"\bordinance\b"
        ],
        "patterns": [
            r"caste\s*[:\-]", r"sub-caste\s*[:\-]", r"category\s*[:\-]"
        ],
        "negatives": [
            r"\btuition fee\b", r"\bpassbook\b", r"\bsemester\b", r"\bctc\b"
        ]
    },
    "INCOME_CERTIFICATE": {
        "primary": [
            r"\bincome certificate\b", r"\bannual income\b", r"\bgross annual income\b",
            r"\bfamily income\b", r"आय प्रमाण पत्र", r"\bincome from all sources\b",
            r"\btotal income\b", r"\bper annum\b", r"\bannual family income\b"
        ],
        "secondary": [
            r"\btahsildar\b", r"\brevenue department\b", r"\bpatwari\b", r"\bsub-divisional officer\b",
            r"\bdeputy commissioner\b", r"\brupees\b", r"\brs\.?\b", r"\binr\b"
        ],
        "patterns": [
            r"(?:annual|family|gross)\s*income\s*[:\-]?\s*(?:rs\.?|inr)?\s*[\d,]+",
            r"rs\.?\s*[\d,]+\s*(?:per annum|p\.a\.|only)"
        ],
        "negatives": [
            r"\bsemester\b", r"\bgrade card\b", r"\bmarksheet\b", r"\bpassbook\b", r"\bjoining date\b"
        ]
    },
    "MARKSHEET": {
        "primary": [
            r"\bmarksheet\b", r"\bstatement of marks\b", r"\bgrade card\b", r"\bgrade sheet\b",
            r"\bmarks statement\b", r"\bexamination results?\b", r"\bacademic transcript\b"
        ],
        "secondary": [
            r"\bsemester\b", r"\bcgpa\b", r"\bsgpa\b", r"\bcredits\b", r"\bcredits earned\b",
            r"\bmaximum marks\b", r"\bmarks obtained\b", r"\bpercentage\b", r"\bgrade point\b",
            r"\bboard of secondary\b", r"\bintermediate\b", r"\bexamination\b", r"\broll no\b"
        ],
        "patterns": [
            r"\b(?:cgpa|sgpa|gpa)\s*[:\-]?\s*\d+\.\d+",
            r"\bmarks\s*obtained\s*[:\-]?\s*\d+",
            r"\bsemester\s*(?:[1-8]|i|ii|iii|iv|v|vi|vii|viii)\b"
        ],
        "negatives": [
            r"\btahsildar\b", r"\bannual income\b", r"\bifsc code\b", r"\bcost to company\b"
        ]
    },
    "FEE_RECEIPT": {
        "primary": [
            r"\bfee receipt\b", r"\btuition fee\b", r"\bpayment receipt\b", r"\bfees? receipt\b",
            r"\bfees? payment\b", r"\bfee collection\b", r"\bstudent receipt\b"
        ],
        "secondary": [
            r"\breceipt no\.?\b", r"\btransaction id\b", r"\bamount paid\b", r"\bchallan\b",
            r"\bbalance amount\b", r"\bhostel fee\b", r"\badmission fee\b", r"\bpayment mode\b"
        ],
        "patterns": [
            r"\breceipt\s*(?:no|number)\s*[:\-]?\s*[A-Z0-9\-]+",
            r"\bamount\s*paid\s*[:\-]?\s*(?:rs\.?|inr)?\s*[\d,]+",
            r"\btransaction\s*id\s*[:\-]?\s*[A-Za-z0-9\-]+"
        ],
        "negatives": [
            r"\btahsildar\b", r"\bcaste certificate\b", r"\bdisability certificate\b", r"\boffer of employment\b"
        ]
    },
    "BANK_PASSBOOK": {
        "primary": [
            r"\bbank passbook\b", r"\bpassbook\b", r"\baccount statement\b", r"\bsavings account\b",
            r"\bbank of\b", r"\bstate bank\b", r"\baccount holder\b"
        ],
        "secondary": [
            r"\baccount no\.?\b", r"\ba/c no\.?\b", r"\bifsc\b", r"\bifsc code\b",
            r"\bmicr\b", r"\bcif no\.?\b", r"\bbranch name\b", r"\bnominee\b"
        ],
        "patterns": [
            r"\b[A-Z]{4}0[A-Z0-9]{6}\b",  # Indian IFSC Code format
            r"\ba/c\s*(?:no|number)?\s*[:\-]?\s*\d{9,18}\b",
            r"\baccount\s*number\s*[:\-]?\s*\d{9,18}\b"
        ],
        "negatives": [
            r"\bmarksheet\b", r"\bgrade card\b", r"\bbonafide certificate\b", r"\bctc\b"
        ]
    },
    "BONAFIDE": {
        "primary": [
            r"\bbonafide certificate\b", r"\bbonafide student\b", r"\bbonafide\b",
            r"\bthis is to certify that\b"
        ],
        "secondary": [
            r"\bstudent of this institution\b", r"\bstudent of our college\b", r"\bcurrently studying\b",
            r"\bacademic year\b", r"\bprincipal\b", r"\bdean\b", r"\bhead of the department\b",
            r"\bregistration number\b", r"\benrolment number\b", r"\bdepartment of\b"
        ],
        "patterns": [
            r"certify\s+that\s+(?:mr\.|ms\.|shri|smt\.)?",
            r"bonafide\s+student\s+of"
        ],
        "negatives": [
            r"\btahsildar\b", r"\bincome certificate\b", r"\bifsc\b", r"\bgrade point\b", r"\bappointment letter\b"
        ]
    },
    "DISABILITY_CERT": {
        "primary": [
            r"\bdisability certificate\b", r"\bpersons with disabilities\b", r"\bdisability\b",
            r"\bpwd\b", r"\bpercentage of disability\b", r"\bphysical handicap\b"
        ],
        "secondary": [
            r"\blocomotor\b", r"\bvisual impairment\b", r"\bhearing impairment\b",
            r"\bmedical board\b", r"\bcivil surgeon\b", r"\bpermanent disability\b",
            r"\bhandicapped\b", r"\bdegree of disability\b", r"\bmedical authority\b"
        ],
        "patterns": [
            r"\b\d{1,3}\s*%\s*(?:disability|impairment)",
            r"disability\s*(?:percentage|ratio)\s*[:\-]?\s*\d{1,3}\s*%"
        ],
        "negatives": [
            r"\btuition fee\b", r"\bpassbook\b", r"\bmarksheet\b", r"\boffer letter\b"
        ]
    },
    "OFFER_LETTER": {
        "primary": [
            r"\boffer letter\b", r"\bletter of appointment\b", r"\bemployment offer\b",
            r"\bwe are pleased to offer\b", r"\bterms of employment\b"
        ],
        "secondary": [
            r"\bcost to company\b", r"\bctc\b", r"\bjoining date\b", r"\bdesignation\b",
            r"\bhuman resources\b", r"\bhr manager\b", r"\bprobation period\b", r"\bannual salary\b"
        ],
        "patterns": [
            r"\bctc\s*[:\-]?\s*(?:rs\.?|inr)?\s*[\d,]+",
            r"pleased\s+to\s+offer\s+you",
            r"date\s+of\s+joining\s*[:\-]"
        ],
        "negatives": [
            r"\btahsildar\b", r"\bcaste certificate\b", r"\bbonafide certificate\b", r"\bstatement of marks\b"
        ]
    }
}


def classify_document(image: np.ndarray, raw_bytes: bytes = b"") -> Dict[str, Any]:
    """
    Classifies uploaded document image into one of the 8 canonical DocumentType enums.
    
    Approach:
    OCR-then-keyword, layout, and structural pattern matching.
    - Lightweight, offline, sub-second execution with no remote network access.
    - Transparent and explainable for human reviewer auditability.
    - Robust against varying state-government visual formats.
    """
def score_document_text(text: str) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Computes raw keyword/pattern scores and unrounded Softmax probabilities for all 8 document types.
    Separated for direct testability and audit verification.
    """
    text_lower = text.lower()
    scores: Dict[str, float] = {doc_type: 0.0 for doc_type in DOCUMENT_TYPES}

    for doc_type, rules in DOC_RULES.items():
        doc_score = 0.0

        # Primary keywords (weight 4.0)
        for pattern in rules["primary"]:
            matches = len(re.findall(pattern, text_lower))
            if matches > 0:
                doc_score += min(matches, 3) * 4.0

        # Secondary keywords (weight 2.0)
        for pattern in rules["secondary"]:
            matches = len(re.findall(pattern, text_lower))
            if matches > 0:
                doc_score += min(matches, 2) * 2.0

        # Regex / Structural Patterns (weight 3.5)
        for pattern in rules["patterns"]:
            if re.search(pattern, text_lower):
                doc_score += 3.5

        # Negatives / Contradictory terms (penalty -3.0)
        for pattern in rules["negatives"]:
            if re.search(pattern, text_lower):
                doc_score -= 3.0

        scores[doc_type] = max(0.0, doc_score)

    max_score = max(scores.values())
    temperature = settings.classify_temperature

    if max_score > 0.0:
        exp_scores = {k: np.exp(v / temperature) for k, v in scores.items()}
        total_exp = sum(exp_scores.values())
        probabilities = {k: float(v / total_exp) for k, v in exp_scores.items()}
    else:
        # Uniform uninformative prior distribution: exactly 1 / K = 1 / 8 = 0.125
        uniform_prior = 1.0 / len(DOCUMENT_TYPES)
        probabilities = {k: uniform_prior for k in DOCUMENT_TYPES}

    logger.debug(f"[Classify] Raw Scores: {scores}")
    logger.debug(f"[Classify] Unrounded Probabilities: {probabilities}")

    return scores, probabilities


def classify_document(image: np.ndarray, raw_bytes: bytes = b"") -> Dict[str, Any]:
    """
    Classifies uploaded document image into one of the 8 canonical DocumentType enums.
    """
    # 1. Extract raw text from image
    text, ocr_conf = extract_raw_text(image, raw_bytes)

    # 2. Compute raw scores and posterior probabilities
    scores, probabilities = score_document_text(text)

    # 3. Sort candidates by probability in descending order.
    # In a tie, Python's stable Timsort maintains DOCUMENT_TYPES declaration order.
    sorted_candidates = sorted(probabilities.items(), key=lambda item: item[1], reverse=True)
    best_type, raw_conf = sorted_candidates[0]

    # 4. Direct calibrated confidence from the posterior distribution
    confidence = round(raw_conf, 2)

    # 5. Alternatives drawn from the exact same posterior distribution
    alternatives = [
        {"type": cand_type, "confidence": round(cand_prob, 2)}
        for cand_type, cand_prob in sorted_candidates[1:4]
    ]

    return {
        "value": best_type,
        "confidence": confidence,
        "alternatives": alternatives
    }
