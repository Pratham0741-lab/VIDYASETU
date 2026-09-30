# VIDYASETU demo dataset

This is a small, realistic, synthetic dataset for the prototype video. It is data only: no
backend code, migration or configuration was changed to load it. It was loaded through the real
API routes, so encryption, match hashes, audit rows and row-level security behave as in
production. The one exception is the labelled backdating step described below.

**Files**
- `scripts/demo/seed-demo.mjs` loads the dataset.
- `scripts/demo/check-demo.mjs` is a read-only check: counts plus the dashboards as a state officer.
- `scripts/demo/render_docs.py` renders the synthetic documents.
- `scripts/demo/ocr_showcase.py` runs real OCR on library documents; no applicant is involved.

**Local state (outside the repository, in `../.demo-seed/` next to the repo)**
- `demo.env`: the demo password, plus the SUPER_ADMIN used to provision officers.
- `state.json`: the seed's ledger of refresh tokens and completed steps.
- `logins.md`: every demo account and its scenario.
- `docs/`: the rendered document images.
- `pre-demo-2026-09-29.dump`: the database snapshot taken before anything was loaded.

## Snapshot, restore and reset

A snapshot of the whole database was taken **before** anything was loaded:

```
../.demo-seed/pre-demo-2026-09-29.dump
```

It is a `pg_dump -Fc` file of 3,416,622 bytes, sha256 `8f07b59170c094cbd27c288620576c46ac816ef10812115014eef847603fc5e9`. At snapshot time it held applications 187, accounts 178 and audit_logs 4573.

**Restore it**, which removes the demo data and returns the database exactly to the snapshot. Run from the repository root:

```bash
docker compose stop api
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction --exit-on-error' < ../.demo-seed/pre-demo-2026-09-29.dump
docker compose up -d api
```

**Reset the demo** (restore, then load again):

```bash
rm -f ../.demo-seed/state.json ../.demo-seed/logins.md   # tokens and ledger of the removed data
node scripts/demo/seed-demo.mjs                        # ~25 min on a laptop; safe to run again
node scripts/demo/check-demo.mjs                       # what was loaded + dashboards as a state officer
```

This restore was run twice while building the demo; both times the counts came back to 187 / 178 / 4573 and both audit chains verified. Documents that were uploaded to MinIO for removed rows stay in the bucket as unreferenced objects, which is harmless. Redis holds no demo data.

**Preconditions.**
- The stack is running (`docker compose up -d`).
- `demo.env` holds `DEMO_PASSWORD`, plus `ADMIN_EMAIL` / `ADMIN_PASSWORD` of an existing SUPER_ADMIN.
- The API cannot create a SUPER_ADMIN (by design; see `api/scripts/create-super-admin.ts`), so the seed uses an existing one.

## What was loaded (counts)

Every demo account is `<name>.demo@example.org`. Nothing is tagged in `test_fixtures`, so analytics show the demo data by default. The existing test fixtures are untouched and still excluded.

| Table | Demo rows |
|---|---|
| accounts (15 officers + 60 applicants) | 75 |
| consent records (3 purposes x 60, notice 2026-10-v1) | 180 |
| applications (academic year 2025-26) | 60 |
| documents (generated, synthetic) | 684 |
| workflow transitions / decision records | 173 / 111 (8 decisions from bulk actions) |
| deficiencies / items | 6 / 10 |
| fraud flags | 4 |
| selection lists (final) / entries / committee decisions | 3 / 28 / 7 |
| selections (11 confirmed) / sanction orders | 28 / 11 |
| disbursement instalments | 27 |
| renewals (1 approved, 1 pending) | 2 |
| SLA breaches recorded by the sweep | 37 |
| notifications to demo accounts | 4,898 |
| demo rows tagged as fixtures | 0 |

**By scheme and stage:**

| Scheme | INO_VERIFIED | DNO_VERIFIED | SNO_VERIFIED | MINISTRY_APPROVED | DEFECTIVE | REJECTED | Total |
|---|---|---|---|---|---|---|---|
| NFST (Ph.D years 1-5) | 2 | 2 | 2 | 12 | 1 | 1 | 20 |
| TOP_CLASS | 4 | 2 | 2 | 7 | 2 | 1 | 18 |
| POST_MATRIC | 6 | 3 | 1 | 9 | 2 | 1 | 22 |

Stage names follow the workflow: `INO_VERIFIED` means the application is waiting for the institute officer, `DNO_VERIFIED` for the district officer, and so on.

**Where the applicants come from.** Three districts of Jharkhand (Gumla, Khunti, Lohardaga) and eight **synthetic** institutions, JH-GUM-01..03, JH-KHU-01..02 and JH-LOH-01..03, with 5-10 applications each.

**Academic year: 2025-26.**
- No test fixture uses this year. So the selection lists, fairness view and funnel contain only demo applicants.
- The academic year on an application is free text. It is not tied to scheme version dates.
- The renewals are for 2026-27.

**Money:**
- NFST pays quarterly: 5 sanction orders give 20 instalments, and the renewal approved for 2026-27 adds 4, so 24 in all (Rs 27.24 lakh).
- TOP_CLASS pays yearly: 3 instalments (Rs 1.23 lakh).
- POST_MATRIC is **forwarded to the State** for payment: its 3 sanction orders have no platform instalments. The funnel shows these awards as `state_dbt`.
- Every instalment is PENDING. No payment has been initiated.

## Scenarios (who shows what)

The full list, with emails, is in `../.demo-seed/logins.md`. The applicants the click-path uses:

| Key | Applicant (synthetic) | Scheme | What it shows |
|---|---|---|---|
| A01 | a01.kusum.beck.demo@example.org (Hindi) | NFST year 1 | selected -> confirmed -> sanctioned -> quarterly schedule; renewal for 2026-27 **approved** |
| A02 | a02.prem.bage.demo@example.org (Hindi) | NFST year 2 | sanctioned; renewal for 2026-27 **submitted, pending** (endorse live) |
| A22 / A49 | a22.reshma.tigga / a49.reshma.tigga | TOP_CLASS / POST_MATRIC | **benign look-alike**: same name, different date of birth, district and bank account - **no flag** |
| A23 | a23.niranjan.dang (Hindi) | TOP_CLASS | refused by the automatic eligibility gate (income above the Rs 6 lakh ceiling) -> DEFECTIVE |
| A27 | a27.leela.dang (Hindi) | TOP_CLASS | **committee override**: computed SELECTED, excluded with a reason -> final NOT_SELECTED |
| A36, A58 | a36.darsan.tigga, a58.kamla.tigga | TOP_CLASS, POST_MATRIC | itemised deficiency: **expired income certificate** (issued 2024-03-12), still DEFECTIVE |
| A37 | a37.rosalin.kispotta | TOP_CLASS | expired certificate -> **resubmitted** a current one -> back with the institute, item RESOLVED |
| A59 | a59.janki.bilung | POST_MATRIC | resubmitted and then verified onward (DNO_VERIFIED) |
| A20, A60 | a20.neha.mahli, a60.sheela.guria | NFST, POST_MATRIC | officer-raised item: ST certificate not attested |
| A53 + A54 | a53.urmila.kongari, a54.bishnu.beck | POST_MATRIC | **one bank account typed two ways** (`SBIN0007781:31245678901` / `sbin0007781 3124-5678-901`) -> SHARED_BANK_ACCOUNT, HIGH, both held |
| A55 + A56 | a55.gyan.tuti, a56.dipti.kispotta | POST_MATRIC | **the same file** uploaded by both -> DUPLICATE_FILE_HASH, HIGH, both held |
| A19, A35, A57 | | NFST, TOP_CLASS, POST_MATRIC | rejected (district / institute) with remarks |

**Officers:**
- Ministry: `ministry.demo@example.org`.
- State nodal officer: `sno.jharkhand.demo@example.org`.
- District nodal officers: `dno.{gumla,khunti,lohardaga}.demo@example.org`.
- Institute nodal officers: `ino.<institution code, lower case>.demo@example.org` (8).
- Committee: `committee.jharkhand.demo@example.org`.
- Auditor: `auditor.jharkhand.demo@example.org`.
- SUPER_ADMIN: the existing `admin.p11@example.org`.

**Password:** every demo account uses `DEMO_PASSWORD` in `../.demo-seed/demo.env`. It is never committed.

**Bulk actions.** Two institute officers (JH-GUM-01, JH-KHU-02) verified their queue with one bulk action each: 8 decisions, which the workload view counts as `bulk_actions = 8`.

## What was backdated (the only owner-level write)

The seed submits the applications in six weekly **waves**: 17, 24 and 31 Aug, and 7, 14 and 24 Sep 2026. At most 4 per institution per wave, below the institution-surge threshold.

After each wave, a labelled SQL block (`backdateWave` in `seed-demo.mjs`, run as the database owner) moves each new demo application back to its planned submission time. Exactly:

- `applications.submitted_at` and `created_at` are shifted.
- `applications.stage_entered_at` / `stage_due_at` are shifted too, but only while the application is still in the stage it entered at submission.
- The `workflow_transitions.created_at` rows written at submission (the automatic eligibility gate) are shifted.
- `documents.created_at` / `updated_at` of the documents uploaded with the submission are shifted.
- Nothing else, and only rows of `*.demo@example.org` applicants.

Because these tables are audited, each shift also appears in the audit log as an UPDATE with no actor. Both chains verify.

**Not backdated:** every officer action (verification, deficiency, selection, sanction) happened on the day of seeding. So:
- The **SLA view** shows long institute stages: a median of about 28 days, with 48 of 49 completed stays past the 7-day SLA.
- The district and state stages show 0-hour stays.
- The funnel and the submission counts are spread over the six weeks.

## Click-path

There is no web front end connected to the API yet: `FRONTEND/` holds design mockups only. Every step below is shown in the **Swagger UI** at `http://127.0.0.1:3000/docs`:
1. Log in with `POST /api/v1/auth/login` (email + password).
2. Press **Authorize** and paste the `access_token`.

The path is written without the `/api/v1` prefix. Replace each `<id>` with the application id from the previous step's response.

| # | Login | Screen (route) | Expected result | ML |
|---|---|---|---|---|
| 1 | a01.kusum.beck (applicant) | `GET /applicants/me`, `GET /applicants/me/consents`, `GET /notifications` | profile with masked identifiers; 3 consents GIVEN for notice 2026-10-v1 (Hindi texts); notices in Hindi | mock ok |
| 2 | a01 | `GET /applications`, then `GET /applications/<id>/documents` | one NFST 2025-26 application, MINISTRY_APPROVED; the checklist filled with generated documents, each with extracted fields | extracted values: mock reads them from the file's marker; **real ML** reads them from the pixels |
| 3 | a01 | `GET /applicants/me/data-export` | the applicant's own data, identifiers masked, exclusions stated | mock ok |
| 4 | ino.jh-khu-02 (institute) | `GET /applications/queue`, then `GET /applications/<id>/sla-status` | the applications waiting at the institute stage in Khunti district (3; the scope is the district, see below); the stage due date of one | mock ok |
| 5 | ino.jh-loh-03 | `GET /applications/<A36>/deficiencies` | one itemised deficiency: income certificate expired (issued 2024-03-12) | mock ok; the **marked crop** of the problem area needs **real ML** (mock returns no boxes) |
| 6 | ino.jh-khu-02 | `GET /applications/<A37>/deficiencies` | the same problem, RESOLVED after the applicant uploaded a current certificate; application back at the institute | mock ok |
| 7 | ino.jh-khu-01 | `GET /applications/<A53>/fraud-flags`; then `POST /applications/<A53>/verify` | SHARED_BANK_ACCOUNT, HIGH, held; the verify is refused with 409 FRAUD_REVIEW_PENDING (a recorded denial) | mock ok |
| 8 | ino.jh-gum-01 | `GET /applications/<A55>/fraud-flags` | DUPLICATE_FILE_HASH, HIGH (same file as A56) | mock ok |
| 9 | ino.jh-loh-03 / ino.jh-khu-01 | `GET /applications/<A22>/fraud-flags`, `<A49>` | no flags: same name, different person | mock ok |
| 10 | committee.jharkhand | `GET /selection-lists?academic_year=2025-26`, `GET /selection-lists/<TOP_CLASS list>` | three FINAL_PUBLISHED lists; in TOP_CLASS, A27 computed SELECTED, committee EXCLUDE with its reason, final NOT_SELECTED | mock ok |
| 11 | ministry.demo | `GET /selections?scheme=NFST&academic_year=2025-26`; `GET /sanction-orders/<id>`, `GET /sanction-orders/<id>/pdf` | confirmed selections; the sanction order, its SHA-256 and QR code | mock ok |
| 12 | ministry.demo | `GET /applications/<A01>/disbursements` (NFST), `<TOP_CLASS sanctioned>`, `<POST_MATRIC sanctioned>` | NFST: quarterly instalments; TOP_CLASS: one yearly; POST_MATRIC: none (forwarded to the State) | mock ok |
| 13 (live) | ministry.demo | `POST /disbursements/<an NFST instalment>/initiate` | the instalment goes to PFMS (**mock adapter**); the funnel's `disbursed` becomes 1 | mock PFMS |
| 14 (live) | ino.jh-loh-02, then ministry.demo | `POST /renewals/<A02 renewal>/endorse`, `POST /renewals/<id>/continuation-check`, `POST /renewals/<id>/decide` | the pending year-3 renewal endorsed, checked against the frozen tenure rule, approved; 4 more quarterly instalments | mock ok |
| 15 | sno.jharkhand (state) | `GET /analytics/funnel?from=2026-08-01&to=2026-10-31` | submitted 60, verified 28, selected 28, sanctioned 11, disbursed 0 (before step 13), state_dbt 9, held 4 | mock ok |
| 16 | sno.jharkhand | `GET /analytics/sla?…`, `GET /analytics/fraud?…`, `GET /analytics/workload?…` | SLA stays and breaches per stage; 2 fraud types / 4 held; officer actions by role, bulk_actions 8 | mock ok |
| 17 | sno.jharkhand | `GET /analytics/fairness?scheme=NFST&academic_year=2025-26` (and TOP_CLASS, POST_MATRIC); `…/export.pdf` | NFST: 20 applied, 12 selected; breakdowns by category, gender, PwD status, district and institution type, small cells suppressed; PDF export | mock ok |
| 18 | auditor.jharkhand | `GET /audit/verify`, `GET /document-access`, `GET /authorization-denials` | both chains verify; who viewed which document; refused actions (step 7 among them) | mock ok |
| 19 (optional) | none (ml container) | `scripts/demo/ocr_showcase.py` on a library document | real OCR on a real scanned certificate: type, fields, confidence | **real OCR** |

The generated documents carry both the text drawn in the pixels and a mock marker with the same values:
- With `ML_MODE=mock` (the default and current setting), the extracted values come from the marker.
- With `ML_MODE=real` (in `.env`, then `docker compose up -d api`), the real OCR reads the same values from the pixels.

The seed was run in mock mode. Its data do not change if ML is switched afterwards.

### Real-library documents: OCR showcase set (separate)

The scanned documents under `docs/` are **not** attached to any demo applicant, and they are not in git:
- 10TH_CERTIFICATES 29, 12TH_CERTIFICATES 32, ADMISSION_LETTERS 31, BANK_PASSBOOKS 23;
- BONAFIDE_CERTIFICATES 27, DISABILITY_CERTIFICATES 18, FEE_STRUCTURE 32, INCOME_CERTIFICATES 27, ST_CERTIFICATES 24.

They are only for step 19: real OCR straight through the ml service. They may identify real people, so show them only as the recording needs.

## What the demo must not claim

- **SLA durations are placeholders:** 7 / 7 / 10 / 15 / 15 days, hard-coded in `STAGE_SLA_DAYS` with no scheme source. The SLA picture is also shaped by backdating submissions only (see above).
- **Hindi texts are machine-drafted and unreviewed:** notices, consent texts and messages (docs/TRANSLATION_REVIEW.md). The consent texts also need legal review.
- **Erasure is recorded only:** nothing is deleted on request (docs/PRIVACY.md, M70).
- **Documents and ML:**
  - The applicants' documents are synthetic, generated images, and "extraction" in the recorded run is the mock (ML_MODE=mock).
  - Real OCR is shown only in step 19, on library documents.
  - Fraud scores and fuzzy identity matching are uncalibrated (hand-built cases only).
- **External services:**
  - PFMS, DigiLocker, NSP and Aadhaar authentication are **mock adapters**.
  - No money moves. Every instalment is a schedule; an "initiated" payment goes to the mock PFMS.
- **Front end:** no connected web front end exists yet. The screens are the API (Swagger).
- **Institutions and people are invented:**
  - Names, institutions and certificate numbers are synthetic. No real person's data is in the applicant records.
  - The institute officer's scope is the district. `institution_code` is recorded but does not restrict what an institute officer sees.
- **Selection:**
  - NFST ranks without a seat cap, so every approved applicant is selected.
  - The committee closed each objection window early, with a reason. No objections were filed.
- **Operations:**
  - The retention job is off (RETENTION_ENABLED=false).
  - Rate limits are per instance.
  - The known limitations in docs/KNOWN_LIMITATIONS.md apply.

## Notes from building the seed

- **API only, except one step.** The only owner-level write is the labelled backdating above.
- **SUPER_ADMIN.** It cannot be created through the API, so the existing `admin.p11@example.org` (a tagged test fixture) provisions the demo officers. It is not part of the demo data.
- **A23's income.** The first draw registered A23 with income above TOP_CLASS's ceiling. Registration income cannot be changed through the API, so A23 is the demo's gate-refused applicant; the other TOP_CLASS incomes stay under the ceiling. This is fixed in the plan, so a fresh load gives the same result.
- **Checklists name documents twice.** Each scheme's checklist names most documents both ways, by a descriptive label and by a canonical key (e.g. `income_certificate`). Every required slot gets its own generated document, and "(if applicable)" slots are left empty.
- **Mock identifier defaults.** In mock mode every income certificate would read `MOCK-INC-0001` and every passbook one `MOCK` account unless the file says otherwise. The seed gives each document the applicant's own numbers; without that, the certificate-number detector matches everyone.
- **Detection timing.** Fraud detection runs at workflow transitions and before forward actions. The duplicate-file pair waits at the institute, so its institute officer runs the fraud checks once (`POST /applications/:id/fraud-checks`).
- **Reads are logged.** Reading an application's documents is itself a logged view. Once an applicant's documents are complete, the seed notes it in its ledger and does not read them again, so a second run writes nothing.
- **Fixture tagging check.** The Phase 14-17 "zero untagged fixtures" check counts every untagged row. It now also counts the demo rows, which are deliberately untagged.

## Proof (2026-09-29)

| Check | Result |
|---|---|
| Second run changes nothing | `changes made by this run: none`; row counts of 22 tables and the audit head (seq 8001, hash 859fc3f7…) identical before and after |
| Dashboards as the state officer | funnel, SLA, fraud, workload and fairness (all three schemes) return non-empty numbers: `node scripts/demo/check-demo.mjs` |
| Audit verifier, both chains | CLI `scripts/verify-audit-chain.ts`: ok, audit 8001 rows, denials 133 rows, no break; `GET /audit/verify` as the demo auditor: ok |
| RBAC matrix and full e2e | `npm run test:e2e` with the demo data loaded: 3 suites, 1232 tests passed (RBAC matrix 135 routes x 9 principals included) |
