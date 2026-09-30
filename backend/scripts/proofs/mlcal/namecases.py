import importlib, sys
CASES = [  # (type, name field, line-structured OCR text, expected)
 ("CASTE_CERTIFICATE", "applicant_name", "CASTE CERTIFICATE\nName: Anita Lakra Category: Scheduled Tribe (ST)\nDate: 14/03/2025", "Anita Lakra"),
 ("CASTE_CERTIFICATE", "applicant_name", "CASTE CERTIFICATE\nName: Mary Sunita Kumari Ekka Father's Name: Joseph Ekka\nTribe: Kharia", "Mary Sunita Kumari Ekka"),
 ("DISABILITY_CERT", "applicant_name", "DISABILITY CERTIFICATE\nName: Rajesh Kerketta Age: 19 years Sex: Male\nPercentage of disability: 45%", "Rajesh Kerketta"),
 ("BANK_PASSBOOK", "account_holder_name", "STATE BANK OF INDIA\nAccount Holder: Sunita Devi Hansda A/c No: 30948291048\nIFSC Code: SBIN0001234", "Sunita Devi Hansda"),
 ("MARKSHEET", "candidate_name", "STATEMENT OF MARKS\nCandidate Name: Ram Kumar Singh Roll No: 24110337\nMarks Obtained: 412/500", "Ram Kumar Singh"),
 ("INCOME_CERTIFICATE", "applicant_name", "INCOME CERTIFICATE\nName: Birsa Munda Annual Family Income: Rs 96,000\nDate: 17/09/2024", "Birsa Munda"),
 ("FEE_RECEIPT", "student_name", "FEE RECEIPT\nStudent Name: Ajay Kumar Minj Course: B.Sc. Physics\nAmount Paid: Rs 14,750", "Ajay Kumar Minj"),
 ("OFFER_LETTER", "candidate_name", "OFFER LETTER\nCandidate Name: Neha Kumari Oraon Designation: Graduate Engineer Trainee", "Neha Kumari Oraon"),
 ("BONAFIDE", "student_name", "BONAFIDE CERTIFICATE\nStudent Name: Sagar Kujur Course: B.Sc. Chemistry\nAcademic Session: 2025-26", "Sagar Kujur"),
 # applicant 'Name' appearing AFTER a father's-name line (old: first 'name:' anywhere)
 ("INCOME_CERTIFICATE", "applicant_name", "INCOME CERTIFICATE\nFather's Name: Sukra Tirkey\nName: Pooja Kumari Tirkey\nAnnual Family Income: Rs 1,45,000", "Pooja Kumari Tirkey"),
]
root, flatten = sys.argv[1], sys.argv[2] == "flat"
sys.path.insert(0, root)
from app.services.extract_service import EXTRACTORS
for t, field, text, want in CASES:
    txt = " ".join(text.split()) if flatten else text
    got = EXTRACTORS[t].extract(txt, 0.95)[0].get(field)
    ok = "exact" if got == want else ("OVERRUN" if got and got.startswith(want) else ("TRUNCATED" if got and want.startswith(got) else "WRONG/MISSING"))
    print(f"{t:18s} want={want!r:28s} got={got!r:48s} {ok}")
