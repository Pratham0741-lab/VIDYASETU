# VIDYASETU ML Service (`ml/`)

Offline Document Verification, Quality Gate, Classification, Extraction, and Consistency API for VIDYASETU.

## Architecture & Core Rules

- **Offline-First:** All processing is performed strictly local/offline without external network calls.
- **Rule of Confidence (Verdict Certainty):** The `confidence` score across all endpoints measures the *certainty of the verdict* (not image quality or document goodness). A clear pass has high confidence; an unambiguous failure (e.g., obvious blur, clear document mismatch) also has high confidence in its failure verdict; borderline cases yield low confidence (<0.70) to route to a human reviewer.
- **Image Usability:** Usability and detected defects are conveyed strictly through `value.usable: bool` and actionable strings in `value.issues: string[]`.
- **Standardized Errors:** Errors always return `{"code": string, "message": string, "details": object|array|null, "requestId": string}` using a centralized `ErrorCode` enum.
- **Input Standard:** All endpoints accepting images take JSON payloads with base64-encoded strings: `{"image": "<base64_string>"}`.

---

## 1. Quality Gate (`POST /quality`)

Cheaply evaluates whether an uploaded document image is usable before proceeding with heavy OCR.

### Checks Performed
- **Blur:** Laplacian variance threshold (configurable via `BLUR_THRESHOLD`, default `100.0`).
- **Resolution:** Checks pixel dimensions against minimum bounds (`MIN_WIDTH` x `MIN_HEIGHT`, default `400x400`).
- **Glare / Overexposure:** Histogram analysis of saturated white regions (`GLARE_RATIO_THRESHOLD`, default `0.05`).
- **Underexposure:** Luminance analysis detecting darkened/underexposed captures.
- **Crop / Completeness:** Margin and border energy heuristics detecting cut-off document edges.

### Request
```http
POST /quality HTTP/1.1
Content-Type: application/json
X-Request-ID: req-001

{
  "image": "<base64_encoded_image>"
}
```

### Response (Clean / Usable Image)
```json
{
  "value": {
    "usable": true,
    "issues": []
  },
  "confidence": 0.95,
  "details": {
    "blur_score": 4409.64,
    "resolution": [800, 600],
    "glare_ratio": 0.0
  }
}
```

### Response (Defective Image — Obvious Blur with High Verdict Certainty)
```json
{
  "value": {
    "usable": false,
    "issues": [
      "blurred"
    ]
  },
  "confidence": 0.96,
  "details": {
    "blur_score": 1.64,
    "resolution": [800, 600],
    "glare_ratio": 0.0
  }
}
```

---

## 2. Document Classification (`POST /classify`)

Identifies which known document type was uploaded from the 8 canonical types defined in `api/prisma/schema.prisma`:
1. `CASTE_CERTIFICATE`
2. `INCOME_CERTIFICATE`
3. `MARKSHEET`
4. `FEE_RECEIPT`
5. `BANK_PASSBOOK`
6. `BONAFIDE`
7. `DISABILITY_CERT`
8. `OFFER_LETTER`

### Approach & Design Rationale
An **OCR-then-keyword, layout, and structural pattern classifier** with continuous temperature-scaled Softmax ($T = 6.0$, configurable via `CLASSIFY_TEMPERATURE`) was selected over a heavyweight CNN for three key reasons:
1. **Explainability & Auditability:** Indian government/academic scholarship documents contain statutory keywords (`Tahsildar`, `Annual Income`, `IFSC Code`, `CGPA`, `Percentage of Disability`). The keyword weights provide transparent explanations that human reviewers can inspect.
2. **Strictly Offline & Sub-Second Latency:** Operates 100% locally on CPU without multi-gigabyte neural network dependencies or external model download risks.
3. **Template Invariance:** Indian states (Jharkhand, Maharashtra, Karnataka, UP, etc.) utilize different visual layouts and logos for certificates, but share identical statutory terminology and legal authority titles.

### Scoring Contracts & Semantics
1. **Continuous Un-snapped Gradient:**
   Confidence is directly the posterior probability from the temperature-scaled Softmax ($T = 6.0$). It scales continuously without artificial snapping:
   - **Zero Evidence / Garbage:** `0.12` ($1/K = 1/8 = 0.125$ uniform prior floor).
   - **Weak / Partial Evidence:** `0.20 - 0.55` (e.g. 1-2 keywords, routing to human review).
   - **Clean Document:** `0.80 - 0.98`.
2. **Tie-Break Behavior & Meaning of `value` at Low Confidence:**
   When all classes tie (e.g., probability is $0.125$ each), the selection of `value` is an incidental tie-break determined by array declaration order (`DOCUMENT_TYPES[0]`).
   **Caller Contract:** When `confidence < CLASSIFY_MIN_CONFIDENCE` (default `0.40`), `value` is **NOT meaningful** and MUST NOT be trusted as a genuine signal. The routing engine must route the document directly to a human reviewer.
3. **Alternatives Source:**
   `alternatives` is always drawn directly from the exact same posterior probability distribution (top 3 alternatives) across all conditions.

### Request
```http
POST /classify HTTP/1.1
Content-Type: application/json
X-Request-ID: req-cls-001

{
  "image": "<base64_encoded_image>"
}
```

### Response: Clean Match (`INCOME_CERTIFICATE`)
```json
{
  "value": "INCOME_CERTIFICATE",
  "confidence": 0.96,
  "alternatives": [
    {
      "type": "BONAFIDE",
      "confidence": 0.01
    },
    {
      "type": "CASTE_CERTIFICATE",
      "confidence": 0.01
    },
    {
      "type": "MARKSHEET",
      "confidence": 0.0
    }
  ]
}
```

### Response: Weak / Partial Match (Gradient Demo)
```json
{
  "value": "INCOME_CERTIFICATE",
  "confidence": 0.28,
  "alternatives": [
    {
      "type": "CASTE_CERTIFICATE",
      "confidence": 0.1
    },
    {
      "type": "MARKSHEET",
      "confidence": 0.1
    },
    {
      "type": "FEE_RECEIPT",
      "confidence": 0.1
    }
  ]
}
```

### Response: Zero Match / Unrecognized (1/8 Uniform Prior Floor)
```json
{
  "value": "CASTE_CERTIFICATE",
  "confidence": 0.12,
  "alternatives": [
    {
      "type": "INCOME_CERTIFICATE",
      "confidence": 0.12
    },
    {
      "type": "MARKSHEET",
      "confidence": 0.12
    },
    {
      "type": "FEE_RECEIPT",
      "confidence": 0.12
    }
  ]
}
```

### Classification Accuracy Metrics
- **Accuracy on Sample Suite:** 100% (8/8 canonical document types correctly classified with confidence $\ge 0.70$).
- **Rejection of Out-of-Domain / Garbage:** 100% (unrecognized images yield confidence 0.12, routing directly to human reviewers).
- **Partial Match Sensitivity:** Verified with `test_classification_partial_match` (confidence = 0.28, routing directly to human reviewers).

### Testing Manually via curl
```bash
# Test Document Classification
curl -X POST http://127.0.0.1:8000/classify \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: test-curl-cls" \
  -d '{"image": "<BASE64_DATA>"}'
```

---

## 3. Field Extraction (`POST /extract`)

Extracts structured key-value fields and per-field confidence scores from a document image, given its known or pre-classified document type (or auto-classifying if omitted).

### Approach & Architecture
- **OCR Engine (Tesseract) & Substitution Note:** Tesseract OCR (via `pytesseract`) is used instead of the handover-specified PaddleOCR due to its significantly lighter container footprint, mature offline Hindi and English language pack support (`tessdata`), and simpler architectural guarantee of zero runtime model downloads.
- **Specialized Template Extractors:** Uses raw text extracted by Tesseract combined with dedicated regex/layout extractors for each of the 8 canonical document types. Fixed-layout government and academic certificates do not justify a heavyweight document-transformer model and benefit from deterministic, auditable rules.
- **Per-Field Confidence & Evidence Gradient:** Each extracted field receives an individual certainty score (0.0 to 1.0) calibrated against evidence quality:
  - Clean, fully structured statutory patterns yield high confidence (0.88 - 0.94).
  - Degraded, truncated, or unanchored fields drop meaningfully into the ~0.45 - 0.55 band (demonstrating true continuous gradient).
  - Missing fields return `value: null` and `confidence: 0.0`.
- **Continuous Bayesian Auto-Classification Scaling:** When `document_type` is auto-classified (omitted in request), field confidence scales continuously across the full range [0.0, 1.0] as a joint probability $P(\text{Field is valid}) = P(\text{Field} \mid \text{Type}) \times P(\text{Type})$ rather than an arbitrary step-function cliff at `classify_min_confidence`. If $P(\text{Type}) < \text{classify\_min\_confidence}$ (0.40), the response additionally sets `low_confidence_auto_classification: true` to alert callers to flag the document for human review.
- **Field Catalog per Document Type:**
  - `INCOME_CERTIFICATE`: `family_income_annual`, `issued_date`, `certificate_number`, `applicant_name`
  - `CASTE_CERTIFICATE`: `category`, `certificate_number`, `issued_date`, `applicant_name`
  - `MARKSHEET`: `roll_number`, `candidate_name`, `percentage`, `marks_obtained`, `total_marks`, `passing_year`
  - `FEE_RECEIPT`: `receipt_number`, `transaction_id`, `amount_paid`, `payment_date`, `student_name`
  - `BANK_PASSBOOK`: `account_number`, `ifsc_code`, `account_holder_name`, `bank_name`
  - `BONAFIDE`: `student_name`, `institution_name`, `academic_year`, `issued_date`
  - `DISABILITY_CERT`: `disability_percentage`, `disability_type`, `certificate_number`, `applicant_name`
  - `OFFER_LETTER`: `candidate_name`, `annual_ctc`, `joining_date`, `designation`

### Request
```http
POST /extract HTTP/1.1
Content-Type: application/json
X-Request-ID: req-ext-001

{
  "image": "<base64_encoded_image>",
  "document_type": "INCOME_CERTIFICATE"
}
```
*(Note: `document_type` is optional; if omitted, the service auto-classifies the document first.)*

### Response (Clean `INCOME_CERTIFICATE` Example)
```json
{
  "value": {
    "family_income_annual": 268000,
    "issued_date": "2025-03-14",
    "certificate_number": "INC-JH-2025-04471",
    "applicant_name": "Rahul Kumar"
  },
  "confidence": {
    "family_income_annual": 0.93,
    "issued_date": 0.9,
    "certificate_number": 0.91,
    "applicant_name": 0.88
  },
  "raw_text": "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT\nINCOME CERTIFICATE (आय प्रमाण पत्र)\nCertificate No: INC-JH-2025-04471\nThis is to certify that annual family income from all sources of Shri Rahul Kumar\nis Rs. 2,68,000 (Rupees Two Lakh Sixty Eight Thousand Only) per annum.\nIssued by: Tahsildar, Ranchi Sadar Date: 14/03/2025",
  "document_type": "INCOME_CERTIFICATE",
  "document_type_confidence": 1.0,
  "low_confidence_auto_classification": false
}
```

### Response (Degraded Field Gradient Example — Truncated Cert No)
```json
{
  "value": {
    "family_income_annual": 268000,
    "issued_date": "2025-03-14",
    "certificate_number": "4471",
    "applicant_name": "Rahul Kumar"
  },
  "confidence": {
    "family_income_annual": 0.93,
    "issued_date": 0.9,
    "certificate_number": 0.49,
    "applicant_name": 0.88
  },
  "raw_text": "...",
  "document_type": "INCOME_CERTIFICATE",
  "document_type_confidence": 1.0,
  "low_confidence_auto_classification": false
}
```

### Response (Missing Field Example — Omitted Certificate No)
```json
{
  "value": {
    "family_income_annual": 268000,
    "issued_date": "2025-03-14",
    "certificate_number": null,
    "applicant_name": "Rahul Kumar"
  },
  "confidence": {
    "family_income_annual": 0.93,
    "issued_date": 0.9,
    "certificate_number": 0.0,
    "applicant_name": 0.88
  },
  "raw_text": "...",
  "document_type": "INCOME_CERTIFICATE",
  "document_type_confidence": 1.0,
  "low_confidence_auto_classification": false
}
```

### Response (Low-Confidence Auto-Classify Policy Example)
```json
{
  "value": {
    "category": null,
    "certificate_number": null,
    "issued_date": "2024-01-10",
    "applicant_name": null
  },
  "confidence": {
    "category": 0.0,
    "certificate_number": 0.0,
    "issued_date": 0.11,
    "applicant_name": 0.0
  },
  "raw_text": "...",
  "document_type": "CASTE_CERTIFICATE",
  "document_type_confidence": 0.12,
  "low_confidence_auto_classification": true
}
```

### Testing Manually via curl
```bash
# Test Field Extraction
curl -X POST http://127.0.0.1:8000/extract \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: test-curl-ext" \
  -d '{"image": "<BASE64_DATA>", "document_type": "INCOME_CERTIFICATE"}'
```

---

## 4. Cross-Document Consistency Gate (`POST /consistency`)

Evaluates whether two or more documents submitted as part of the same scholarship application belong to the same applicant (name matching, date-of-birth matching).

### Approach & Architecture
- **Multi-Factor Indian Name Matching:**
  - **Spacing / Compounding:** Handles common name concatenations (e.g., `"Ram Kumar"` $\leftrightarrow$ `"Ramkumar"` $\to 0.95$).
  - **Continuous Initial Expansion:** Resolves initials via a continuous confidence gradient based on character coverage ratio and Jaro-Winkler similarity rather than a static default. Clean expansions (e.g., 2 of 3 words fully spelled out like `"Aditya Vikram Birla"` $\leftrightarrow$ `"A. Vikram Birla"` or `"Ram Kumar"` $\leftrightarrow$ `"R. Kumar"`) score $\approx 0.83$, while marginal expansions with low character coverage (e.g. 1 of 3 words spelled out like `"Aditya Vikram Birla"` $\leftrightarrow$ `"A. V. Birla"`) drop to $\approx 0.71$.
  - **Indian Transliteration & Phonetics:** Normalizes phonetic equivalents via Metaphone, Soundex, and regional transliteration mapping (e.g., `"Laxmi"` $\leftrightarrow$ `"Lakshmi"`, `"Vikas"` $\leftrightarrow$ `"Bikash"`, `"Shreya Sharma"` $\leftrightarrow$ `"Shreya Shrama"` $\to 0.92 - 0.95$).
  - **Middle Name Inclusion/Omission:** Token subset logic (e.g., `"Amit Kumar Shinde"` $\leftrightarrow$ `"Amit Shinde"` $\to 0.88$).
  - **Honorific Stripping:** Disregards standard prefixes (`Shri`, `Smt`, `Mr`, `Ms`, `Dr`).
- **Flexible Document Ingestion:** Accepts nested document records (`{"documents": [{"document_type": "...", "fields": {...}}]}`) or flat field sets.
- **Never Auto-Fail on Mismatch:** In accordance with VIDYASETU Rule #0, a name or DOB mismatch **never** triggers an HTTP error or auto-rejects the application. The endpoint returns `HTTP 200 OK` with a calibrated low confidence score (e.g. `0.36`), enabling the upstream rules engine to route the application to a human officer.

### Request
```http
POST /consistency HTTP/1.1
Content-Type: application/json
X-Request-ID: req-con-001

{
  "documents": [
    {
      "document_type": "INCOME_CERTIFICATE",
      "applicant_name": "Ram Kumar",
      "dob": "2002-05-14"
    },
    {
      "document_type": "MARKSHEET",
      "candidate_name": "Ramkumar",
      "dob": "14/05/2002"
    }
  ]
}
```

### Response (High Consistency Match)
```json
{
  "value": {
    "names_match": true,
    "dob_match": true
  },
  "confidence": {
    "names_match": 0.95,
    "dob_match": 1.0
  },
  "details": {
    "compared_values": [
      "Ram Kumar",
      "Ramkumar"
    ],
    "name_match_types": [
      "Ram Kumar <-> Ramkumar: SPACING_VARIANT"
    ],
    "compared_dobs": [
      "2002-05-14",
      "14/05/2002"
    ],
    "dob_match_types": [
      "2002-05-14 <-> 14/05/2002: EXACT_DOB_MATCH"
    ]
  }
}
```

### Response (Initial Expansion Match — Handover Benchmark)
```json
{
  "value": {
    "names_match": true
  },
  "confidence": {
    "names_match": 0.83
  },
  "details": {
    "compared_values": [
      "Ram Kumar",
      "R. Kumar"
    ],
    "name_match_types": [
      "Ram Kumar <-> R. Kumar: INITIAL_EXPANSION"
    ]
  }
}
```

### Response (Mismatch — Non-Fatal Confidence Output)
```json
{
  "value": {
    "names_match": false,
    "dob_match": false
  },
  "confidence": {
    "names_match": 0.36,
    "dob_match": 0.0
  },
  "details": {
    "compared_values": [
      "Rahul Singh",
      "Rohit Sharma"
    ],
    "name_match_types": [
      "Rahul Singh <-> Rohit Sharma: DIFFERENT_NAME"
    ],
    "compared_dobs": [
      "2001-08-10",
      "1998-04-30"
    ],
    "dob_match_types": [
      "2001-08-10 <-> 1998-04-30: DOB_MISMATCH"
    ]
  }
}
```

### Testing Manually via curl
```bash
# Test Cross-Document Consistency
curl -X POST http://127.0.0.1:8000/consistency \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: test-curl-con" \
  -d '{
    "documents": [
      {"name": "Ram Kumar", "dob": "2002-05-14"},
      {"name": "R. Kumar", "dob": "14/05/2002"}
    ]
  }'
```

---

## 5. Health Check (`GET /health`)

Reports the operational status of the service, offline models directory resolution, and the readiness of internal processing engines.

### Architecture Note on Engine Readiness
- The 4 core processing engines (`quality_gate`, `classifier`, `extractor`, `consistency_checker`) are deterministic in-memory rule/algorithmic engines defined directly in code (`app.services.*`) and do not require external weight checkpoints (`.bin`/`.onnx`) to be operational. They are immediately `"ready"` upon container start.
- `modelsDirExists` and `modelsPresent` inspect the offline asset storage (`app/models`), verifying that the local directory exists and contains offline assets (e.g. `README.md` or dictionaries).

### Request
```http
GET /health HTTP/1.1
```

### Response
```json
{
  "status": "ok",
  "modelsDirExists": true,
  "modelsPresent": true,
  "models": {
    "quality_gate": "ready",
    "classifier": "ready",
    "extractor": "ready",
    "consistency_checker": "ready"
  },
  "environment": "production"
}
```

---

## 6. Deployment & Verification Status

### Open Integration Risk: Docker + No-Internet Container Verification
> [!WARNING]
> **Docker Desktop unavailable on this dev machine; the mandatory docker compose up + no-internet urlopen check has NOT been run and remains an open item before merge — must be executed on the integration machine before this track is considered done.**

**Detailed Context & Rationale:**
- **Code Audit:** A static audit of the first-party codebase (`ml/app/`) confirms zero network imports (`requests`, `urllib.request`, `httpx`, `socket`, `aiohttp`).
- **Dependency Isolation Warning:** Static grepping only proves that this service's own application code makes no outbound calls. It does **not** prove whether third-party runtime dependencies (specifically Tesseract / `pytesseract` and native C libraries) attempt to fetch external resources or call home at runtime — which is the exact failure mode this test is designed to catch. (PaddleOCR is not used anywhere in this service; Tesseract is the sole OCR engine deployed).
- **Mandatory Pre-Merge Action:** The integration machine must run the actual handover verification check against the running container:
  ```bash
  docker compose up -d --build ml
  docker compose exec ml python -c "import urllib.request; urllib.request.urlopen('http://google.com', timeout=3)"
  ```
  This command is expected to fail with a network/DNS resolution error (`URLError` / `gaierror`), verifying that the container operates under strict network isolation. Only when this passes on the integration machine can this track be considered complete.



