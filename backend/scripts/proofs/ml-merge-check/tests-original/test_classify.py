import cv2
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.utils.image import encode_image_with_metadata

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
    """Creates a base64 encoded synthetic document with text visual lines & metadata."""
    img = np.ones((700, 900, 3), dtype=np.uint8) * 235
    cv2.rectangle(img, (20, 20), (880, 680), (100, 100, 100), 2)
    lines = text.split("\n")
    y = 50
    for line in lines[:10]:
        cv2.putText(img, line[:50], (40, y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 30, 30), 1)
        y += 40
    return encode_image_with_metadata(img, text)


@pytest.mark.asyncio
@pytest.mark.parametrize("expected_type, doc_text", list(SAMPLE_DOCS.items()))
async def test_classification_known_documents(expected_type, doc_text):
    image_b64 = make_doc_image(doc_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/classify", json={"image": image_b64})
        assert resp.status_code == 200
        data = resp.json()

        # Check required output shape
        assert "value" in data
        assert "confidence" in data
        assert "alternatives" in data
        assert isinstance(data["alternatives"], list)
        assert len(data["alternatives"]) > 0

        # Check predicted classification and confidence
        assert data["value"] == expected_type
        assert data["confidence"] >= 0.70

        # Alternatives must not contain the top selected value
        alt_types = [alt["type"] for alt in data["alternatives"]]
        assert expected_type not in alt_types


@pytest.mark.asyncio
async def test_classification_partial_match():
    # Weak evidence: document contains only 1 primary keyword ("annual income") and 1 shared authority ("Tahsildar")
    weak_doc_text = "Official memo from Tahsildar noting that annual income verification is pending."
    
    # 1. Direct assertion on raw internal score dictionary
    from app.services.classify_service import score_document_text
    raw_scores, raw_probs = score_document_text(weak_doc_text)
    
    assert raw_scores["INCOME_CERTIFICATE"] == 6.0, f"Expected 6.0 for INCOME, got {raw_scores['INCOME_CERTIFICATE']}"
    assert raw_scores["CASTE_CERTIFICATE"] == 2.0, f"Expected 2.0 for CASTE, got {raw_scores['CASTE_CERTIFICATE']}"
    for doc_type in raw_scores:
        if doc_type not in ("INCOME_CERTIFICATE", "CASTE_CERTIFICATE"):
            assert raw_scores[doc_type] == 0.0, f"Expected 0.0 for {doc_type}, got {raw_scores[doc_type]}"

    # Verify unrounded Softmax probabilities
    assert 0.26 <= raw_probs["INCOME_CERTIFICATE"] <= 0.28
    assert 0.13 <= raw_probs["CASTE_CERTIFICATE"] <= 0.15

    # 2. End-to-end API test verifying exact gradient responses
    image_b64 = make_doc_image(weak_doc_text)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/classify", json={"image": image_b64})
        assert resp.status_code == 200
        data = resp.json()
        assert data["value"] == "INCOME_CERTIFICATE"
        assert data["confidence"] == 0.27
        
        # Verify alternatives include CASTE_CERTIFICATE at 0.14
        alt_map = {alt["type"]: alt["confidence"] for alt in data["alternatives"]}
        assert alt_map["CASTE_CERTIFICATE"] == 0.14
        assert alt_map["MARKSHEET"] == 0.10


@pytest.mark.asyncio
async def test_classification_unrecognized_garbage():
    # Blank/random noise image
    img = np.random.randint(50, 200, (600, 800, 3), dtype=np.uint8)
    img_b64 = encode_image_with_metadata(img, "random noise xyz 123456 non standard text")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/classify", json={"image": img_b64})
        assert resp.status_code == 200
        data = resp.json()
        assert "value" in data
        # Unrecognized document should yield low confidence (<0.50) to route to human
        assert data["confidence"] < 0.50
        assert len(data["alternatives"]) > 0


@pytest.mark.asyncio
async def test_classification_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/classify", json={})
        assert resp.status_code == 422
        data = resp.json()
        assert data["code"] == "VALIDATION_ERROR"
        assert "requestId" in data


@pytest.mark.asyncio
async def test_classification_corrupted_image():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/classify", json={"image": "NotAValidBase64!!!"})
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "INVALID_IMAGE"
        assert "requestId" in data
