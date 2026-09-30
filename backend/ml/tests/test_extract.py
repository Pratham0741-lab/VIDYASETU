import cv2
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.utils.image import encode_image_with_metadata
from doc_render import render_document

SAMPLE_DOCS = {
    "INCOME_CERTIFICATE": (
        "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT\n"
        "INCOME CERTIFICATE (आय प्रमाण पत्र)\n"
        "Certificate No: INC-JH-2025-04471\n"
        "This is to certify that annual family income from all sources of Shri Rahul Kumar\n"
        "is Rs. 2,68,000 (Rupees Two Lakh Sixty Eight Thousand Only) per annum.\n"
        "Issued by: Tahsildar, Ranchi Sadar Date: 14/03/2025"
    ),
    "CASTE_CERTIFICATE": (
        "GOVERNMENT OF MAHARASHTRA\n"
        "OFFICE OF THE SUB-DIVISIONAL MAGISTRATE\n"
        "CASTE CERTIFICATE (जाति प्रमाण पत्र)\n"
        "Certificate No: CST-MH-2024-88912\n"
        "This is to certify that Amit Shinde belongs to Scheduled Caste (SC) community under the Constitution order.\n"
        "Issued by: Competent Authority, Sub-Divisional Officer, Pune Date: 10/01/2024"
    ),
    "MARKSHEET": (
        "CENTRAL BOARD OF SECONDARY EDUCATION\n"
        "SENIOR SCHOOL CERTIFICATE EXAMINATION 2024\n"
        "STATEMENT OF MARKS / MARKSHEET\n"
        "Roll No: 12658932 Candidate Name: Priya Sharma\n"
        "Subject: Physics 88, Chemistry 92, Mathematics 95, English 85\n"
        "Total Marks Obtained: 450/500 Percentage: 90.0% Result: PASS"
    ),
    "FEE_RECEIPT": (
        "INDIAN INSTITUTE OF INFORMATION TECHNOLOGY DHARWAD\n"
        "STUDENT FEE RECEIPT / PAYMENT ACKNOWLEDGEMENT\n"
        "Receipt No: REC-2024-00452 Transaction ID: TXN99482104\n"
        "Student Name: Rohan Verma Roll No: 240421\n"
        "Tuition Fee: Rs. 85,000 Hostel Fee: Rs. 25,000 Total Amount Paid: Rs. 1,10,000\n"
        "Payment Mode: Online Net Banking Date: 15/07/2024"
    ),
    "BANK_PASSBOOK": (
        "STATE BANK OF INDIA - SAVINGS BANK PASSBOOK\n"
        "Branch: Dharwad Main Branch IFSC Code: SBIN0001234 MICR: 580002001\n"
        "Account Holder Name: Sneha Patil\n"
        "Account Number: 30948291048 CIF No: 8847291024\n"
        "Savings Bank Account Balance: Rs. 42,500"
    ),
    "BONAFIDE": (
        "DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING\n"
        "BONAFIDE CERTIFICATE\n"
        "Date: 20/08/2024 Ref: BON/CSE/2024/118\n"
        "This is to certify that Mr. Vivek Patel is a bonafide student of this institution,\n"
        "currently studying in B.Tech Semester 3 for the academic session 2024-2025.\n"
        "Signed: Dean / Principal of the College"
    ),
    "DISABILITY_CERT": (
        "DISTRICT MEDICAL BOARD / CIVIL SURGEON OFFICE\n"
        "DISABILITY CERTIFICATE FOR PERSONS WITH DISABILITIES (PWD)\n"
        "Certificate No: DIS-2023-7721\n"
        "This is to certify that Shri Rajesh Verma is affected with Locomotor Disability.\n"
        "Permanent physical impairment / Percentage of Disability: 45% (Forty Five Percent).\n"
        "Issued by: Medical Superintendent / Civil Surgeon"
    ),
    "OFFER_LETTER": (
        "INFOSYS TECHNOLOGIES LIMITED - HUMAN RESOURCES DEPARTMENT\n"
        "OFFER LETTER & LETTER OF APPOINTMENT\n"
        "Dear Ananya Roy, We are pleased to offer you employment as Systems Engineer.\n"
        "Cost to Company (CTC): Rs. 6,50,000 per annum.\n"
        "Date of Joining: 01/10/2024 Terms of Employment and Probation Period apply.\n"
        "Sincerely, Head of Talent Acquisition"
    ),
}


def make_doc_image(text: str) -> str:
    """A synthetic document image showing the whole text (tests/doc_render.py)."""
    return render_document(text)


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type, doc_text", list(SAMPLE_DOCS.items()))
async def test_extract_all_canonical_document_types(doc_type, doc_text):
    image_b64 = make_doc_image(doc_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64, "document_type": doc_type},
        )
        assert resp.status_code == 200, f"Failed for {doc_type}: {resp.text}"
        data = resp.json()

        assert "value" in data
        assert "confidence" in data
        assert "raw_text" in data
        assert isinstance(data["value"], dict)
        assert isinstance(data["confidence"], dict)
        assert len(data["raw_text"]) > 0

        vals = data["value"]
        confs = data["confidence"]

        # Ensure every value field has a matching confidence field
        for k in vals:
            assert k in confs
            assert 0.0 <= confs[k] <= 1.0

        # Verify key extracted values per document type
        if doc_type == "INCOME_CERTIFICATE":
            assert vals["family_income_annual"] == 268000
            assert confs["family_income_annual"] >= 0.70
            assert vals["certificate_number"] == "INC-JH-2025-04471"
            assert vals["issued_date"] == "2025-03-14"
            assert vals["applicant_name"] == "Rahul Kumar"

        elif doc_type == "CASTE_CERTIFICATE":
            assert vals["category"] == "SC"
            assert vals["caste_cert_number"] == "CST-MH-2024-88912"
            assert vals["issued_date"] == "2024-01-10"
            assert vals["applicant_name"] == "Amit Shinde"

        elif doc_type == "MARKSHEET":
            assert vals["roll_number"] == "12658932"
            assert vals["candidate_name"] == "Priya Sharma"
            assert vals["percentage"] == 90.0
            assert vals["marks_obtained"] == 450
            assert vals["total_marks"] == 500

        elif doc_type == "FEE_RECEIPT":
            assert vals["receipt_number"] == "REC-2024-00452"
            assert vals["transaction_id"] == "TXN99482104"
            assert vals["amount_paid"] == 110000
            assert vals["payment_date"] == "2024-07-15"
            assert vals["student_name"] == "Rohan Verma"

        elif doc_type == "BANK_PASSBOOK":
            assert vals["bank_account"] == "SBIN0001234:30948291048"
            assert "account_number" not in vals and "ifsc_code" not in vals
            assert vals["account_holder_name"] == "Sneha Patil"
            assert vals["bank_name"] == "STATE BANK OF INDIA"

        elif doc_type == "BONAFIDE":
            assert vals["student_name"] == "Vivek Patel"
            assert vals["academic_year"] == "2024-2025"
            assert vals["issued_date"] == "2024-08-20"

        elif doc_type == "DISABILITY_CERT":
            assert vals["disability_percentage"] == 45
            assert vals["disability_type"] == "Locomotor Disability"
            assert vals["certificate_number"] == "DIS-2023-7721"
            assert vals["applicant_name"] == "Rajesh Verma"

        elif doc_type == "OFFER_LETTER":
            assert vals["candidate_name"] == "Ananya Roy"
            assert vals["annual_ctc"] == 650000
            assert vals["joining_date"] == "2024-10-01"
            assert vals["designation"] == "Systems Engineer"


@pytest.mark.asyncio
async def test_extract_without_document_type_auto_classifies():
    doc_text = SAMPLE_DOCS["INCOME_CERTIFICATE"]
    image_b64 = make_doc_image(doc_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64},  # No document_type supplied
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["value"]["family_income_annual"] == 268000
        assert data["value"]["certificate_number"] == "INC-JH-2025-04471"
        assert data["confidence"]["family_income_annual"] >= 0.70


@pytest.mark.asyncio
async def test_extract_invalid_document_type():
    doc_text = SAMPLE_DOCS["INCOME_CERTIFICATE"]
    image_b64 = make_doc_image(doc_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64, "document_type": "INVALID_PASSPORT_TYPE"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "VALIDATION_ERROR"
        assert "Unsupported document type" in data["message"]


@pytest.mark.asyncio
async def test_extract_blank_image():
    blank = np.ones((400, 400, 3), dtype=np.uint8) * 255
    image_b64 = encode_image_with_metadata(blank, "")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64, "document_type": "INCOME_CERTIFICATE"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["value"]["family_income_annual"] is None
        assert data["confidence"]["family_income_annual"] == 0.0
        assert data["raw_text"] == ""


@pytest.mark.asyncio
async def test_extract_corrupted_image():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": "NotABase64Image", "document_type": "INCOME_CERTIFICATE"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "INVALID_IMAGE"


@pytest.mark.asyncio
async def test_extract_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/extract", json={})
        assert resp.status_code == 422
        data = resp.json()
        assert data["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_extract_auto_classify_low_confidence_policy():
    """
    When document_type is omitted on an ambiguous/garbage-ish document:
    - Internal /classify confidence is below classify_min_confidence (0.40).
    - Response carries low_confidence_auto_classification: true.
    - All non-zero field confidences are strictly capped by document_type_confidence.
    """
    garbage_text = "LOREM IPSUM RANDOM GARBAGE RECEIPT NO STATUTORY KEYWORDS 123456"
    image_b64 = make_doc_image(garbage_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64},  # No document_type provided
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["low_confidence_auto_classification"] is True
        assert data["document_type_confidence"] < 0.40

        # Every field confidence must be capped at or below document_type_confidence
        for field, conf in data["confidence"].items():
            assert conf <= data["document_type_confidence"]


@pytest.mark.asyncio
async def test_extract_field_confidence_gradient_degraded_input():
    """
    Proves that field confidence is not a static constant:
    A degraded/truncated field drops meaningfully below the ~0.87-0.93 band,
    while clean fields on the exact same document remain high.
    """
    # Degraded document: clean income, clean date, clean name, but truncated/obscured certificate number
    degraded_doc = (
        "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT\n"
        "INCOME CERTIFICATE (आय प्रमाण पत्र)\n"
        "Cert No: 4471\n"  # Missing standard INC-JH-2025- prefix due to tear/smudge
        "This is to certify that annual family income from all sources of Shri Rahul Kumar\n"
        "is Rs. 2,68,000 (Rupees Two Lakh Sixty Eight Thousand Only) per annum.\n"
        "Issued by: Tahsildar, Ranchi Sadar Date: 14/03/2025"
    )
    image_b64 = make_doc_image(degraded_doc)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64, "document_type": "INCOME_CERTIFICATE"},
        )
        assert resp.status_code == 200
        data = resp.json()

        vals = data["value"]
        confs = data["confidence"]

        # Clean fields stay in high band
        assert vals["family_income_annual"] == 268000
        assert confs["family_income_annual"] >= 0.88
        assert vals["issued_date"] == "2025-03-14"
        assert confs["issued_date"] >= 0.88
        assert vals["applicant_name"] == "Rahul Kumar"
        assert confs["applicant_name"] >= 0.85

        # Degraded certificate number drops meaningfully into ~0.45-0.55 band
        assert vals["certificate_number"] == "4471"
        assert confs["certificate_number"] <= 0.55
        assert confs["certificate_number"] < confs["family_income_annual"] - 0.30


@pytest.mark.asyncio
async def test_extract_missing_field_returns_null_and_zero_confidence():
    """
    Demonstrates that an absent field returns null/None with confidence: 0.0,
    while present fields on the document remain unaffected.
    """
    missing_field_doc = (
        "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT\n"
        "INCOME CERTIFICATE (आय प्रमाण पत्र)\n"
        # No Certificate No line at all
        "This is to certify that annual family income from all sources of Shri Rahul Kumar\n"
        "is Rs. 2,68,000 (Rupees Two Lakh Sixty Eight Thousand Only) per annum.\n"
        "Issued by: Tahsildar, Ranchi Sadar Date: 14/03/2025"
    )
    image_b64 = make_doc_image(missing_field_doc)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/extract",
            json={"image_base64": image_b64, "document_type": "INCOME_CERTIFICATE"},
        )
        assert resp.status_code == 200
        data = resp.json()

        vals = data["value"]
        confs = data["confidence"]

        # Missing field is None (JSON null) with exactly 0.0 confidence
        assert vals["certificate_number"] is None
        assert confs["certificate_number"] == 0.0

        # Present fields remain high confidence
        assert vals["family_income_annual"] == 268000
        assert confs["family_income_annual"] >= 0.88
        assert vals["issued_date"] == "2025-03-14"
        assert confs["issued_date"] >= 0.88
        assert vals["applicant_name"] == "Rahul Kumar"
        assert confs["applicant_name"] >= 0.85

