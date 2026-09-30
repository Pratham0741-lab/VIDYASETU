# VIDYASETU - phase map (audit of what is actually built)

Audit date: 2026-09-28, at commit `01b53e6` (clean tree). Read-only: no code,
config, migration, seed, data or test was changed; SQL was SELECT-only
(read-only transactions). This file is the only thing the audit wrote.

> The audit below is kept as recorded. What changed after it (Phases 13A,
> 13B, 13C, 13D, 13E, the Phase 14 loose ends and Phase 16) is listed in **Updates after the audit** at the end of this file.

Status words: **BUILT** (evidence cited), **MISSING** (searched, not found),
**UNSURE** (reason given). Phase status: DONE / PARTIAL / NOT STARTED / UNSURE.
"Ours N" = the running phase number used while building (from migration
headers and code comments), which diverged from the 18-phase plan.

---

## Step 1 - Inventory

### 1.1 API routes (67)

58 role-guarded routes, taken from `api/test/rbac-matrix.e2e-spec.ts`, which
fails (`covers exactly the set of non-public routes the app exposes`) if any
non-public route lacks a row; 9 public routes from `@Public()` in the
controllers. Roles: `APPLICANT`, `INSTITUTE_NODAL_OFFICER` (INO),
`DISTRICT_NODAL_OFFICER` (DNO), `STATE_NODAL_OFFICER` (SNO),
`MINISTRY_OFFICER` (MIN), `SUPER_ADMIN` (SA). REVIEWERS = MIN, SNO, DNO, INO
(`api/src/auth/roles.ts`).

| Module | Method | Path | Roles |
|---|---|---|---|
| health | GET | /health/live, /health/ready | PUBLIC |
| auth | POST | /api/v1/auth/register, /login | PUBLIC (throttled 5/60 s) |
| auth | POST | /api/v1/auth/refresh, /logout | PUBLIC |
| auth | GET | /api/v1/auth/me | all six roles |
| schemes | POST | /api/v1/schemes/check-eligibility | PUBLIC (30/60 s) - reverse eligibility |
| schemes | POST | /api/v1/schemes/:code/versions/:version/check-eligibility | PUBLIC (30/60 s) |
| schemes | GET | /api/v1/schemes/:code/versions/:version/form-schema | PUBLIC (60/60 s) |
| schemes | POST | /api/v1/schemes/:code/academic-years/:year/run-selection | MIN |
| admin | POST | /api/v1/admin/officers | SA |
| applications | GET | /api/v1/applications, /:id | APPLICANT + REVIEWERS |
| applications | POST | /api/v1/applications | APPLICANT |
| applications | POST | /:id/evaluate-eligibility | APPLICANT + REVIEWERS |
| applications | POST | /:id/assign-to-me | REVIEWERS |
| applications | GET | /queue, /sla-breaches | REVIEWERS |
| applications | GET | /:id/sla-status | APPLICANT + REVIEWERS |
| applications | POST | /:id/verify, /reject, /mark-defective | REVIEWERS |
| applications | POST | /:id/resubmit | APPLICANT |
| applications | POST | /:id/documents | APPLICANT |
| applications | GET | /:id/documents | APPLICANT + REVIEWERS |
| applications | GET | /:id/nsp-duplicate-check | REVIEWERS |
| applications | GET | /:id/fraud-flags | REVIEWERS |
| applications | POST | /:id/fraud-checks | REVIEWERS |
| applications | GET | /:id/disbursements, /:id/renewals | APPLICANT + REVIEWERS |
| applications | POST | /:id/renewals | APPLICANT |
| documents | GET | /api/v1/documents/:id | APPLICANT + REVIEWERS |
| documents | POST | /api/v1/documents/:id/confirm | REVIEWERS |
| fraud | POST | /api/v1/fraud/backfill | SA |
| fraud-flags | POST | /api/v1/fraud-flags/:id/disposition | REVIEWERS |
| authorization-denials | GET | /api/v1/authorization-denials | SA, MIN, SNO, DNO |
| notifications | GET | /api/v1/notifications | all six roles |
| notifications | POST | /api/v1/notifications/:id/read | all six roles |
| selections | POST | /api/v1/selections/:id/confirm, /sanction-order, /disbursements | MIN |
| sanction-orders | GET | /api/v1/sanction-orders/:id, /:id/pdf | APPLICANT + REVIEWERS |
| sanction-orders | POST | /api/v1/sanction-orders/verify | all six roles |
| disbursements | POST | /api/v1/disbursements/:id/initiate, /reconcile | MIN |
| renewals | POST | /api/v1/renewals/:id/endorse | INO |
| renewals | POST | /api/v1/renewals/:id/continuation-check, /decide | MIN |
| grievances | POST | /api/v1/grievances | APPLICANT |
| grievances | GET | /api/v1/grievances, /:id | APPLICANT + REVIEWERS |
| grievances | POST | /api/v1/grievances/:id/start, /resolve | REVIEWERS |
| analytics | GET | /api/v1/analytics/{funnel,sla,schemes,disbursements,fraud,jurisdiction} and each `/export.csv` (12) | SA + REVIEWERS |

OpenAPI: `api/src/openapi/swagger.ts` (`SwaggerModule.setup`), export script
`npm run openapi`. The OpenAPI JSON was **not regenerated** in this audit
(it would write `api/openapi.json`).

### 1.2 Migrations (19, in order)

| # | Migration | What it does |
|---|---|---|
| 1 | 20260926000000_init_scheme_schema | Initial schema: roles, officers, applicants, schemes, scheme_versions, applications, documents, document_extractions, decision_records, deficiencies, selections, scores, disbursements, renewals, audit_logs, notice_templates; extensions; RLS; audit trigger |
| 2 | 20260926010000_fixes_jsonschema_hashchain_refs | JSON-schema preflight + PL/pgSQL fallback; audit hash-chain advisory lock |
| 3 | 20260926020000_config_predicate_format_and_hardening | Predicate/rules config validation; scheme_versions immutability trigger |
| 4 | 20260926030000_app_user_role_and_audit_immutability | Non-superuser `app_user`; audit_logs UPDATE/DELETE/TRUNCATE refused by triggers; actor from `app.*` settings |
| 5 | 20260926040000_audit_actor_user_id | Separates acting user id from officer id in audit rows |
| 6 | 20260926050000_accounts_and_refresh_tokens | Ours Phase 2: `accounts` (argon2 hash), `refresh_tokens` |
| 7 | 20260926060000_rule_evaluations | Ours Phase 3: `rule_evaluations` (per-rule evidence; NULL application for reverse eligibility) |
| 8 | 20260926070000_workflow_state_machine | Ours Phase 4: stage SLA columns, `workflow_transitions`, status-from-stage CHECK |
| 9 | 20260926080000_selection_reservations | Ours Phase 6: selection/score columns for merit, quota, reservations |
| 10 | 20260926090000_document_intelligence | Ours Phase 7: document upload facts, extraction/review columns |
| 11 | 20260927010000_notifications | Ours Phase 8: `notifications` (per recipient + channel delivery) |
| 12 | 20260927020000_post_selection | Ours Phase 9: `sanction_orders`, `grievances`, renewal/disbursement columns, RLS |
| 13 | 20260928010000_authorization_denials | `authorization_denials` (tamper-evident record of refused privileged actions) |
| 14 | 20260928020000_digilocker_documents | Ours Phase 10: DigiLocker-verified documents |
| 15 | 20260928030000_fraud_detection | Ours Phase 11: `pii_match_index`, `fraud_flags`, SYSTEM-only facts functions |
| 16 | 20260928040000_phase11_5_hardening | `fraud_refresh_surge_flag()`; `test_fixtures` |
| 17 | 20260928050000_test_fixtures_documents | `test_fixtures` accepts `document` |
| 18 | 20260928060000_scheme_disbursement_mode | Ours Phase 12 A: `schemes.disbursement_mode` |
| 19 | 20260928070000_analytics_indexes | Ours Phase 12 B: index `applications(submitted_at, scheme_id)` |

### 1.3 Tables (28) and row-level security

RLS **enabled (13)**: applications, authorization_denials, decision_records,
deficiencies, disbursements, documents, fraud_flags (3 policies), grievances,
pii_match_index, renewals, sanction_orders, scores, selections. None is FORCE.

RLS **not enabled (15)**: _prisma_migrations, accounts, applicants,
audit_logs, document_extractions, notice_templates, notifications, officers,
refresh_tokens, roles, rule_evaluations, scheme_versions, schemes,
test_fixtures, workflow_transitions. (`audit_logs` is protected by triggers
and grants instead; `workflow_transitions` and `rule_evaluations` are
unscoped for `app_user` - KNOWN_LIMITATIONS M25.)

Roles in the database: `app_user` (runtime, no BYPASSRLS), `vidyasetu`
(owner, superuser). No read-only role.

### 1.4 Background jobs, queues, domain events

- **BullMQ**: one queue, `DOCUMENT_PIPELINE_QUEUE`
  (`api/src/documents/document-pipeline.queue.ts`): 4 attempts, exponential
  backoff 2 s, `removeOnFail: 1000`; worker in the same class.
- **Schedulers / cron / intervals**: none (`grep` for `@Cron`, `setInterval`,
  `new Queue`, `new Worker` finds only the pipeline queue). So no scheduled
  SLA-breach sweep, retention job or reconciliation job.
- **Domain events** (`api/src/events/domain-events.ts`, in-process, emitted
  after the actor transaction commits):

| Event | Emitted by | Consumed by |
|---|---|---|
| workflow.transition | workflow.service.ts | notification.listener.ts, fraud-detection.service.ts |
| documents.quality_rejected | documents.service.ts | notification.listener.ts |
| documents.needs_review | document-pipeline.processor.ts | notification.listener.ts |
| documents.consistency_evaluated | document-pipeline.processor.ts | notification.listener.ts |
| documents.eligibility_mismatch | document-pipeline.processor.ts, documents.service.ts | notification.listener.ts |
| selection.run_completed | selection.service.ts | notification.listener.ts |
| grievances.status_changed | grievance.service.ts | notification.listener.ts |

### 1.5 ML service (FastAPI, `ml/app`)

| Endpoint | What it does today |
|---|---|
| GET /health | liveness |
| POST /v1/documents/quality | OpenCV quality gate (blur, glare, cut-off edge, resolution) |
| POST /v1/documents/classify | OpenCV + OCR-keyword heuristic scoring per document type (no trained model) |
| POST /v1/documents/extract | Tesseract OCR (eng + hin packs installed in the image) + regex field extraction with confidences |
| POST /v1/documents/consistency | Cross-document name (phonetic / fuzzy: jellyfish, rapidfuzz) and DOB checks |

`ml/app/models/` contains only a README (no model files). The api uses the
ML service only when `ML_MODE=real`; the default is `mock`
(`api/src/config/env.schema.ts`, `api/src/ml-client/mock-ml.service.ts`).

### 1.6 Schemes and versions (database = seed)

| Scheme | Type | Disbursement mode | Versions (status) | Apps on active |
|---|---|---|---|---|
| NFST | CENTRAL_SECTOR | SCHEDULED_BY_PLATFORM | v1-v4 archived, **v5 active** (2026-09-28) | 2 (v4: 1) |
| NOS | CENTRAL_SECTOR | SCHEDULED_BY_PLATFORM | v1 archived, **v2 active** | 0 |
| POST_MATRIC | CENTRALLY_SPONSORED | FORWARDED_TO_STATE | v1 archived, **v2 active** | 60 |
| PRE_MATRIC | CENTRALLY_SPONSORED | SCHEDULED_BY_PLATFORM | v1-v3 archived, **v4 active** | 0 |
| TOP_CLASS | CENTRAL_SECTOR | SCHEDULED_BY_PLATFORM | v1-v2 archived, **v3 active** | 5 |

16 versions; `validate:rules`: 16 versions, 75 rules, 0 parameter mismatches.
`roles` table: DISTRICT_NODAL_OFFICER, INSTITUTE_NODAL_OFFICER,
MINISTRY_OFFICER, STATE_NODAL_OFFICER, SUPER_ADMIN (seeded by
`api/scripts/seed-roles.ts`).

### 1.7 Tests (run during this audit)

| Suite | Result |
|---|---|
| validate:rules | 16 versions, 75 rules, 0 mismatches |
| api unit (jest, 29 suites) | **381 / 381 pass** |
| api e2e (3 suites) | **423 / 423 pass** |
| - of which RBAC matrix (`rbac-matrix.e2e-spec.ts`, 58 routes x roles) | 412 / 412 pass |
| - app.e2e-spec.ts + domain-events.e2e-spec.ts | 11 / 11 pass |
| ML (pytest, `ml/tests`, 6 files) | **50 pass, 10 FAIL** |

ML failures: `test_classify.py::test_classification_partial_match` (expects
INCOME_CERTIFICATE, gets CASTE_CERTIFICATE) and 9 in `test_extract.py`
(`test_extract_all_canonical_document_types[...]` x7,
`test_extract_field_confidence_gradient_degraded_input`,
`test_extract_missing_field_returns_null_and_zero_confidence`). The ML code
and tests are unchanged since the git baseline (`git diff bcb5a62 HEAD -- ml`
is empty), so these failures predate version control. Cause **UNSURE**
(consistent with the earlier removal of the OCR metadata-text fallback and
the classifier calibration pass, not confirmed). How they were run: the ML
image has no pytest and the compose `backend` network is `internal: true`, so
the suite was run in a throwaway container of `vidyasetu-ml:0.1.0` on the
default bridge network with `ml/tests` mounted read-only and pytest
installed inside that container only.

### 1.8 KNOWN_LIMITATIONS entries

| ID | Status | Note |
|---|---|---|
| H1 | OPEN | PII extension coverage |
| H2 | OPEN | key not validated at startup |
| H3 | UNSURE / not re-verified | hard-coded key |
| H4 | RESOLVED | db-migrate service |
| M1 | OPEN | encrypted-field types |
| M2 | OPEN | lint suppressed for crypto |
| M3 | OPEN (ACCEPT until Prisma 7) | seed config deprecation |
| M4 | UNSURE / not re-verified | migration_lock.toml |
| M5 | UNSURE / not re-verified | drift check |
| H5 | ACCEPTED | at-most-once events |
| H6 | OPEN | PFMS call / status write not atomic |
| M6 | ACCEPTED (advisory only) | fuzzy matching uncalibrated |
| M7 | OPEN | institution codes applicant-declared |
| M8 | RESOLVED (11.5) | HIGH flag vs selection |
| M9 | ACCEPTED | duplicates detected, not prevented |
| M10 | RESOLVED for live data; audit residual ACCEPTED | OCR cert numbers plaintext |
| H7 | OPEN | audit chain forks |
| M11 | RESOLVED (11.6) | bank separator |
| M12 | OPEN | released hold after committed run |
| M13 | RESOLVED (11.5) | surge count |
| M14 | OPEN (Group C) | no seed history |
| M15 | RESOLVED going forward | no git before 11.5 |
| M16 | RESOLVED (12 A) | POST_MATRIC / NFST instalments |
| M17 | ACCEPTED | certificate separator collision |
| M18 | OPEN | remaining bank misses |
| M19 | OPEN | growing match group adds flag |
| M20 | ACCEPTED | NFST HRA / contingency out of scope |
| M21 | OPEN | renewal years not scheduled |
| M22 | OPEN (question) | PRE_MATRIC mode |
| M23 | OPEN | no rejection reason codes |
| M24 | OPEN (Group C) | no non-fixture data |
| M25 | informational (no status) | analytics notes |
| FRAUD_MATCH_KEY rotation, Test fixtures (x2) | procedure notes, no status | - |

Note: the file's status markers are inconsistent (table cells, bold words, or
none); H6, M6, M7, M9 carry no explicit marker in their own sections - the
statuses above for them come from the Phase 11.5 A4 table in the same file.

---

## Step 2 - Map to the 18-phase plan

Ours-phase provenance comes from migration headers and code comments.
No "Phase 5" is mentioned anywhere in `api/src` or `ml/app` (**UNSURE** what
ours Phase 5 was).

### Phase 0 - Skeleton | Ours: 0 (pre-numbered skeleton) | **DONE**
- Monorepo: BUILT - one git repo with `api/`, `ml/`, `DB/`, `docker-compose.yml`, `Makefile` (no workspace tooling).
- Docker Compose with Postgres, Redis, MinIO, Mailpit, API, ML: BUILT - `docker-compose.yml` services postgres, redis, minio (+ minio-init), mailpit, api, ml, db-migrate.
- Env validation: BUILT - `api/src/config/env.schema.ts`, `app-config.spec.ts`.
- Logging with request IDs: BUILT - nestjs-pino `api/src/common/logging/logger-options.ts`, `request-id.middleware.spec.ts`.
- Global error handler: BUILT - `AllExceptionsFilter` (`all-exceptions.filter.spec.ts`).
- Health endpoints: BUILT - `/health/live`, `/health/ready`.
- OpenAPI: BUILT - `api/src/openapi/swagger.ts`, `npm run openapi`.
- Lint / test setup: BUILT - eslint, prettier, jest unit + e2e configs.
- Done-when proof: `test/app.e2e-spec.ts` (health, 404 shape with requestId, X-Request-ID echo, validation, readiness 503, security headers).

### Phase 1 - Data layer | Ours: 1 (+ initial DB review) | **PARTIAL**
- Prisma schema + migrations: BUILT (`api/prisma/schema.prisma`, 19 migrations).
- Field-level AES-256-GCM: BUILT - `api/src/lib/crypto/pii.ts` (IV 12 B + tag 16 B), PII extension; limitation H1 (not every query covered).
- Repository layer: **MISSING** - no `*Repository` class; services use Prisma through `DbContext`.
- Seed roles: BUILT (`scripts/seed-roles.ts`); seed NFST and NOS: BUILT (`prisma/scheme_versions_seed_v2.json`); seed admin: **PARTIAL** - `scripts/create-super-admin.ts` is a separate bootstrap script, not part of the seed.
- Done-when proof: no single test; evidence is `prisma.service.spec.ts`, `redaction.spec.ts`, `scripts/demo-pii-roundtrip.ts`, and the Phase 11/12 leak searches (proof scripts outside the repo, `.p11/`).

### Phase 2 - Auth and RBAC | Ours: 2 | **PARTIAL**
- register/login/refresh/logout: BUILT (`api/src/auth/auth.controller.ts`).
- argon2: BUILT - argon2id (`api/src/auth/password.ts`, `password.spec.ts`).
- Six roles (applicant, verifier, scrutiny officer, committee, admin, auditor): **PARTIAL** - six roles exist but a different model: APPLICANT, INO, DNO, SNO, MINISTRY_OFFICER, SUPER_ADMIN. No committee role and **no auditor role**.
- Guards: BUILT (JwtAuthGuard / RolesGuard, global).
- Jurisdiction scoping: BUILT - RLS policies + `database/jurisdiction-scope.ts` (`jurisdiction-scope.spec.ts`).
- Auth rate limiting: BUILT - `ThrottlerModule` 5 / 60 s on register and login.
- Role-permission matrix test: BUILT - `test/rbac-matrix.e2e-spec.ts` (412 tests pass).
- Done-when proof: RBAC matrix + `actor-transaction.spec.ts`.

### Phase 3 - Audit hash chain | Ours: 1 (migrations 1, 2, 4, 5) | **PARTIAL**
- Append-only audit_log: BUILT - `audit_logs`; triggers `trigger_prevent_audit_log_mutation` (UPDATE, DELETE) and `trigger_prevent_audit_log_truncate`; app_user has SELECT only.
- prev_hash and record_hash: BUILT (columns + `process_audit_log_hash_chain()`), but **flawed**: chain forks (177 today, H7) and record_hash cannot be recomputed from stored data (0 of 857 rows; see check a).
- Shared AuditService: **MISSING** - auditing is a DB trigger only.
- Verification endpoint and CLI: **MISSING** (no route, no script, no service).
- DB protections against update/delete: BUILT (triggers above).
- Done-when ("editing an old row makes verification fail and names the record"): **not proven by anything, and cannot pass as built** (check a).

### Phase 4 - Scheme engine | Ours: 3 | **PARTIAL**
- Scheme CRUD: **MISSING** - no create/update/delete/publish routes; schemes and versions come only from the seed file.
- JSON Schema validation: BUILT - `api/schemas/scheme-config.schema.json` (ajv in `prisma/seed.ts`) + DB-side validation (migrations 2-3).
- Immutable published versions: BUILT - trigger `prevent_locked_scheme_version_update` (config locked once referenced).
- json-logic rules: **UNSURE** - rules use the project's own expression language (`api/src/rules-engine/` tokenizer / parser / evaluator), not json-logic. Functionally equivalent intent; not the named technology.
- Per-criterion results: BUILT - `rule_evaluations` table, traces.
- Message-key reasons: BUILT - `message_key` on rule results (`schemes/eligibility-engine.ts`); 75 rules in the seed carry one.
- Reverse evaluation: BUILT - `POST /api/v1/schemes/check-eligibility` (rule_evaluations with NULL application).
- Dynamic form schema: BUILT - `GET /schemes/:code/versions/:version/form-schema`.
- Done-when proof: `rules-engine.spec.ts`, `schemes.spec.ts`, `validate:rules`.

### Phase 5 - Workflow state machine | Ours: 4 | **PARTIAL**
- Config-defined states / transitions: BUILT - generic `workflow/engine.ts` driven by the `VIDYASETU_WORKFLOW` definition object (a TypeScript definition, not a runtime-editable config).
- Role per transition: BUILT (`by: [role]` per transition).
- History: BUILT - `workflow_transitions`.
- SLA timers: BUILT - `STAGE_SLA_DAYS`, `stage_due_at`.
- Breach detection: **PARTIAL** - on demand only (`GET /applications/sla-breaches`, `sla-status`, `slaView()`); no scheduled sweep and no breach event.
- Events: BUILT - `workflow.transition`.
- Done-when proof: `engine.spec.ts`, `vidyasetu-workflow.spec.ts`, `domain-events.e2e-spec.ts`.

### Phase 6 - Applications and documents | Ours: 3-4 (applications) and 7 (documents) | **PARTIAL**
- Applicant profile: **PARTIAL** - created at registration (`auth/dto.ts`); no profile view/update route.
- Application pinned to scheme version: BUILT (`scheme_version_id`; frozen config).
- Draft: **MISSING** - applications are created directly into SUBMITTED (default stage); no draft state.
- Submit: BUILT (`POST /applications` = submit + automatic eligibility gate).
- Document checklist from config: BUILT (form-schema checklist, `deriveFormSchema`).
- MinIO upload with SHA-256: BUILT (`storage.service.ts`, `documents.file_sha256`).
- Metadata: BUILT (mime, size, source, DigiLocker fields).
- Done-when proof: `document-types.spec.ts`, `storage.service.issued.spec.ts`; no e2e upload test in the repo (proof scripts outside the repo).

### Phase 7 - ML service | Ours: 0 (ML skeleton) + 7 + later ML calibration | **PARTIAL**
- /quality, /classify, /extract, /consistency: BUILT (`ml/app/routes/`).
- OpenCV preprocessing: BUILT (`ml/app/utils/image.py`, services import cv2).
- Quality gate: BUILT (`quality_service.py`).
- Classifier: BUILT as a heuristic (OCR keywords + scores), no trained model.
- OCR with bundled models: **PARTIAL** - Tesseract with eng + hin language data installed into the image at build time (apt); `ml/app/models/` holds no model files.
- Field extraction, name matching, date checks, confidence: BUILT (`extract_service.py`, `consistency_service.py`).
- Done-when proof: `ml/tests` - **10 of 60 tests fail today**. The api runs with `ML_MODE=mock` by default.

### Phase 8 - Verification pipeline | Ours: 7 | **PARTIAL**
- Job on upload (quality, classify, extract, store): BUILT - BullMQ `document-pipeline.processor.ts`.
- Eligibility re-run: BUILT - `eligibility-cross-check.ts` (mismatch flag + `officer.eligibility_recheck_needed`).
- Confidence routing: BUILT - `review-routing.ts` (per-field thresholds, NEEDS_REVIEW / AUTO_ACCEPTED).
- Decision records with evidence: PARTIAL - extraction evidence is stored (field confidences, encrypted raw text); **crop reference MISSING** ("crop" only appears as the quality issue `page_cropped`).
- Retry and failure handling: BUILT - 4 attempts, exponential backoff, FAILED extraction status.
- Done-when proof: `document-pipeline.processor.spec.ts`, `review-routing.spec.ts`.

### Phase 9 - Notifications | Ours: 8 | **PARTIAL**
- Event-driven dispatcher: BUILT (`notification.listener.ts`).
- Multilingual templates: **MISSING** - templates exist only for `en`; `templates.ts` states per-user locale is a known gap; `notice_templates` table is empty (0 rows).
- In-app: BUILT (`/notifications`). Email via Mailpit: BUILT. Mock SMS: BUILT (`channels/sms.gateway.ts`).
- Delivery status: BUILT (`notifications.status` PENDING | SENT | FAILED).
- Done-when proof: `notification-intents.spec.ts`, `domain-events.e2e-spec.ts`.

### Phase 10 - Deficiency loop | Ours: 4 (mark-defective / resubmit) | **PARTIAL**
- Itemised deficiencies: PARTIAL - `deficiencies` table (code, title, description, status, student_response); one deficiency per mark-defective call; **no document reference, fix instruction or crop**; deadline only as the DEFECTIVE stage SLA (15 days).
- Notices: PARTIAL - template `application.deficiency_raised`; `notice_templates` unused.
- Resubmission endpoint: BUILT (`POST /applications/:id/resubmit`).
- Partial re-verification: **MISSING** - resubmission returns the whole application to the stage that flagged it.
- Bulk actions for identical deficiencies: **MISSING** (no "bulk" anywhere in `api/src`).
- Done-when proof: none specific (workflow specs cover the transitions only).

### Phase 11 - Officer scrutiny | Ours: 4 + 7 + 11 | **PARTIAL**
- Prioritised queue with filters: BUILT - `GET /applications/queue` (`needs_eligibility_review`, `fraud` filters; SLA ordering).
- Accept / correct / override: BUILT - verify / reject / mark-defective; `POST /documents/:id/confirm` with corrections.
- Reason required on override: **PARTIAL** (check c).
- Jurisdiction RLS: BUILT (applications and child tables).
- Bulk clearing: **MISSING**.
- Done-when proof: RBAC matrix; no scrutiny-specific test.

### Phase 12 - Fraud and duplicates | Ours: 11, 11.5, 11.6 | **PARTIAL**
- Shared bank account, repeated certificate number, identical file hash, fuzzy identity, institution surge: BUILT (`api/src/fraud/detectors.ts`).
- Flags as needs_review: BUILT - `fraud_flags` OPEN + dispositions; HIGH holds forward actions (`fraud-hold.guard.ts`).
- False-positive rate reported: **MISSING** - analytics reports disposition counts, not a rate; no labelled data (M6).
- Done-when proof: `fraud.spec.ts` (unit); live proofs in `.p11/` (outside the repo).

### Phase 13 - Merit, quota and selection | Ours: 6 | **PARTIAL**
- Scoring from config, deterministic ranking with tie-breaks, vertical and horizontal reservation: BUILT (`selection/allocator.ts`, `selection-policies.ts`).
- Score breakdown: BUILT (`scores.breakdown`).
- Provisional list: BUILT (selections PROVISIONAL, dry run).
- Committee review and override with reason: **PARTIAL** - per-selection confirm by MINISTRY_OFFICER; override of the objection window requires a reason (API + DB CHECK); no committee role or committee review step.
- Objection window: BUILT (`objectionWindowClosesAt`, `SELECTION_OBJECTION` grievances).
- Final list: **MISSING** - no publication step or endpoint.
- Fairness data: **MISSING**.
- Done-when proof: `allocator.spec.ts`, `selection-policies.spec.ts`.

### Phase 14 - Post-selection | Ours: 9 (+ 12 A) | **DONE**
- Sanction order PDF with audit hash: BUILT (`sanction.service.ts`, `sanction-order.pdf.ts`, SHA-256 + QR, `/sanction-orders/verify`).
- Disbursement schedule and status: BUILT (`disbursement.service.ts`; quarterly for NFST since 12 A).
- Renewal cycle - progress report, endorsement, continuation check: BUILT (`SubmitRenewalDto.progress_report`, INO endorse, MINISTRY continuation-check / decide). "Supervisor endorsement" is implemented as institute (INO) endorsement - UNSURE whether that matches the plan's "supervisor".
- Grievance module with SLA: BUILT (`grievance.service.ts`, `GRIEVANCE_SLA_DAYS`).
- Done-when proof: `post-selection.spec.ts`; live proofs outside the repo.

### Phase 15 - Integration adapters | Ours: 10 | **PARTIAL**
- DigiLocker: BUILT. PFMS/DBT: BUILT. NSP: BUILT (`api/src/integrations/`).
- Aadhaar authentication: **MISSING** (explicitly out of scope in Phase 10).
- Config to swap mock / real: BUILT - `*_MODE` env (`real` is not configured and fails closed).
- Done-when proof: `integrations.spec.ts`.

### Phase 16 - Analytics | Ours: 12 B | **PARTIAL**
- Funnel, SLA and bottleneck, scheme performance: BUILT (`api/src/analytics/`).
- Officer workload: **MISSING**. Verification quality (auto-accept / override rates per document type): **MISSING**. Fairness distributions: **MISSING**.
- Also built (not in the plan list): disbursement view, fraud summary, jurisdiction rollup.
- Exports: CSV BUILT; **XLSX MISSING; PDF MISSING**.
- Done-when proof: `analytics.spec.ts` + RBAC matrix; numbers cross-checked in `.p11/p12/crosscheck.mjs` (outside the repo).

### Phase 17 - Security and privacy | Ours: parts of 1, 3, 11.5, 12; Phase 17 | **PARTIAL** (as audited; see "Phase 17" under Updates: now largely BUILT)
- PII redaction in logs: **PARTIAL** - pino redacts only `authorization`, `cookie`, `x-api-key`, `set-cookie` headers; request bodies are not logged; denial details are redacted (`denial-classifier.ts`); leak searches passed (outside the repo).
- Consent records: **MISSING** (only a DigiLocker `CONSENT_NOT_GRANTED` status).
- DPDP endpoints (view, request correction): **MISSING**.
- Retention enforcement: **MISSING** (no job, no policy).
- Input validation review: PARTIAL - global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; no written review found.
- Dependency audit: **MISSING** - no script, no CI (no `.github`); `npm audit` not run in this audit.
- Security headers: BUILT - helmet + CORS allow-list (`app.e2e-spec.ts` "security headers").

### Phase 18 - End-to-end and impact simulation | Ours: none | **NOT STARTED**
- End-to-end tests of the full journey: **MISSING** - the three e2e specs mock services; the full journeys were run only by proof scripts outside the repo.
- 5,000 synthetic applications: **MISSING** (no generator in the repo; M14 / M24).
- Metrics (auto-clear rate, officer touches, processing time, deficiency cycles, false-positive rate): **MISSING**.
- Offline verification: **MISSING** - never tested with the network disconnected (check h).

---

## Step 3 - Specific checks

**a. Audit chain.** No verification endpoint, CLI or service exists. A
read-only link walk today: 857 rows, 1 chain start, 0 dangling links, unique
hashes, **177 forks** (H7 recorded 137 in Phase 11.5; every multi-row or
overlapping transaction adds more). Recomputing
`sha256(prev_hash || row_data::text)` matches **0 of 857** rows: the trigger
hashes `row_to_json(NEW)::text`, but stores `row_data` as `jsonb`, which
reorders and reformats, and the exact hashed text is not kept. So the Phase 3
done-when **cannot pass as built**: a verifier cannot tell an edited row from
an untouched one. Safe way to test once fixed (never on the live DB): restore
a `pg_dump` into a scratch database (or a throwaway compose project), and in
that copy, as the owner, disable the mutation trigger, edit one old row,
run the verifier and expect it to name that record; then drop the copy.
Fixing needs a stored canonical hash input (or hashing canonical jsonb) and a
monotonic chain order (H7).

**b. Deficiency loop.** More than mark-defective, less than the plan: a
`deficiencies` table (code, title, description, status, student_response),
mark-defective requires one deficiency, `POST /resubmit` exists, template
`application.deficiency_raised` is sent. Missing: itemised per-document
deficiencies with fix instructions / deadline / crop, `notice_templates` use
(0 rows), partial re-verification (resubmission returns the whole
application to the flagging stage), and bulk actions.

**c. Overrides.** Not enforced everywhere.
- Objection-window override on selection confirm: API
  (`sanction.service.ts` - 409 `objection_window_open` without a reason) **and**
  DB (`selections_override_reason_check`).
- Reject: reason required by the API (`RejectDto.remarks`, 1-2000) only.
- Fraud disposition: notes required by the API (`DispositionDto.notes`, 5-2000)
  only; DB `fraud_flags_review_check` enforces reviewer + time, not notes.
- OCR value correction (`POST /documents/:id/confirm`): `remarks` optional;
  DB `document_extractions_confirmation_check` enforces officer + time only.
  **No reason required.**
- Eligibility-review override (`verify` with `eligibility_review_confirmed`):
  `remarks` optional. **No reason required.**

**d. Selection.** Objection window: yes (`objectionWindowClosesAt`,
SELECTION_OBJECTION grievances, confirm guard). Committee override: only as
MINISTRY_OFFICER confirming with `override_reason`; no committee role or
review step. Final-list publication: **no** endpoint or state (selection
statuses PROVISIONAL / CONFIRMED / WAITLISTED / WITHDRAWN; nothing publishes
a list). Fairness data: **none** anywhere (`grep -ri fairness` finds nothing
in `api/src`).

**e. Post-selection.** Yes to all four: sanction order PDF
(`GET /sanction-orders/:id/pdf`, hash + verify route), renewal requests
(`POST /applications/:id/renewals` with `progress_report`), endorsement
(`POST /renewals/:id/endorse` by INO - the institute, which may or may not be
the plan's "supervisor"), grievances with SLA (`/grievances`, start/resolve).

**f. Analytics.** Present: funnel, SLA/bottleneck, scheme performance (plus
disbursement, fraud, jurisdiction), CSV for each. Missing: officer workload,
verification quality (auto-accept / override rates per document type),
fairness distributions, XLSX, PDF.

**g. Privacy.** No consent records, no DPDP view / correction endpoints, no
retention job. Log redaction configured for auth headers / cookies only
(`logger-options.ts`); bodies are not logged by default.

**h. Offline.** Never tested with the network disconnected. Evidence for
design intent only: the compose `backend` network is `internal: true` (the
ML container could not resolve pypi.org during this audit), Tesseract
language data is baked into the ML image, adapters default to `mock`. Against
offline: images are pulled / built from the internet (base images, apt, pip,
npm) - a first start needs network or a pre-built image cache.

**i. Group C dependencies.** Everything was exercised only with registered
test fixtures: 68 applications, 75 accounts, 8 documents, 95 transitions,
11 disbursements, 45 fraud flags - **0 non-fixture rows** - created
2026-09-28 04:58-08:34 UTC (18 surge-fixture applications have a back-dated
`submitted_at`). Audit history 857 rows since 2026-09-27 19:50. Needs Group C
data to be meaningful: surge detector (M14), all analytics (M24), SLA
percentiles, fuzzy-match calibration (M6), false-positive rate, fairness
data, Phase 18 simulation.

---

## Could not verify

- ML test failure cause (see 1.7) - UNSURE.
- OpenAPI document contents (not regenerated; would write a file).
- `npm audit` / dependency vulnerabilities (not run; not in the allowed list,
  needs the registry).
- Offline operation (not tested; would require disconnecting the network).
- H3 (hard-coded key) and M4 / M5 (not re-verified since the initial review).
- What "ours Phase 5" was (no reference found).
- Whether INO endorsement satisfies the plan's "supervisor endorsement".
- Whether the project's expression language satisfies the plan's "json-logic".

---

## Updates after the audit

The audit text above is unchanged; these entries supersede it where they
overlap. Details and proofs: `docs/KNOWN_LIMITATIONS.md`.

### Phase 13A (commits 509b823, d7903fe, da1a81a)

- Plan Phase 3 (audit hash chain): verification endpoint and CLI **BUILT**
  (`GET /api/v1/audit/verify`, `api/scripts/verify-audit-chain.ts`); chain v2
  with gap-free `seq`, a row-locked head and a recomputable hash; H7
  RESOLVED; the 857 earlier rows are checkpointed legacy (M29).
- ML suite: 60 / 60 in the routine (`npm run test:ml`; M26 RESOLVED).

### Phase 13B (commits d95e30b, 51d58f0, 7f74a91, f394a27, fc9bbd4 and the docs commit)

- Plan Phase 2 (roles): **BUILT** - `COMMITTEE` and `AUDITOR` added (see the
  role list below). Role-permission matrix: 61 routes x 8 roles.
- Plan Phase 3 (audit): the authorization-denials chain is verified by the
  same verifier and rules (M31 RESOLVED); `GET /audit/verify` also allows
  AUDITOR, but a state-scoped AUDITOR gets a false denials-chain failure
  because of RLS (M36, open).
- Plan Phase 10 (deficiency loop), "bulk actions for identical
  deficiencies": **BUILT** - bulk MARK_DEFECTIVE with one shared deficiency
  and reason.
- Plan Phase 11 (officer scrutiny): "reason required on override" **BUILT**
  (check c resolved: every decision-changing action needs a reason of at
  least 10 characters, API `REASON_REQUIRED` and DB); "bulk clearing"
  **BUILT** (`POST /api/v1/applications/bulk-actions`, VERIFY or
  MARK_DEFECTIVE, dry run, cap 25, one transaction, per-item results; never
  rejects, never releases a fraud hold, skips held items).
- Plan Phase 13 (selection): committee **review** BUILT (`GET
  /api/v1/selections` for COMMITTEE, and selection objections); committee
  **override** still MINISTRY_OFFICER (M33).
- Tooling: `make install-ml` works (`ml/constraints.txt`; M30 RESOLVED); the
  local sample-image folders under `docs/` are git-ignored (never committed);
  `npm run openapi` works again (its placeholder env lacked
  `FRAUD_MATCH_KEY` since Phase 11).

### Role list (as of Phase 13B)

Eight roles (`api/src/auth/roles.ts`). REVIEWERS = MIN, SNO, DNO, INO.
Every non-public route has a row per role in `api/test/rbac-matrix.e2e-spec.ts`.

| Role | Purpose | Jurisdiction (RLS) | Writes |
|---|---|---|---|
| `APPLICANT` | a student: own applications, documents, grievances | own records | own applications / documents / grievances |
| `INSTITUTE_NODAL_OFFICER` (INO) | first review at the institution | institution's state / district | verify, reject, mark-defective, bulk actions at INO stage; fraud checks and dispositions |
| `DISTRICT_NODAL_OFFICER` (DNO) | district review | district | as INO, at DNO stage |
| `STATE_NODAL_OFFICER` (SNO) | state review | state | as DNO, at SNO stage |
| `MINISTRY_OFFICER` (MIN) | selection runs, confirmation, sanction orders | national | selection, confirm (incl. objection-window override), sanction |
| `SUPER_ADMIN` (SA) | provisioning and operations | national | officer provisioning, fraud backfill |
| `COMMITTEE` | review the provisional list, score breakdowns and selection objections | state, optional district | **none** except marking its own notifications read |
| `AUDITOR` | read applications, fraud flags, denials, analytics; verify the audit chain | state, optional district | **none** (403 on every write route; since Phase 17 also refused by the database, M32 resolved) |

Routes changed in 13B: new `GET /api/v1/selections` (COMMITTEE +
REVIEWERS) and `POST /api/v1/applications/bulk-actions` (REVIEWERS);
AUDITOR added to `GET /applications`, `GET /applications/:id`,
`GET /applications/:id/fraud-flags`, `GET /authorization-denials`, `GET /audit/verify` and
the 12 analytics routes; COMMITTEE added to `GET /grievances/:id`
(selection objections only; others 404); `POST /notifications/:id/read`
now excludes AUDITOR.

### Phase 13C (commits c6cb543, fba4334, a575ae2, 693b753 and the docs commit)

- Plan Phase 3 (audit): `GET /audit/verify` verifies both chains for a
  state-scoped AUDITOR too (M36 RESOLVED: `audit_verifier_denial_rows()`,
  AUDITOR / SUPER_ADMIN only).
- Plan Phase 13 (selection): the objection-window override reason needs 10
  trimmed characters at the API and in the database (M34 RESOLVED).
- Plan Phase 10 (deficiency loop): **BUILT**, except the crop reference.
  - Itemised deficiencies: BUILT (`deficiency_items`: document, problem and
    fix message keys, deadline, status OPEN / RESUBMITTED / RESOLVED,
    OVERDUE computed when read).
  - Generated from failed checks (missing document, quality gate, expired
    certificate, name / date-of-birth mismatch) and officer-added items
    with a reason: BUILT.
  - Crop reference: **MISSING** - the OCR service returns no bounding
    boxes (M38); `crop_ref` stays NULL.
  - Notices: BUILT - one per deficiency listing every item, English and
    Hindi `notice_templates`, English fallback recorded; in-app, email,
    mock SMS.
  - Resubmission endpoint limited to the named documents, and partial
    re-verification (only the checks the changed documents feed, with a
    run / skipped report): BUILT. The original Phase 4 resubmit route is
    unchanged (M39).
  - Bulk actions for identical deficiencies: BUILT (ISSUE_DEFICIENCY,
    RESOLVE_DEFICIENCY on `POST /applications/bulk-actions`).
  - Document validity rule: configuration (`DOCUMENT_VALIDITY_MONTHS`),
    not per scheme (M37).

Routes added in 13C (RBAC matrix: 64 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| POST | /api/v1/applications/:id/deficiencies | REVIEWERS (MIN, SNO, DNO, INO) |
| GET | /api/v1/applications/:id/deficiencies | APPLICANT (own), REVIEWERS, AUDITOR |
| POST | /api/v1/applications/:id/deficiencies/:deficiencyId/resubmit | APPLICANT (own) |

`POST /api/v1/applications/bulk-actions` (REVIEWERS) gained the actions
ISSUE_DEFICIENCY and RESOLVE_DEFICIENCY. Registration accepts
`preferred_language`. Role list: unchanged from 13B (eight roles).

### Phase 13D (commits bba54ab, 287a5b5, 7c7004e, 3e6b557, 576787b and the docs commit)

- Plan Phase 10 (deficiency loop): crop reference **BUILT** (M38 resolved) -
  field boxes from OCR, stored per extraction, `crop_ref` on validity and
  field items, a scoped crop route; limits in M44. Resubmission has one
  behaviour for applications with open items (M39 resolved).
- Plan Phase 2 / applicant side: applicant profile view and update, and the
  notification language, **BUILT** (M41 resolved); English and Hindi for
  every notification (Hindi unverified - M43).
- M37: certificate validity per scheme version (docs/DEFICIENCY_CONFIG.md).
- DEV-3: cause found (ioredis disconnect during reconnect, production
  code); reported, not fixed.

Routes added in 13D (RBAC matrix: 67 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| GET | /api/v1/applications/:id/deficiencies/items/:itemId/crop | APPLICANT (own), REVIEWERS (jurisdiction) |
| GET | /api/v1/applicants/me | APPLICANT |
| PATCH | /api/v1/applicants/me | APPLICANT |

ml service: `/v1/documents/extract` gained the optional `boxes` field;
new `/v1/documents/crop` (internal network only). Role list: unchanged.

### Phase 13E (commits efadfe1, 9f42168, c7eba26, 88a79ab and the docs commit)

- Plan Phase 13 (merit, quota, selection): committee review **BUILT**
  (approve, row overrides with reasons, objection decisions); final-list
  publication **BUILT** (provisional -> objection window -> final, frozen);
  fairness data **BUILT**. The allocator is unchanged. M33: per-row confirm
  stays with MINISTRY_OFFICER, now after the final list.
- Plan Phase 16 (analytics): fairness distributions **BUILT**
  (`/api/v1/analytics/fairness`); officer workload and verification-quality
  views still MISSING.
- Plan Phase 10: PDF uploads go through OCR (page 1, 200 dpi) - M44's PDF
  gap resolved; limits M47.
- DEV-3 resolved; a separate container-shutdown delay recorded (M46).

Routes added in 13E (RBAC matrix: 79 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| GET | /api/v1/selection-lists | COMMITTEE, REVIEWERS, AUDITOR |
| GET | /api/v1/selection-lists/:id | COMMITTEE, REVIEWERS, AUDITOR (entries in scope) |
| POST | /api/v1/selection-lists/:id/approve | COMMITTEE |
| POST | /api/v1/selection-lists/:id/entries/:entryId/override | COMMITTEE |
| POST | /api/v1/selection-lists/:id/publish-provisional | MINISTRY_OFFICER |
| POST | /api/v1/selection-lists/:id/objections/:grievanceId/decide | COMMITTEE |
| POST | /api/v1/selection-lists/:id/close-objection-window | MINISTRY_OFFICER |
| POST | /api/v1/selection-lists/:id/close-objection-window-early | COMMITTEE |
| POST | /api/v1/selection-lists/:id/publish-final | MINISTRY_OFFICER |
| GET | /api/v1/applications/:id/selection-result | APPLICANT (own), COMMITTEE, REVIEWERS, AUDITOR |
| GET | /api/v1/analytics/fairness (+ /export.csv) | REVIEWERS, SUPER_ADMIN, AUDITOR, COMMITTEE |

Role list: unchanged (COMMITTEE now has write actions on selection lists).

### Phase 14 loose ends (plan Phases 4, 5, 6, 14, 15)

Commits: Part A - b61319d, 13ca41f, a51fbec, 84cadb9 (committed from the
working tree while the part was in progress), aedc2b0, 103ebe0; Part B -
8e7f0da; Part C - 2baecf4 (committed from the working tree), 80011b2;
Part D - 4d4508a; Part E - 4839a0f; docs - the docs commit.

- Plan Phase 4 (scheme engine): scheme CRUD and drafts **BUILT** - create,
  draft, edit, validate, preview, publish, retire, diff; published versions
  immutable in the API and the database; configurable author / publisher
  roles. Done-when proved (a new scheme created, published and used with
  zero code changes). Gap: a new scheme's own scoring rule cannot drive
  selection yet (M51). Phase 4 now **DONE** except that gap.
- Plan Phase 5 (workflow): breach detection **BUILT** - scheduled sweep,
  one audited breach per stage instance, breach event, officer notice; agrees
  with the on-demand endpoint and analytics. SLA figures are placeholders
  (M50). Phase 5 **DONE** (figures open).
- Plan Phase 6 (applications): drafts **BUILT** (owner-only, not an
  application; submit through the unchanged gate). Applicant profile view /
  update was built in 13D. Phase 6 **DONE**.
- Plan Phase 14 (post-selection): renewal years scheduled from the recorded
  year (M21 resolved); sanction orders carry and verify their audit-chain
  record. Phase 14 **DONE**.
- Plan Phase 15 (integrations): Aadhaar authentication **BUILT (mock)**,
  real fails closed (M55). Phase 15 **DONE** at the mock level, like
  DigiLocker / PFMS / NSP.

Routes added (RBAC matrix: 98 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| GET | /api/v1/admin/schemes | all officer roles |
| POST | /api/v1/admin/schemes | SCHEME_AUTHOR_ROLES (default SUPER_ADMIN, MINISTRY_OFFICER) |
| GET | /api/v1/admin/schemes/:code/diff | all officer roles |
| GET | /api/v1/admin/schemes/:code/versions/:version | all officer roles |
| POST | /api/v1/admin/schemes/:code/versions | SCHEME_AUTHOR_ROLES |
| PATCH | /api/v1/admin/schemes/:code/versions/:version | SCHEME_AUTHOR_ROLES |
| POST | /api/v1/admin/schemes/:code/versions/:version/validate | SCHEME_AUTHOR_ROLES |
| POST | /api/v1/admin/schemes/:code/versions/:version/preview | SCHEME_AUTHOR_ROLES |
| POST | /api/v1/admin/schemes/:code/versions/:version/publish | SCHEME_PUBLISHER_ROLES (default SUPER_ADMIN, MINISTRY_OFFICER) |
| POST | /api/v1/admin/schemes/:code/versions/:version/retire | SCHEME_PUBLISHER_ROLES |
| GET | /api/v1/applications/sla-breaches/recorded | REVIEWERS, AUDITOR |
| POST | /api/v1/applications/sla-breaches/sweep | SUPER_ADMIN |
| POST | /api/v1/application-drafts | APPLICANT |
| GET | /api/v1/application-drafts | APPLICANT |
| GET | /api/v1/application-drafts/:id | APPLICANT (own) |
| PATCH | /api/v1/application-drafts/:id | APPLICANT (own) |
| POST | /api/v1/application-drafts/:id/submit | APPLICANT (own) |
| POST | /api/v1/applicants/me/aadhaar-authentication | APPLICANT |
| GET | /api/v1/applicants/me/aadhaar-authentication | APPLICANT |

Changed: `POST /api/v1/sanction-orders/verify` takes an optional
`audit_chain` and reports the chain checks; `POST /renewals/:id/decide`
(APPROVE) also returns `year_advance` and `schedule`.

Migrations: 20261001090000_scheme_authoring, 20261001100000_sla_breaches,
20261001110000_application_drafts, 20261001120000_renewal_years,
20261001130000_aadhaar_authentications, 20261001140000_schemes_audit_real_changes.

### Phase 16 (analytics completion, M51, officer language, M55)

Branch `phase-16-completion` from 6c089b0. Commits: Part A c5494ed, Part B
5937b9a, Part C eeb42f1, docs - the docs commit.

- Plan Phase 16 (analytics): officer workload **BUILT**; verification
  quality **BUILT**; XLSX and PDF exports **BUILT** for every view (and
  fairness). Phase 16 **DONE**. Notes M56-M58.
- Plan Phase 4 / 13: a scheme version may declare its selection basis
  (M51 resolved); a new scheme with its own scoring runs selection to a
  provisional list with zero code changes.
- M50: officer notice language resolved. M55: Aadhaar status visible to
  in-jurisdiction reviewers. M60: Postgres logging note for Phase 17.

Routes added (RBAC matrix: 123 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| GET | /api/v1/analytics/{funnel,sla,schemes,disbursements,fraud,jurisdiction}/export.xlsx (6) | REVIEWERS, SUPER_ADMIN, AUDITOR |
| GET | /api/v1/analytics/{funnel,sla,schemes,disbursements,fraud,jurisdiction}/export.pdf (6) | REVIEWERS, SUPER_ADMIN, AUDITOR |
| GET | /api/v1/analytics/workload (+ /export.csv, .xlsx, .pdf) | STATE_NODAL_OFFICER, MINISTRY_OFFICER, AUDITOR, SUPER_ADMIN |
| GET | /api/v1/analytics/verification-quality (+ /export.csv, .xlsx, .pdf) | REVIEWERS, SUPER_ADMIN, AUDITOR |
| GET | /api/v1/analytics/fairness/export.xlsx, /export.pdf | REVIEWERS, SUPER_ADMIN, AUDITOR, COMMITTEE |
| GET | /api/v1/officers/me/preferences | all officer roles |
| PUT | /api/v1/officers/me/preferences | all officer roles except AUDITOR |
| PUT | /api/v1/admin/officers/:id/preferences | SUPER_ADMIN |

Changed: `GET /api/v1/applications/:id` adds `aadhaar_authentication` for
reviewer roles in jurisdiction.

Migrations: 20261002090000_officer_preferences,
20261002091000_officer_preferences_row_id,
20261002100000_aadhaar_status_for_officers.

### Phase 17 (security and privacy hardening)

Branch `phase-17-security` from 4694747. Commits:
- Part A a040fa0 + 50009df;
- B 97905ff;
- D 2694b7d;
- C 14a0c00;
- E ba3d7eb;
- F1-F3 f3915eb;
- F4 558496e;
- docs: the docs commit.

The plan Phase 17 audit entries above are updated by this phase:
- **PII redaction in logs: BUILT.**
  - Sensitive keys are redacted at any depth, request bodies are logged as field names and sizes, and error messages and details are scrubbed.
  - Postgres logs no statement text or row detail (M60 resolved).
  - The permanent leak search `scripts/proofs/leak-search.mjs` is a routine check.
- **Consent records: BUILT** (insert-only, config purposes, submission gate, English and Hindi notices).
- **DPDP endpoints: BUILT.**
  - Own-data export (JSON, masked).
  - Correction requests go to an officer queue; the decision needs a reason; approvals are applied through the verified path; the applicant is notified in their language.
  - Erasure requests are recorded only (policy in docs/PRIVACY.md).
- **Retention enforcement: BUILT.**
  - A job per data class, off by default, dry run by default, a SYSTEM-only function, protected classes, and an audited counts-only summary.
- **Input validation review: BUILT** (docs/SECURITY_REVIEW.md, every route and DTO). Rate limits are added on exports, uploads, bulk and list routes.
- **Dependency audit: BUILT.** npm audit and pip-audit run at image build time (NOT RUN recorded when offline), with licence inventories. Findings: M74.
- **Security headers: reviewed live**, and `Cache-Control: no-store` added.
- **Also resolved:**
  - M45: RLS on `applicants`;
  - M32: AUDITOR read-only in the database;
  - document / crop views are logged, and refused ones are denials;
  - PDFs draw Hindi (embedded OFL font);
  - bulk decisions carry a batch id in the workload view.
- New limits: M61-M78.

Routes added (RBAC matrix: 135 routes x 8 roles):

| Method | Path | Roles |
|---|---|---|
| GET, POST | /api/v1/applicants/me/consents | APPLICANT |
| GET | /api/v1/applicants/me/data-export | APPLICANT |
| GET, POST | /api/v1/applicants/me/correction-requests | APPLICANT |
| GET, POST | /api/v1/applicants/me/erasure-requests | APPLICANT |
| GET | /api/v1/correction-requests | REVIEWERS, AUDITOR |
| POST | /api/v1/correction-requests/:id/decide | REVIEWERS |
| POST | /api/v1/admin/retention/run | SUPER_ADMIN |
| GET | /api/v1/admin/retention/runs | SUPER_ADMIN, AUDITOR |
| GET | /api/v1/document-access | MINISTRY_OFFICER, SUPER_ADMIN, STATE_NODAL_OFFICER, DISTRICT_NODAL_OFFICER, AUDITOR |

Changed behaviour:
- `POST /applications` needs consent (409 `consent_required`).
- Rate limits (429) on exports, data export, uploads, bulk actions, and the application list and queue.
- `Cache-Control: no-store` on `/api`.
- A 404 on a document route is recorded as a denial.
- The workload view's `bulk_actions` is filled.

Migrations:
- 20261003090000_privacy_consent_and_requests
- 20261003091000_profile_changes_officer_policy
- 20261003092000_profile_changes_correctable_fields
- 20261003100000_applicants_rls_auditor_read_only
- 20261003110000_retention
- 20261003111000_retention_runs_insert_only
- 20261003120000_document_access_log
- 20261003130000_decision_records_bulk_batch

New docs: docs/SECURITY_REVIEW.md, docs/PRIVACY.md.
