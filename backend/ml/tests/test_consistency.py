import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_consistency_exact_name_match():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"document_type": "INCOME_CERTIFICATE", "applicant_name": "Ram Kumar", "dob": "2002-05-14"},
                {"document_type": "MARKSHEET", "candidate_name": "Ram Kumar", "dob": "14/05/2002"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.99
        assert data["details"]["similarity"]["names_match"] == 1.0
        assert data["value"]["dob_match"] is True
        assert data["confidence"]["dob_match"] == 0.99
        assert data["details"]["similarity"]["dob_match"] == 1.0
        assert "Ram Kumar" in data["details"]["compared_values"]


@pytest.mark.asyncio
async def test_consistency_spacing_variant():
    # As explicitly specified in handover doc: "Ram Kumar" vs "Ramkumar"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"name": "Ram Kumar"},
                {"name": "Ramkumar"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
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
            "extractions": [
                {"name": "Ram Kumar"},
                {"name": "R. Kumar"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        # Handover benchmark similarity 0.83; an initial cannot confirm the
        # given name, so the verdict is not certain (-> api UNCERTAIN).
        assert data["details"]["similarity"]["names_match"] == 0.83
        assert data["confidence"]["names_match"] == 0.72


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
            "/v1/documents/consistency",
            json={"extractions": [{"name": "Aditya Vikram Birla"}, {"name": "A. Vikram Birla"}]},
        )
        assert resp_strong.status_code == 200
        conf_strong = resp_strong.json()["confidence"]["names_match"]
        sim_strong = resp_strong.json()["details"]["similarity"]["names_match"]

        # Marginal match: "Aditya Vikram Birla" vs "A. V. Birla"
        resp_marginal = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"name": "Aditya Vikram Birla"}, {"name": "A. V. Birla"}]},
        )
        assert resp_marginal.status_code == 200
        conf_marginal = resp_marginal.json()["confidence"]["names_match"]
        sim_marginal = resp_marginal.json()["details"]["similarity"]["names_match"]

        assert sim_strong == 0.83 and sim_marginal == 0.71
        # One initial is more certain than two; neither is certain.
        assert conf_strong > conf_marginal
        assert conf_strong == 0.72
        assert conf_marginal == 0.62



@pytest.mark.asyncio
async def test_consistency_middle_name_omission():
    # "Amit Kumar Shinde" vs "Amit Shinde"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"name": "Amit Kumar Shinde"},
                {"name": "Amit Shinde"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] >= 0.85


@pytest.mark.asyncio
async def test_consistency_indian_phonetic_transliterations():
    # Shreya Sharma vs Shreya Shrama (metathesis), Laxmi vs Lakshmi, Vikas vs Bikash
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Documented transliteration equivalents: certain matches.
        test_pairs = [
            ("Laxmi Devi", "Lakshmi Devi"),
            ("Vikas Patel", "Bikash Patel"),
        ]
        for n1, n2 in test_pairs:
            resp = await client.post("/v1/documents/consistency", json={"extractions": [{"name": n1}, {"name": n2}]})
            assert resp.status_code == 200
            data = resp.json()
            assert data["value"]["names_match"] is True
            assert data["confidence"]["names_match"] >= 0.90
        # A transposition (Sharma / Shrama) is a spelling variant: likely the
        # same person, but an OCR slip or another person - not certain.
        resp = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"name": "Shreya Sharma"}, {"name": "Shreya Shrama"}]},
        )
        data = resp.json()
        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.65
        assert data["details"]["similarity"]["names_match"] >= 0.90


@pytest.mark.asyncio
async def test_consistency_honorific_stripping():
    # "Shri Rahul Kumar" vs "Rahul Kumar"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"name": "Shri Rahul Kumar"},
                {"name": "Rahul Kumar"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.99


@pytest.mark.asyncio
async def test_consistency_different_persons_clear_mismatch():
    # A clear mismatch is a CERTAIN "false" verdict. Still never an error, and
    # never an auto-fail: the api records it as a flag for officer review.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"name": "Rahul Singh"},
                {"name": "Rohit Sharma"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        # MUST return 200 OK, NEVER a 4xx/500 error
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] == 0.97
        assert data["details"]["similarity"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_shared_surname_different_first_name():
    # "Amit Kumar" vs "Sunil Kumar" -> shared common surname, different first name
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"name": "Amit Kumar"},
                {"name": "Sunil Kumar"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] == 0.90
        assert data["details"]["similarity"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_dob_matching_and_variants():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Exact match across formats (YYYY-MM-DD vs DD/MM/YYYY)
        resp = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"dob": "2004-11-20"}, {"dob": "20/11/2004"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["value"]["dob_match"] is True
        assert resp.json()["confidence"]["dob_match"] == 0.99

        # 2. Year off by 1 (an OCR slip or a different date) -> ambiguous: low certainty
        resp_near = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"dob": "2004-11-20"}, {"dob": "2003-11-20"}]},
        )
        assert resp_near.status_code == 200
        assert resp_near.json()["value"]["dob_match"] is False
        assert resp_near.json()["confidence"]["dob_match"] == 0.60
        assert resp_near.json()["details"]["similarity"]["dob_match"] == 0.65

        resp_diff = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"dob": "2004-11-20"}, {"dob": "1998-02-15"}]},
        )
        assert resp_diff.status_code == 200
        # 3. Clearly different, readable dates -> a certain mismatch
        assert resp_diff.json()["value"]["dob_match"] is False
        assert resp_diff.json()["confidence"]["dob_match"] == 0.95
        assert resp_diff.json()["details"]["similarity"]["dob_match"] == 0.0


@pytest.mark.asyncio
async def test_consistency_multi_document_comparison():
    # 3 documents: Marksheet, Passbook, Income Certificate
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "extractions": [
                {"document_type": "MARKSHEET", "candidate_name": "Ram Kumar"},
                {"document_type": "BANK_PASSBOOK", "account_holder_name": "Ramkumar"},
                {"document_type": "INCOME_CERTIFICATE", "applicant_name": "R. Kumar"},
            ]
        }
        resp = await client.post("/v1/documents/consistency", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is True
        # Weakest similarity among pairs is ("Ram Kumar", "R. Kumar") = 0.83;
        # certainty is the weakest pair's: "Ramkumar" / "R. Kumar" is ambiguous.
        assert data["details"]["similarity"]["names_match"] == 0.83
        assert data["confidence"]["names_match"] == 0.60
        assert len(data["details"]["compared_values"]) == 3


@pytest.mark.asyncio
async def test_consistency_insufficient_documents():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Less than 2 documents
        resp = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"name": "Only One Document"}]},
        )
        # A "cannot tell" outcome, not a client error: no checks, reason stated.
        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert resp.json()["details"]["reason"] == "fewer than two documents to compare"


@pytest.mark.asyncio
async def test_consistency_missing_comparable_fields():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Documents without any names or DOBs
        resp = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"field_a": "val1"}, {"field_b": "val2"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert "no comparable applicant fields" in resp.json()["details"]["reason"]


@pytest.mark.asyncio
async def test_consistency_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/documents/consistency", json={})
        assert resp.status_code in (400, 422)
        assert resp.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_consistency_different_surname_same_given_name():
    # Whole-string Soundex made these a 0.93 "match"; the surnames differ.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/documents/consistency",
            json={"extractions": [{"name": "Sunita Munda"}, {"name": "Sunita Hansda"}]},
        )
        data = resp.json()
        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] == 0.90
        assert data["details"]["similarity"]["names_match"] == 0.93


@pytest.mark.asyncio
async def test_consistency_real_ocr_cases():
    """Names as the real extractor read them from rendered scans (ML_MODE=real proof)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async def check(*names):
            resp = await client.post("/v1/documents/consistency",
                                     json={"extractions": [{"applicant_name": n} for n in names]})
            assert resp.status_code == 200
            return resp.json()

        clear_match = await check("Anita Lakra", "Anita Lakra")
        assert clear_match["value"]["names_match"] is True
        assert clear_match["confidence"]["names_match"] == 0.99

        clear_mismatch = await check("Anita Lakra", "Sunita Munda")
        assert clear_mismatch["value"]["names_match"] is False
        assert clear_mismatch["confidence"]["names_match"] == 0.97

        # Same leading names, different overrun tails: genuinely ambiguous.
        overrun = await check("Anita Lakra District Ranchi", "Anita Lakra Category Scheduled Tribe")
        assert overrun["value"]["names_match"] is True
        assert overrun["confidence"]["names_match"] == 0.60

        # One-letter OCR slip: likely the same person, not certain.
        slip = await check("Anita Lakra", "Anita Lakda")
        assert slip["value"]["names_match"] is True
        assert slip["confidence"]["names_match"] == 0.65

        # One certain mismatch among otherwise-matching documents decides.
        mixed = await check("Anita Lakra", "Anita Lakra", "Anita Lakra Percentage", "Sunita Munda")
        assert mixed["value"]["names_match"] is False
        assert mixed["confidence"]["names_match"] == 0.97
