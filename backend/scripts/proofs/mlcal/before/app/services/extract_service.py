import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

from app.config import settings
from app.errors import AppError, ErrorCode
from app.services.classify_service import CANONICAL_DOCUMENT_TYPES, classify_document
from app.services.ocr_service import extract_raw_text

STOP_NAME_WORDS = {
    "is", "are", "was", "belongs", "belonging", "currently", "affected", "bearing",
    "having", "son", "daughter", "wife", "care", "c/o", "s/o", "d/o", "w/o",
    "residing", "resident", "student", "roll", "subject", "account", "who",
    "under", "of", "and", "the", "a", "an", "at", "to", "for", "with", "dated", "date",
    "terms", "we", "pleased", "in", "from"
}

TITLES = {
    "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "shri", "shree", "smt", "smt.", "dr", "dr.", "prof", "prof."
}


def normalize_date(date_str: str) -> Optional[str]:
    """Normalizes date string to YYYY-MM-DD format if possible."""
    cleaned = date_str.strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return cleaned


def parse_numeric(val_str: str) -> Optional[float]:
    """Parses clean numeric float/int from formatted currency or number string."""
    cleaned = re.sub(r"[^\d.]", "", val_str)
    if not cleaned:
        return None
    try:
        val = float(cleaned)
        return int(val) if val.is_integer() else val
    except ValueError:
        return None


def extract_person_name_with_quality(text: str, prefix_patterns: List[str]) -> Optional[Tuple[str, float]]:
    """
    Extracts person name and assesses evidence quality.
    Returns (name_str, quality_factor) where quality_factor is:
    - 0.93 for complete, multi-token capitalized name
    - 0.55 for degraded / single-token name
    """
    for pat in prefix_patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            start_pos = match.end()
            chunk = text[start_pos:start_pos + 120]
            # Take clause up to newline or major punctuation delimiters
            clause = re.split(r"[\n\r,;\(\)]", chunk)[0].strip()
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


class FieldExtractor:
    """Base class for document-type specific field extractors."""

    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        raise NotImplementedError


class IncomeCertificateExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "family_income_annual": None,
            "issued_date": None,
            "certificate_number": None,
            "applicant_name": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Family Income Annual
        inc_match_primary = re.search(
            r"(?:annual(?:\s+family)?\s+income|family\s+income|gross\s+annual\s+income|income\s+from\s+all\s+sources)[^:\d]{0,60}[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+)",
            text,
            re.IGNORECASE,
        )
        if inc_match_primary:
            val = parse_numeric(inc_match_primary.group(1))
            if val is not None:
                values["family_income_annual"] = int(val)
                confs["family_income_annual"] = round(min(0.96, max(0.70, ocr_conf * 0.98)), 2)
        else:
            inc_match_sec = re.search(r"is\s+(?:rs\.?|inr|₹)?\s*([\d,]+)\s*(?:\([^)]+\))?\s*per annum", text, re.IGNORECASE)
            if inc_match_sec:
                val = parse_numeric(inc_match_sec.group(1))
                if val is not None:
                    values["family_income_annual"] = int(val)
                    confs["family_income_annual"] = round(min(0.85, max(0.60, ocr_conf * 0.85)), 2)
            else:
                inc_match_fb = re.search(r"(?:rs\.?|inr|₹)\s*([\d,]+)", text, re.IGNORECASE)
                if inc_match_fb:
                    val = parse_numeric(inc_match_fb.group(1))
                    if val is not None and val > 1000:
                        values["family_income_annual"] = int(val)
                        confs["family_income_annual"] = round(min(0.60, max(0.40, ocr_conf * 0.55)), 2)

        # 2. Issued Date
        date_match = re.search(
            r"(?:issued\s+by:[^,\n]+date|date|issued\s+date|date\s+of\s+issue|dated)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
            text,
            re.IGNORECASE,
        )
        if date_match:
            raw_d = date_match.group(1)
            norm_d = normalize_date(raw_d)
            values["issued_date"] = norm_d
            is_full_date = bool(re.search(r"\b\d{4}\b", raw_d)) and norm_d != raw_d
            if is_full_date:
                confs["issued_date"] = round(min(0.94, max(0.68, ocr_conf * 0.95)), 2)
            else:
                confs["issued_date"] = round(min(0.60, max(0.40, ocr_conf * 0.55)), 2)

        # 3. Certificate Number
        cert_match = re.search(
            r"(?:certificate\s+(?:no|number)|cert\.?\s*no\.?)\s*[:\-]?\s*([A-Za-z0-9\/\-_]+)",
            text,
            re.IGNORECASE,
        )
        if cert_match:
            cert_val = cert_match.group(1).strip()
            values["certificate_number"] = cert_val
            is_structured = bool(re.search(r"[A-Za-z0-9]+[\/\-_][A-Za-z0-9]+", cert_val)) and len(cert_val) >= 8
            if is_structured:
                confs["certificate_number"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
            else:
                # Truncated or degraded certificate number missing standard prefix
                confs["certificate_number"] = round(min(0.55, max(0.35, ocr_conf * 0.52)), 2)

        # 4. Applicant Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"sources\s+of\s+",
                r"certify\s+that\s+",
                r"in\s+respect\s+of\s+",
                r"applicant\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, name_quality = name_res
            values["applicant_name"] = name
            confs["applicant_name"] = round(min(0.95, max(0.40, ocr_conf * name_quality)), 2)

        return values, confs


class CasteCertificateExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "category": None,
            # api contract: the key on Phase 3's sensitive-field list (redacted/encrypted at rest).
            "caste_cert_number": None,
            "issued_date": None,
            "applicant_name": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Category
        cat_match = re.search(
            r"\b(Scheduled Caste|Scheduled Tribe|Other Backward Class(?:es)?|SC|ST|OBC|EWS|General)\b",
            text,
            re.IGNORECASE,
        )
        if cat_match:
            matched = cat_match.group(1).upper()
            if "SCHEDULED CASTE" in matched or matched == "SC":
                category = "SC"
            elif "SCHEDULED TRIBE" in matched or matched == "ST":
                category = "ST"
            elif "BACKWARD" in matched or matched == "OBC":
                category = "OBC"
            elif matched == "EWS":
                category = "EWS"
            else:
                category = "GENERAL"
            values["category"] = category
            confs["category"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)

        # 2. Certificate Number
        cert_match = re.search(
            r"(?:certificate\s+(?:no|number)|cert\.?\s*no\.?)\s*[:\-]?\s*([A-Za-z0-9\/\-_]+)",
            text,
            re.IGNORECASE,
        )
        if cert_match:
            cert_val = cert_match.group(1).strip()
            values["caste_cert_number"] = cert_val
            is_structured = bool(re.search(r"[A-Za-z0-9]+[\/\-_][A-Za-z0-9]+", cert_val)) and len(cert_val) >= 8
            if is_structured:
                confs["caste_cert_number"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
            else:
                confs["caste_cert_number"] = round(min(0.55, max(0.35, ocr_conf * 0.52)), 2)

        # 3. Issued Date
        date_match = re.search(
            r"(?:date|issued\s+date|date\s+of\s+issue|dated)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
            text,
            re.IGNORECASE,
        )
        if date_match:
            raw_d = date_match.group(1)
            norm_d = normalize_date(raw_d)
            values["issued_date"] = norm_d
            is_full = bool(re.search(r"\b\d{4}\b", raw_d)) and norm_d != raw_d
            confs["issued_date"] = round(min(0.94 if is_full else 0.58, max(0.40, ocr_conf * (0.95 if is_full else 0.55))), 2)

        # 4. Applicant Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"certify\s+that\s+",
                r"applicant\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["applicant_name"] = name
            confs["applicant_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        return values, confs


class MarksheetExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "roll_number": None,
            "candidate_name": None,
            "percentage": None,
            "marks_obtained": None,
            "total_marks": None,
            "passing_year": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Roll Number
        roll_match = re.search(
            r"(?:roll\s*(?:no|number)|reg(?:istration)?\s*(?:no|number))\s*[:\-]?\s*([A-Za-z0-9\-]+)",
            text,
            re.IGNORECASE,
        )
        if roll_match:
            r_val = roll_match.group(1).strip()
            values["roll_number"] = r_val
            is_full = len(r_val) >= 6
            confs["roll_number"] = round(min(0.96 if is_full else 0.58, max(0.40, ocr_conf * (0.98 if is_full else 0.55))), 2)

        # 2. Candidate Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"candidate\s+name\s*[:\-]\s*",
                r"student\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["candidate_name"] = name
            confs["candidate_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        # 3. Marks obtained / Total Marks
        marks_match = re.search(
            r"(?:total\s+)?marks\s+obtained\s*[:\-]?\s*(\d+)\s*\/\s*(\d+)",
            text,
            re.IGNORECASE,
        )
        if marks_match:
            values["marks_obtained"] = int(marks_match.group(1))
            values["total_marks"] = int(marks_match.group(2))
            confs["marks_obtained"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
            confs["total_marks"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
        else:
            obt_match = re.search(r"(?:total\s+)?marks\s+obtained\s*[:\-]?\s*(\d+)", text, re.IGNORECASE)
            if obt_match:
                values["marks_obtained"] = int(obt_match.group(1))
                confs["marks_obtained"] = round(min(0.90, max(0.65, ocr_conf * 0.90)), 2)

        # 4. Percentage
        pct_match = re.search(
            r"percentage\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?)\s*%?",
            text,
            re.IGNORECASE,
        )
        if pct_match:
            values["percentage"] = float(pct_match.group(1))
            confs["percentage"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
        elif values["marks_obtained"] is not None and values["total_marks"] is not None and values["total_marks"] > 0:
            calc_pct = round((values["marks_obtained"] / values["total_marks"]) * 100.0, 2)
            values["percentage"] = calc_pct
            confs["percentage"] = round(min(0.88, max(0.60, ocr_conf * 0.88)), 2)

        # 5. Passing Year
        year_match = re.search(
            r"(?:examination\s+(\d{4})|year\s*[:\-]?\s*(\d{4})|\b(20\d{2})\b)",
            text,
            re.IGNORECASE,
        )
        if year_match:
            year_val = next(g for g in year_match.groups() if g)
            values["passing_year"] = int(year_val)
            confs["passing_year"] = round(min(0.92, max(0.65, ocr_conf * 0.92)), 2)

        return values, confs


class FeeReceiptExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "receipt_number": None,
            "transaction_id": None,
            "amount_paid": None,
            "payment_date": None,
            "student_name": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Receipt Number
        rec_match = re.search(
            r"receipt\s*(?:no|number)\s*[:\-]?\s*([A-Za-z0-9\/\-_]+)",
            text,
            re.IGNORECASE,
        )
        if rec_match:
            rec_val = rec_match.group(1).strip()
            values["receipt_number"] = rec_val
            is_full = len(rec_val) >= 6
            confs["receipt_number"] = round(min(0.95 if is_full else 0.58, max(0.40, ocr_conf * (0.96 if is_full else 0.55))), 2)

        # 2. Transaction ID
        txn_match = re.search(
            r"transaction\s*(?:id|no|ref)\s*[:\-]?\s*([A-Za-z0-9\/\-_]+)",
            text,
            re.IGNORECASE,
        )
        if txn_match:
            txn_val = txn_match.group(1).strip()
            values["transaction_id"] = txn_val
            is_full = len(txn_val) >= 6
            confs["transaction_id"] = round(min(0.95 if is_full else 0.58, max(0.40, ocr_conf * (0.96 if is_full else 0.55))), 2)

        # 3. Amount Paid
        amt_match = re.search(
            r"(?:total\s+)?amount\s*(?:paid)?\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)",
            text,
            re.IGNORECASE,
        )
        if amt_match:
            val = parse_numeric(amt_match.group(1))
            if val is not None:
                values["amount_paid"] = val
                confs["amount_paid"] = round(min(0.96, max(0.70, ocr_conf * 0.97)), 2)

        # 4. Payment Date
        date_match = re.search(
            r"(?:payment\s+)?date\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
            text,
            re.IGNORECASE,
        )
        if date_match:
            raw_d = date_match.group(1)
            norm_d = normalize_date(raw_d)
            values["payment_date"] = norm_d
            is_full = bool(re.search(r"\b\d{4}\b", raw_d)) and norm_d != raw_d
            confs["payment_date"] = round(min(0.94 if is_full else 0.58, max(0.40, ocr_conf * (0.95 if is_full else 0.55))), 2)

        # 5. Student Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"student\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["student_name"] = name
            confs["student_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        return values, confs


class BankPassbookExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        # api contract: one "bank_account" field ("IFSC:ACCOUNT", the format used
        # at registration) - the key on Phase 3's sensitive-field list, so the
        # api redacts/encrypts it. Separate account/IFSC keys would be stored
        # as plain text.
        values: Dict[str, Any] = {
            "bank_account": None,
            "account_holder_name": None,
            "bank_name": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Account Number
        acc_match = re.search(
            r"(?:account|a\/c)\s*(?:no|number)?\s*[:\-]?\s*(\d{9,18})\b",
            text,
            re.IGNORECASE,
        )
        # 2. IFSC Code
        ifsc_match = re.search(r"\b([A-Z]{4}0[A-Z0-9]{6})\b", text)

        # Combined: an account needs the number; the IFSC qualifies it when read.
        if acc_match:
            account = acc_match.group(1).strip()
            acc_conf = round(min(0.97, max(0.72, ocr_conf * 0.98)), 2)
            if ifsc_match:
                ifsc_conf = round(min(0.98, max(0.75, ocr_conf * 0.99)), 2)
                values["bank_account"] = f"{ifsc_match.group(1).strip()}:{account}"
                confs["bank_account"] = min(acc_conf, ifsc_conf)
            else:
                values["bank_account"] = account
                confs["bank_account"] = acc_conf

        # 3. Account Holder Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"account\s*holder(?:\s+name)?\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["account_holder_name"] = name
            confs["account_holder_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        # 4. Bank Name
        bank_match = re.search(
            r"\b(STATE BANK OF INDIA|HDFC BANK|ICICI BANK|PUNJAB NATIONAL BANK|BANK OF BARODA|CANARA BANK|UNION BANK OF INDIA|AXIS BANK|INDIAN BANK|BANK OF INDIA)\b",
            text,
            re.IGNORECASE,
        )
        if bank_match:
            values["bank_name"] = bank_match.group(1).strip().upper()
            confs["bank_name"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)

        return values, confs


class BonafideExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "student_name": None,
            "institution_name": None,
            "academic_year": None,
            "issued_date": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Student Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"certify\s+that\s+",
                r"student\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["student_name"] = name
            confs["student_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        # 2. Institution Name (from first header line or context)
        first_line = text.strip().split("\n")[0].strip()
        if len(first_line) > 5 and not re.search(r"certif|bonafide", first_line, re.IGNORECASE):
            values["institution_name"] = first_line
            confs["institution_name"] = round(min(0.90, max(0.60, ocr_conf * 0.90)), 2)
        else:
            inst_match = re.search(
                r"(?:student\s+of\s+([A-Za-z\s&]{4,40}?)(?:,|\n|currently))",
                text,
                re.IGNORECASE,
            )
            if inst_match:
                values["institution_name"] = inst_match.group(1).strip()
                confs["institution_name"] = round(min(0.85, max(0.55, ocr_conf * 0.85)), 2)

        # 3. Academic Year / Session
        year_match = re.search(
            r"(?:academic\s+(?:session|year)|session)\s*[:\-]?\s*(\d{4}\s*[\-\/]\s*\d{2,4})",
            text,
            re.IGNORECASE,
        )
        if year_match:
            values["academic_year"] = year_match.group(1).strip()
            confs["academic_year"] = round(min(0.92, max(0.65, ocr_conf * 0.93)), 2)

        # 4. Issued Date
        date_match = re.search(
            r"(?:date|dated)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
            text,
            re.IGNORECASE,
        )
        if date_match:
            raw_d = date_match.group(1)
            norm_d = normalize_date(raw_d)
            values["issued_date"] = norm_d
            is_full = bool(re.search(r"\b\d{4}\b", raw_d)) and norm_d != raw_d
            confs["issued_date"] = round(min(0.94 if is_full else 0.58, max(0.40, ocr_conf * (0.95 if is_full else 0.55))), 2)

        return values, confs


class DisabilityCertExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "disability_percentage": None,
            "disability_type": None,
            "certificate_number": None,
            "applicant_name": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Disability Percentage
        pct_match = re.search(
            r"(?:percentage\s+of\s+disability|disability\s*(?:percentage|ratio))?\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?)\s*%",
            text,
            re.IGNORECASE,
        )
        if pct_match:
            val = float(pct_match.group(1))
            values["disability_percentage"] = int(val) if val.is_integer() else val
            confs["disability_percentage"] = round(min(0.96, max(0.70, ocr_conf * 0.97)), 2)

        # 2. Disability Type
        type_match = re.search(
            r"\b(Locomotor Disability|Visual Impairment|Hearing Impairment|Speech and Language Disability|Mental Illness|Multiple Disabilities|Intellectual Disability|Physical Handicap)\b",
            text,
            re.IGNORECASE,
        )
        if type_match:
            values["disability_type"] = type_match.group(1).strip()
            confs["disability_type"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)

        # 3. Certificate Number
        cert_match = re.search(
            r"(?:certificate\s+(?:no|number)|cert\.?\s*no\.?)\s*[:\-]?\s*([A-Za-z0-9\/\-_]+)",
            text,
            re.IGNORECASE,
        )
        if cert_match:
            cert_val = cert_match.group(1).strip()
            values["certificate_number"] = cert_val
            is_structured = bool(re.search(r"[A-Za-z0-9]+[\/\-_][A-Za-z0-9]+", cert_val)) and len(cert_val) >= 8
            if is_structured:
                confs["certificate_number"] = round(min(0.95, max(0.70, ocr_conf * 0.96)), 2)
            else:
                confs["certificate_number"] = round(min(0.55, max(0.35, ocr_conf * 0.52)), 2)

        # 4. Applicant Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"certify\s+that\s+",
                r"applicant\s+name\s*[:\-]\s*",
                r"name\s*[:\-]\s*",
            ],
        )
        if name_res:
            name, quality = name_res
            values["applicant_name"] = name
            confs["applicant_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        return values, confs


class OfferLetterExtractor(FieldExtractor):
    def extract(self, text: str, ocr_conf: float) -> Tuple[Dict[str, Any], Dict[str, float]]:
        values: Dict[str, Any] = {
            "candidate_name": None,
            "annual_ctc": None,
            "joining_date": None,
            "designation": None,
        }
        confs: Dict[str, float] = {k: 0.0 for k in values}

        # 1. Candidate Name
        name_res = extract_person_name_with_quality(
            text,
            [
                r"dear\s+",
                r"candidate\s*name\s*[:\-]\s*",
                r"offer\s+to\s+",
            ],
        )
        if name_res:
            name, quality = name_res
            values["candidate_name"] = name
            confs["candidate_name"] = round(min(0.95, max(0.40, ocr_conf * quality)), 2)

        # 2. Annual CTC
        ctc_match = re.search(
            r"(?:cost\s+to\s+company\s*\(ctc\)|ctc|annual\s+salary)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)",
            text,
            re.IGNORECASE,
        )
        if ctc_match:
            val = parse_numeric(ctc_match.group(1))
            if val is not None:
                values["annual_ctc"] = int(val) if isinstance(val, (int, float)) and float(val).is_integer() else val
                confs["annual_ctc"] = round(min(0.96, max(0.70, ocr_conf * 0.97)), 2)

        # 3. Joining Date
        date_match = re.search(
            r"(?:date\s+of\s+joining|joining\s+date)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})",
            text,
            re.IGNORECASE,
        )
        if date_match:
            raw_d = date_match.group(1)
            norm_d = normalize_date(raw_d)
            values["joining_date"] = norm_d
            is_full = bool(re.search(r"\b\d{4}\b", raw_d)) and norm_d != raw_d
            confs["joining_date"] = round(min(0.94 if is_full else 0.58, max(0.40, ocr_conf * (0.95 if is_full else 0.55))), 2)

        # 4. Designation
        desig_match = re.search(
            r"(?:employment\s+as\s+|position\s+of\s+|designation\s*[:\-]\s*)([A-Za-z\s]{3,35}?)(?:\.|\n|Terms|with)",
            text,
            re.IGNORECASE,
        )
        if desig_match:
            values["designation"] = desig_match.group(1).strip()
            confs["designation"] = round(min(0.90, max(0.60, ocr_conf * 0.91)), 2)

        return values, confs


EXTRACTORS: Dict[str, FieldExtractor] = {
    "INCOME_CERTIFICATE": IncomeCertificateExtractor(),
    "CASTE_CERTIFICATE": CasteCertificateExtractor(),
    "MARKSHEET": MarksheetExtractor(),
    "FEE_RECEIPT": FeeReceiptExtractor(),
    "BANK_PASSBOOK": BankPassbookExtractor(),
    "BONAFIDE": BonafideExtractor(),
    "DISABILITY_CERT": DisabilityCertExtractor(),
    "OFFER_LETTER": OfferLetterExtractor(),
}


def extract_document_fields(
    image: np.ndarray,
    raw_bytes: bytes = b"",
    document_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Extracts structured fields and per-field confidence from a document image.

    Args:
        image: Decoded OpenCV image matrix.
        raw_bytes: Original raw image bytes.
        document_type: Canonical document type string. If not provided, auto-classifies.

    Returns:
        Dict conforming to {value: dict, confidence: dict, raw_text: str, document_type: str, document_type_confidence: float, low_confidence_auto_classification: bool}.
    """
    auto_classified = False
    doc_type_conf = 1.0
    low_confidence_auto_classification = False

    # 1. Determine or validate document type
    if document_type:
        dt_upper = document_type.strip().upper()
        if dt_upper not in CANONICAL_DOCUMENT_TYPES:
            raise AppError(
                code=ErrorCode.VALIDATION_ERROR,
                message=f"Unsupported document type: '{document_type}'. Must be one of: {CANONICAL_DOCUMENT_TYPES}",
                status_code=400,
            )
        resolved_type = dt_upper
    else:
        auto_classified = True
        classification = classify_document(image, raw_bytes)
        resolved_type = classification["value"]
        doc_type_conf = float(classification["confidence"])
        if doc_type_conf < settings.classify_min_confidence:
            low_confidence_auto_classification = True

    # 2. Extract OCR text
    raw_text, ocr_conf = extract_raw_text(image, raw_bytes)
    if not raw_text:
        # Empty OCR text -> empty values with 0.0 confidence
        extractor = EXTRACTORS.get(resolved_type)
        if extractor:
            empty_vals, empty_confs = extractor.extract("", 0.0)
        else:
            empty_vals, empty_confs = {}, {}
        return {
            "value": empty_vals,
            "confidence": empty_confs,
            "raw_text": "",
            "document_type": resolved_type,
            "document_type_confidence": round(doc_type_conf, 2),
            "low_confidence_auto_classification": low_confidence_auto_classification,
        }

    # 3. Extract fields using specialized template extractor
    extractor = EXTRACTORS.get(resolved_type)
    if not extractor:
        raise AppError(
            code=ErrorCode.VALIDATION_ERROR,
            message=f"No extractor registered for document type: {resolved_type}",
            status_code=400,
        )

    values, confidences = extractor.extract(raw_text, ocr_conf)

    # 4. Bayesian continuous joint probability scaling:
    # When document_type is auto-classified, P(Field is valid) = P(Field | Type) * P(Type)
    # continuously across the full range [0.0, 1.0] to prevent arbitrary cliff thresholds at classify_min_confidence.
    # Note: clamp is omitted since confidences[k] <= 1.0 ensures confidences[k] * doc_type_conf <= doc_type_conf is an invariant.
    if auto_classified:
        for k in confidences:
            if confidences[k] > 0.0:
                confidences[k] = round(confidences[k] * doc_type_conf, 2)

    return {
        "value": values,
        "confidence": confidences,
        "raw_text": raw_text,
        "document_type": resolved_type,
        "document_type_confidence": round(doc_type_conf, 2),
        "low_confidence_auto_classification": low_confidence_auto_classification,
    }
