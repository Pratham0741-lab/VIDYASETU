import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_consistency_exact_name_match():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"document_type": "INCOME_CERTIFICATE", "applicant_name": "Ram Kumar", "dob": "2002-05-14"},
                {"document_type": "MARKSHEET", "candidate_name": "Ram Kumar", "dob": "14/05/2002"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 1.0
        assert data["value"]["dob_match"] is True
        assert data["confidence"]["dob_match"] == 1.0
        assert "Ram Kumar" in data["details"]["compared_values"]


@pytest.mark.asyncio
async def test_consistency_spacing_variant():
    # As explicitly specified in handover doc: "Ram Kumar" vs "Ramkumar"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Ram Kumar"},
                {"name": "Ramkumar"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] >= 0.90
        assert data["details"]["compared_values"] == ["Ram Kumar", "Ramkumar"]


@pytest.mark.asyncio
async def test_consistency_initial_expansion():
    # "Ram Kumar" vs "R. Kumar" (Handover doc benchmark 0.83)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Ram Kumar"},
                {"name": "R. Kumar"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.83


@pytest.mark.asyncio
async def test_consistency_initial_expansion_strength_distinction():
    """
    Confirms that INITIAL_EXPANSION is a continuous function distinguishing strong vs marginal matches:
    - Clean (2 of 3 tokens fully spelled out): scores high (~0.83)
    - Marginal (only 1 of 3 tokens spelled out, 2 initials): drops to ~0.71
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Strong match: "Aditya Vikram Birla" vs "A. Vikram Birla"
        resp_strong = await client.post(
            "/consistency",
            json={"documents": [{"name": "Aditya Vikram Birla"}, {"name": "A. Vikram Birla"}]},
        )
        assert resp_strong.status_code == 200
        conf_strong = resp_strong.json()["confidence"]["names_match"]

        # Marginal match: "Aditya Vikram Birla" vs "A. V. Birla"
        resp_marginal = await client.post(
            "/consistency",
            json={"documents": [{"name": "Aditya Vikram Birla"}, {"name": "A. V. Birla"}]},
        )
        assert resp_marginal.status_code == 200
        conf_marginal = resp_marginal.json()["confidence"]["names_match"]

        assert conf_strong > conf_marginal
        assert conf_strong == 0.83
        assert conf_marginal == 0.71



@pytest.mark.asyncio
async def test_consistency_middle_name_omission():
    # "Amit Kumar Shinde" vs "Amit Shinde"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Amit Kumar Shinde"},
                {"name": "Amit Shinde"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] >= 0.85


@pytest.mark.asyncio
async def test_consistency_indian_phonetic_transliterations():
    # Shreya Sharma vs Shreya Shrama (metathesis), Laxmi vs Lakshmi, Vikas vs Bikash
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        test_pairs = [
            ("Shreya Sharma", "Shreya Shrama"),
            ("Laxmi Devi", "Lakshmi Devi"),
            ("Vikas Patel", "Bikash Patel"),
        ]
        for n1, n2 in test_pairs:
            resp = await client.post("/consistency", json={"documents": [{"name": n1}, {"name": n2}]})
            assert resp.status_code == 200
            data = resp.json()
            assert data["value"]["names_match"] is True
            assert data["confidence"]["names_match"] >= 0.90


@pytest.mark.asyncio
async def test_consistency_honorific_stripping():
    # "Shri Rahul Kumar" vs "Rahul Kumar"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Shri Rahul Kumar"},
                {"name": "Rahul Kumar"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 1.0


@pytest.mark.asyncio
async def test_consistency_different_persons_never_auto_fails():
    # "Never auto-fail a mismatch — this endpoint only ever produces a confidence score, never a verdict"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Rahul Singh"},
                {"name": "Rohit Sharma"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        # MUST return 200 OK with low confidence score, NEVER a 4xx/500 error
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_shared_surname_different_first_name():
    # "Amit Kumar" vs "Sunil Kumar" -> shared common surname, different first name
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"name": "Amit Kumar"},
                {"name": "Sunil Kumar"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_dob_matching_and_variants():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Exact match across formats (YYYY-MM-DD vs DD/MM/YYYY)
        resp = await client.post(
            "/consistency",
            json={"documents": [{"dob": "2004-11-20"}, {"dob": "20/11/2004"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["value"]["dob_match"] is True
        assert resp.json()["confidence"]["dob_match"] == 1.0

        # 2. Year off by 1 (common age / OCR mistake) -> confidence drops into ~0.65
        resp_near = await client.post(
            "/consistency",
            json={"documents": [{"dob": "2004-11-20"}, {"dob": "2003-11-20"}]},
        )
        assert resp_near.status_code == 200
        assert resp_near.json()["value"]["dob_match"] is False
        assert 0.60 <= resp_near.json()["confidence"]["dob_match"] <= 0.70

        # 3. Completely different DOB
        resp_diff = await client.post(
            "/consistency",
            json={"documents": [{"dob": "2004-11-20"}, {"dob": "1998-02-15"}]},
        )
        assert resp_diff.status_code == 200
        assert resp_diff.json()["value"]["dob_match"] is False
        assert resp_diff.json()["confidence"]["dob_match"] == 0.0


@pytest.mark.asyncio
async def test_consistency_multi_document_comparison():
    # 3 documents: Marksheet, Passbook, Income Certificate
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "documents": [
                {"document_type": "MARKSHEET", "candidate_name": "Ram Kumar"},
                {"document_type": "BANK_PASSBOOK", "account_holder_name": "Ramkumar"},
                {"document_type": "INCOME_CERTIFICATE", "applicant_name": "R. Kumar"},
            ]
        }
        resp = await client.post("/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        # Weakest link among pairs is ("Ram Kumar", "R. Kumar") = 0.83
        assert data["confidence"]["names_match"] == 0.83
        assert len(data["details"]["compared_values"]) == 3


@pytest.mark.asyncio
async def test_consistency_insufficient_documents():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Less than 2 documents
        resp = await client.post(
            "/consistency",
            json={"documents": [{"name": "Only One Document"}]},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_consistency_missing_comparable_fields():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Documents without any names or DOBs
        resp = await client.post(
            "/consistency",
            json={"documents": [{"field_a": "val1"}, {"field_b": "val2"}]},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"
        assert "No comparable applicant fields" in resp.json()["message"]


@pytest.mark.asyncio
async def test_consistency_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/consistency", json={})
        assert resp.status_code in (400, 422)
        assert resp.json()["code"] == "VALIDATION_ERROR"
