# ML/OCR Track — Handover for Person 2

**System:** VIDYASETU · **Service:** `ml/` (Python, FastAPI, fully offline)
**Owner:** Person 2, Group A · **Integration:** by Pratham, at the end, into `api/`

---

## 0. Read this first — the one rule that decides everything

**Every function this service exposes must never return a bare pass/fail. It must always return a value plus a confidence score.**

This is not a style preference. The entire VIDYASETU design — going back to the very first deck — is built on one promise: *the AI never rejects an application, it recommends, and a human decides on anything uncertain.* If this service returns `{"is_valid": false}`, there is nothing for that promise to route on. If it returns `{"value": ..., "confidence": 0.42}`, the caller can say "below threshold, send to an officer for review" — which is the entire point.

**Concretely: every response object from every endpoint in this service must include at minimum:**

```json
{
  "value": <the actual extracted/classified/computed thing>,
  "confidence": <float, 0.0 to 1.0>
}
```

If you build toward a bare boolean now, every single endpoint has to be rewritten later to add this. If you build toward this shape from the start, integration is trivial. **This is the one thing to get right before writing any other code.**

### What `confidence` means (per endpoint)

`confidence` is always how sure the service is that the `value` it returned is correct - never a raw similarity or distance score (put those in `details`).

- **quality:** verdict certainty - how sure the gate is that its usable / not-usable verdict (and the issues listed) is right; a clearly bad image is high-confidence too.
- **classify:** classifier certainty in its top prediction (`value`).
- **extract:** per-field extraction certainty - how sure the extractor is that each field's value was read correctly (0.0 when the field was not found; its value is then null).
- **consistency:** verdict certainty - how sure each check is that its true/false verdict is right; a clear match and a clear mismatch are both high, only ambiguous evidence is low. The raw similarity is `details.similarity`.


---

## 1. What already exists — do not touch, do not duplicate

The `ml/` folder already has a working skeleton from an earlier phase:

```
ml/
  Dockerfile
  pyproject.toml
  app/
    main.py          — FastAPI app entrypoint
    config.py        — pydantic-settings config, validated at startup
    logging.py        — structured JSON logging
    errors.py         — standard error shape + exception handlers
    middleware.py      — request-ID propagation
    health.py          — GET /health
  tests/
```

- **The error shape is fixed:** `{"code": string, "message": string, "details": object|array|null, "requestId": string}`. Every error your endpoints raise must produce this shape — reuse the existing exception handling, don't invent a new one.
- **Config is validated at startup**, not read ad-hoc from `process.env`/`os.environ`. Any new setting (model paths, thresholds) goes into `config.py`'s schema, with a sensible default, so the service refuses to start with bad config rather than failing on first use.
- **Request-ID propagation already works** — every log line and response carries the caller's `X-Request-ID`. Don't build a parallel mechanism; use what's there.
- **`/health` already exists** and reports `modelsDirExists`/`modelsPresent`. When you add real models, wire their load status into this same health check rather than adding a separate one.

**Do not add any new top-level FastAPI app, Dockerfile, or docker-compose service.** Everything you build is new routes and modules *inside* this existing `ml/` app.

---

## 2. The four endpoints to build, in order

Build and prove each one standalone (via `curl`/Postman against the running container) before moving to the next. Don't try to chain them together until each works alone.

### 2.1 `POST /quality` — image quality gate

**Purpose:** before doing anything clever, decide whether an uploaded image is even usable. This is the cheapest, highest-value check in the whole pipeline — most real-world OCR failures are "the photo was too blurry to read," not a model limitation.

**Input:** an image (accept as base64 in the JSON body, or multipart — pick one, document it clearly, and keep it consistent across all four endpoints).

**Checks to run (OpenCV):**
- Blur (Laplacian variance — a standard, simple, effective measure)
- Resolution (below some minimum pixel dimension = unusable)
- Glare/overexposure (histogram check for a large saturated-white region)
- Crop/completeness (is there a large blank border suggesting the document edge was cut off — this one can be rougher/heuristic)

**Output shape:**
```json
{
  "value": {
    "usable": true,
    "issues": []
  },
  "confidence": 0.91,
  "details": {
    "blur_score": 145.2,
    "resolution": [1024, 768],
    "glare_ratio": 0.02
  }
}
```
`issues` is a list of strings when `usable` is false or borderline, e.g. `["blurred", "underexposed"]` — this is what becomes the applicant-facing "retake this, the bottom is blurred" message later. Make the issue strings specific and actionable, not just "quality too low."

**Test with:** deliberately blur, darken, and crop test images yourself to confirm each failure mode is actually detected. Don't just test with one clean photo.

### 2.2 `POST /classify` — document type classification

**Purpose:** which of the known document types is this? (Catches the very common real error of uploading a marksheet into the income-certificate slot.)

**Known types** (confirm this exact list against the real `document_type` values in the `Document` model before you start — check `api/prisma/schema.prisma`, the field's comment lists: `CASTE_CERTIFICATE, INCOME_CERTIFICATE, MARKSHEET, FEE_RECEIPT, BANK_PASSBOOK, BONAFIDE, DISABILITY_CERT, OFFER_LETTER`):

**Approach:** a lightweight classifier (a small CNN, or even a simpler approach — a text-based classifier run after a first-pass OCR, looking for characteristic keywords/layout per document type — is legitimate and easier to build correctly than a from-scratch image classifier; your call, but document which you chose and why). Train/tune against whatever sample documents you have available (ask Group C for their synthetic document generator output once it exists — that's specifically what it's for).

**Output shape:**
```json
{
  "value": "INCOME_CERTIFICATE",
  "confidence": 0.87,
  "alternatives": [
    {"type": "BONAFIDE", "confidence": 0.09},
    {"type": "MARKSHEET", "confidence": 0.04}
  ]
}
```

### 2.3 `POST /extract` — field extraction

**Purpose:** given an image and its (already-known or already-classified) document type, pull out the actual data fields.

**Approach:** PaddleOCR for the raw text extraction, then template/regex-based field extraction per document type — because government certificates have fixed layouts, this is more reliable and more explainable than trying to train a general-purpose extractor. (This mirrors a decision already made and documented elsewhere in this project: fixed-layout documents don't justify a heavyweight document-transformer model.)

**Fields per document type** — check the real applicant-facing rule requirements from Phase 3's work (the `doc_refs` on real rules, and what fields the rules engine actually reads — e.g. `family_income_annual`, `dob`, `category`) to know what's actually worth extracting; don't guess a generic field list.

**Output shape — this one matters most, get it right:**
```json
{
  "value": {
    "family_income_annual": 268000,
    "issued_date": "2025-03-14",
    "certificate_number": "INC-JH-2025-04471"
  },
  "confidence": {
    "family_income_annual": 0.94,
    "issued_date": 0.88,
    "certificate_number": 0.71
  },
  "raw_text": "... full OCR text dump for debugging ..."
}
```

**Per-field confidence, not one confidence for the whole document.** A document can have one crisp, certain field and one smudged, uncertain one — collapsing that into a single number throws away exactly the information the caller needs to decide which specific field to route to a human.

### 2.4 `POST /consistency` — cross-document checks

**Purpose:** given two or more already-extracted field sets (from multiple documents on the same application), check whether they agree — name matching, date-of-birth matching, etc.

**The one genuinely tricky part: name matching.** "Ram Kumar" / "Ramkumar" / "R. Kumar" / a Devanagari-script rendering are the same person; a genuinely different name is not. Use a combination of:
- Phonetic matching (metaphone/soundex-style, or a library that supports Indian name variants if you can find one — flag if you can't and fall back to a simpler edit-distance approach)
- Edit-distance/fuzzy matching for spelling variants
- **Never auto-fail a mismatch** — this endpoint's whole job is to produce a confidence score for "same person," not a verdict
  - *Superseded 2026-09-27:* `confidence` is the certainty of the `names_match` / `dob_match` verdict (see "What `confidence` means" in section 0); the similarity score is `details.similarity`. A mismatch is still never an auto-fail - the api only records it as a flag for officer review.

**Output shape:**
```json
{
  "value": {
    "names_match": true,
    "dob_match": true
  },
  "confidence": {
    "names_match": 0.83,
    "dob_match": 1.0
  },
  "details": {
    "compared_values": ["Ram Kumar", "Ramkumar"]
  }
}
```

---

## 3. Testing discipline — same standard as the rest of this project

This project has a strict habit: every claim gets proven against the real running system, not asserted. Apply it here too.

- **Run the service in Docker, not just locally in a Python venv**, before calling anything done. `docker compose up -d --build ml` (or however it's invoked in the current compose setup), then hit it with `curl` from outside the container.
- **Confirm it runs fully offline.** Same test used everywhere else in this project: `docker compose exec ml python -c "import urllib.request; urllib.request.urlopen('http://google.com', timeout=3)"` should fail with a DNS resolution error. If any library you use tries to download a model at runtime instead of using one bundled into the image, this will be the check that catches it — fix it before it becomes an integration surprise.
- **Test each endpoint with genuinely bad input, not just clean examples**: a garbage image, an empty body, a huge file, a document type that doesn't classify confidently into anything. Confirm you get a clean error in the standard shape, not a 500 with a stack trace.
- **Write down real numbers.** "Classification is 87% accurate on N test documents" is a credible claim for the deck. "It seems to work" is not. Keep a simple running tally as you test.

---

## 4. What NOT to build — stay in scope

- No NestJS code, no changes to anything in `api/`. That integration happens later, separately.
- No authentication/authorization logic — this service is internal-only, reachable only from `api/`, on the Docker-internal network with no exposed port. It doesn't need to know about users or roles.
- No database access of any kind — this service is stateless; it takes an image in, returns a result out. Storage of results is `api/`'s job.
- No calls to any external AI API (OpenAI, Google Vision, Azure Document Intelligence, anything hosted). Everything must run on models bundled into the image. This is a hard project-wide rule, not a suggestion.

---

## 5. Handover checklist — what "done" looks like for this track

- [ ] All four endpoints built and individually testable via `curl`/Postman
- [ ] Every response follows the `{value, confidence, ...}` shape — no bare booleans anywhere
- [ ] Errors follow the existing `{code, message, details, requestId}` shape
- [ ] Config (model paths, thresholds) goes through the existing validated config system
- [ ] Runs correctly inside the Docker container, confirmed with the no-internet test
- [ ] Tested against deliberately bad/edge-case input, not just clean examples
- [ ] A short README in `ml/` (or update the existing one) documenting: the four endpoints, their exact request/response shapes, and how to test each one manually
- [ ] A rough accuracy note for classification and extraction, even if informal — real numbers, tested against whatever sample documents were available

---

## 6. For Pratham — integration steps, once the above is done

1. Read the endpoints' actual request/response shapes from Person 2's README — confirm they match what's assumed here (adjust the assumed shapes above if reality diverged, that's expected and fine).
2. Add typed methods to `api/src/ml-client/ml-client.service.ts` for each new endpoint, following the same pattern as the existing `getHealth()`/`request<T>()` methods — request-ID forwarding, timeout handling, and mapping ml-service errors to `DEPENDENCY_UNAVAILABLE`/`INTERNAL_ERROR` are already established there.
3. Confirm the response types line up with what Phase 5's document-verification pipeline actually needs to consume — if Person 2's shape needs adjusting to fit cleanly, that's a quick negotiation, not a rewrite, since nothing else depends on the `ml/` internals.
4. Run the full no-internet + Docker Compose proof one more time with everything wired together, before treating Phase 5 as unblocked.
