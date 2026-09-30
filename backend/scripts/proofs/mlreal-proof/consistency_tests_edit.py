from pathlib import Path

p = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/ml/tests/test_consistency.py')
s = p.read_text(encoding='utf8')


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:70])
    s = s.replace(old, new)


# `confidence` is now verdict certainty; the raw similarity is details.similarity.
rep('''        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 1.0
        assert data["value"]["dob_match"] is True
        assert data["confidence"]["dob_match"] == 1.0
        assert "Ram Kumar" in data["details"]["compared_values"]''',
    '''        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.99
        assert data["details"]["similarity"]["names_match"] == 1.0
        assert data["value"]["dob_match"] is True
        assert data["confidence"]["dob_match"] == 0.99
        assert data["details"]["similarity"]["dob_match"] == 1.0
        assert "Ram Kumar" in data["details"]["compared_values"]''')

rep('''        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.83


@pytest.mark.asyncio
async def test_consistency_initial_expansion_strength_distinction():''',
    '''        assert data["value"]["names_match"] is True
        # Handover benchmark similarity 0.83; an initial cannot confirm the
        # given name, so the verdict is not certain (-> api UNCERTAIN).
        assert data["details"]["similarity"]["names_match"] == 0.83
        assert data["confidence"]["names_match"] == 0.72


@pytest.mark.asyncio
async def test_consistency_initial_expansion_strength_distinction():''')

rep('''        conf_strong = resp_strong.json()["confidence"]["names_match"]''',
    '''        conf_strong = resp_strong.json()["confidence"]["names_match"]
        sim_strong = resp_strong.json()["details"]["similarity"]["names_match"]''')
rep('''        conf_marginal = resp_marginal.json()["confidence"]["names_match"]

        assert conf_strong > conf_marginal
        assert conf_strong == 0.83
        assert conf_marginal == 0.71''',
    '''        conf_marginal = resp_marginal.json()["confidence"]["names_match"]
        sim_marginal = resp_marginal.json()["details"]["similarity"]["names_match"]

        assert sim_strong == 0.83 and sim_marginal == 0.71
        # One initial is more certain than two; neither is certain.
        assert conf_strong > conf_marginal
        assert conf_strong == 0.72
        assert conf_marginal == 0.62''')

rep('''        test_pairs = [
            ("Shreya Sharma", "Shreya Shrama"),
            ("Laxmi Devi", "Lakshmi Devi"),
            ("Vikas Patel", "Bikash Patel"),
        ]
        for n1, n2 in test_pairs:
            resp = await client.post("/v1/documents/consistency", json={"extractions": [{"name": n1}, {"name": n2}]})
            assert resp.status_code == 200
            data = resp.json()
            assert data["value"]["names_match"] is True
            assert data["confidence"]["names_match"] >= 0.90''',
    '''        # Documented transliteration equivalents: certain matches.
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
        assert data["details"]["similarity"]["names_match"] >= 0.90''')

rep('''        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 1.0


@pytest.mark.asyncio
async def test_consistency_different_persons_never_auto_fails():
    # "Never auto-fail a mismatch — this endpoint only ever produces a confidence score, never a verdict"''',
    '''        assert data["value"]["names_match"] is True
        assert data["confidence"]["names_match"] == 0.99


@pytest.mark.asyncio
async def test_consistency_different_persons_clear_mismatch():
    # A clear mismatch is a CERTAIN "false" verdict. Still never an error, and
    # never an auto-fail: the api records it as a flag for officer review.''')
rep('''        # MUST return 200 OK with low confidence score, NEVER a 4xx/500 error
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] <= 0.40''',
    '''        # MUST return 200 OK, NEVER a 4xx/500 error
        assert resp.status_code == 200
        data = resp.json()

        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] == 0.97
        assert data["details"]["similarity"]["names_match"] <= 0.40''')
rep('''        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_dob_matching_and_variants():''',
    '''        assert data["value"]["names_match"] is False
        assert data["confidence"]["names_match"] == 0.90
        assert data["details"]["similarity"]["names_match"] <= 0.40


@pytest.mark.asyncio
async def test_consistency_dob_matching_and_variants():''')

rep('''        assert resp.json()["value"]["dob_match"] is True
        assert resp.json()["confidence"]["dob_match"] == 1.0''',
    '''        assert resp.json()["value"]["dob_match"] is True
        assert resp.json()["confidence"]["dob_match"] == 0.99''')
rep('''        # 2. Year off by 1 (common age / OCR mistake) -> confidence drops into ~0.65''',
    '''        # 2. Year off by 1 (an OCR slip or a different date) -> ambiguous: low certainty''')
rep('''        assert resp_near.json()["value"]["dob_match"] is False
        assert 0.60 <= resp_near.json()["confidence"]["dob_match"] <= 0.70''',
    '''        assert resp_near.json()["value"]["dob_match"] is False
        assert resp_near.json()["confidence"]["dob_match"] == 0.60
        assert resp_near.json()["details"]["similarity"]["dob_match"] == 0.65''')
rep('''        assert resp_diff.json()["value"]["dob_match"] is False
        assert resp_diff.json()["confidence"]["dob_match"] == 0.0''',
    '''        # 3. Clearly different, readable dates -> a certain mismatch
        assert resp_diff.json()["value"]["dob_match"] is False
        assert resp_diff.json()["confidence"]["dob_match"] == 0.95
        assert resp_diff.json()["details"]["similarity"]["dob_match"] == 0.0''')
rep('''        # 3. Completely different DOB
''', '')

rep('''        assert data["value"]["names_match"] is True
        # Weakest link among pairs is ("Ram Kumar", "R. Kumar") = 0.83
        assert data["confidence"]["names_match"] == 0.83
        assert len(data["details"]["compared_values"]) == 3''',
    '''        assert data["value"]["names_match"] is True
        # Weakest similarity among pairs is ("Ram Kumar", "R. Kumar") = 0.83;
        # certainty is the weakest pair's: "Ramkumar" / "R. Kumar" is ambiguous.
        assert data["details"]["similarity"]["names_match"] == 0.83
        assert data["confidence"]["names_match"] == 0.60
        assert len(data["details"]["compared_values"]) == 3''')

s += '''

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
'''
p.write_text(s, encoding='utf8', newline='\n')
print('edited', p)
