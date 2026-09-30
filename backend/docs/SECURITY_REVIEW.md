# VIDYASETU security review (Phase 17)

This review covers the API as built on the `phase-17-security` branch:
- every HTTP route and its input validation;
- rate limits;
- response headers, CSP, HSTS and CORS on a live instance;
- dependency vulnerabilities and licences;
- database privileges.

It records what was checked, what was found, what was changed, and what is left open.

The proof scripts are archived under `scripts/proofs/p11/p17/` (`f1-routes.py`, `f1-dtos.py`, `f2-headers.mjs`, `f4-*`). Their real output is in the Phase 17 report. Outputs stay outside the repository, as for every phase (see `scripts/proofs/README.md`).

Findings marked **OPEN** are not fixed in Phase 17. Each is listed in `docs/KNOWN_LIMITATIONS.md`.

## 1. Input validation (F1)

### Global rules (all routes)

- **ValidationPipe:** `whitelist`, `forbidNonWhitelisted`, `transform`.
  - Unknown properties are refused (400), not silently dropped.
  - Validation errors name the field and the failed constraint, never the submitted value (`validationError: { target: false, value: false }`).
  - Live check: a validation error names fields only (Phase 17 report, A2).
- **Body size:** JSON and urlencoded bodies are limited to `BODY_LIMIT` (default `1mb`), and a larger body gets 413 in the standard error shape.
  - This bounds every free-text and object field below, even those without an explicit length.
- **Uploads:** multipart only on `POST /applications/:id/documents`, limited to `UPLOAD_MAX_BYTES` (default 10 MiB), 1 file and 5 fields.
  - The file goes through the quality gate and the document pipeline, never onto the filesystem under its own name.
- **One error shape:** `{code, message, details, requestId}`.
  - Unexpected errors return a generic message; the detail goes to the (redacted) log only.
- **Role policy:** a route without `@Roles` fails closed (RolesGuard: `no_role_policy`).
  - The inventory below found **0** routes without a role policy.
  - The **9** public routes are health, the four auth routes, and the three public eligibility / form-schema routes.
  - Phase 17.2 adds a **10th**: `GET /schemes` (the active scheme catalogue, throttled per client IP). The RBAC matrix pins the full public list (`exposes exactly these public routes`), so a new public route fails the suite until it is listed.
  - The RBAC matrix (`test/rbac-matrix.e2e-spec.ts`) asserts every route for every role and fails if a route is added without an entry.

### Path parameters

- Every `:id`-style parameter goes through `ParseUUIDPipe` (400 for a non-UUID).
- The exceptions are string or integer parameters of the scheme routes:

| Route | Parameter | How it is checked |
|---|---|---|
| `/admin/schemes/:code/...` (8 routes), `/schemes/:code/versions/:version/...` (2) | `code` | Not format-checked. It is only used as a Prisma (parameterised) lookup, so an unknown or hostile value is a 404. Live: `NFST'; DROP TABLE schemes;--`, 5,000 characters and `../../etc` all return 404 (Phase 17 report, F1). |
| same routes | `version` | `ParseIntPipe`. **OPEN:** a value above 2^31-1 is accepted by the pipe and Prisma then fails, so the response is a **500** (generic body, nothing leaked). Live: `GET /schemes/NFST/versions/99999999999/form-schema` gives 500. Fix: a bounded integer pipe (1..2147483647). |
| `/schemes/:code/academic-years/:year/run-selection` | `code`, `year` | Checked in the controller against `^[A-Z][A-Z0-9_]{1,49}$` and the academic-year pattern; 400 otherwise (live: `2026'--` gives 400). |

### DTO properties

- The DTO scan (`f1-dtos.py`) found **168** DTO properties.
- **147** of them carry an explicit bound: length, pattern, enum, UUID, number range or boolean.
- The **21** without one are:

| Property | Why it is acceptable | Recommendation |
|---|---|---|
| `RegisterDto.password`, `ProvisionOfficerDto.password` | The custom `PasswordPolicyConstraint` enforces 12..128 characters (`@Validate`). | none |
| `BulkActionDto.reason`, `IssueDeficiencyDto.reason`, `RejectDto.remarks`, `MarkDefectiveDto.remarks`, `DispositionDto.notes`, `ResolveGrievanceDto.note` | Free text: bounded only by the body limit (1 MB); reasons have a minimum of 10 characters (API and DB CHECK). They are never logged (Part A redaction). They are stored in the audit row of the table they belong to. | **OPEN (low):** add `@MaxLength(2000)` for a clear 400 instead of a 1 MB row. |
| `BulkActionDto.deficiency`, `.deficiency_item`, `VerifySanctionOrderDto.audit_chain` | Nested DTOs validated with `@ValidateNested`, so their own properties are bounded. | none |
| `declared` (create / draft / resubmit / evaluate) | Self-declared eligibility inputs, passed through `sanitizeProfile` (`schemes/profile.ts`): primitive values only, strings, arrays, nesting depth and key count bounded (`PROFILE_LIMITS`), non-finite numbers refused. Keys that are recorded profile fields are refused (`recordedField`). | none |
| `CreateDraftDto.config`, `UpdateDraftDto.config` | Validated against the canonical scheme-config JSON Schema (AJV) before a draft is saved. | none |
| `CheckEligibilityDto.applicant`, `PreviewVersionDto.applicant` | The same `sanitizeProfile` bounds; evaluated by the rules engine as an in-memory profile, never stored. | none |
| `ConfirmDocumentDto.corrections` | Only keys already present in the stored extraction are accepted (`unknown_fields` 400), with primitive values only. | none |
| `VerifySanctionOrderDto.content` | Canonicalised and hashed only; never stored. | none |

### Rate limits (added in Phase 17)

- `ActorThrottlerGuard` counts **per authenticated account and per route**, and per client IP for public routes.
- It runs after the auth guard, so it sees the account. Beyond the limit: 429 `TOO_MANY_REQUESTS`.
- The counters are in memory, like the login limit: move them to Redis before running more than one API instance.

| Kind | Routes | Limit |
|---|---|---|
| EXPORT | every analytics `export.csv` / `.xlsx` / `.pdf` (8 views x 3) and fairness exports (3) | 20 / minute |
| DATA_EXPORT | `GET /applicants/me/data-export` | 5 / minute |
| UPLOAD | `POST /applications/:id/documents` | 30 / minute |
| BULK | `POST /applications/bulk-actions` | 10 / minute |
| SEARCH | `GET /applications`, `GET /applications/queue` (the list / filter endpoints; there is no free-text search) | 60 / minute |
| FILE (Phase 17.2) | `GET /documents/:id/file` | 60 / minute |
| READ (Phase 17.2) | `GET /applications/:id/history`, `GET /selection-lists/:id/objections` | 120 / minute |
| (existing) login | `POST /auth/login`, `POST /auth/register` | 5 / minute |
| (existing) public eligibility | the three public scheme routes | 30-60 / minute |
| public catalogue (Phase 17.2) | `GET /schemes`, per client IP | 60 / minute |

Live proof (`f2-headers.mjs`; output in the Phase 17 report):
- 22 SNO exports: 19 returned 200, then 429. One export had already been counted by the header check.
- DNO right after: 200 (own counter). Another export route: 200 (own counter per route).
- Data export: 5 returned 200, then 429. Application list: 59 returned 200, then 429.

## 2. Headers, CSP, HSTS, CORS (F2, live)

- Checked on a live instance (`NODE_ENV=production`, `SWAGGER_ENABLED=true`, `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`).
- Responses checked: JSON, 401 / 404 errors, a PDF download, a CSV export, the Swagger UI, and CORS preflights. `f2-headers.mjs` prints every header checked.

| Header | Value | Assessment |
|---|---|---|
| Content-Security-Policy | helmet default: `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'self'; ...; upgrade-insecure-requests` | Appropriate for a JSON API; the Swagger UI loads under it. |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | Sent on every response. Browsers ignore it over plain HTTP (the local stack); effective once TLS terminates in front of the API. |
| X-Content-Type-Options | `nosniff` | ok |
| X-Frame-Options / frame-ancestors | `SAMEORIGIN` / `'self'` | ok |
| Referrer-Policy | `no-referrer` | ok |
| Cross-Origin-Opener-Policy / -Resource-Policy | `same-origin` | ok |
| X-Powered-By, Server | absent | ok |
| **Cache-Control** | was **absent** on authenticated JSON, PDFs and CSV exports | **Fixed in Phase 17:** `Cache-Control: no-store` on every `/api` response (`app.setup.ts`); the crop route already set it. |

CORS:
- A preflight from an allowed origin gets `Access-Control-Allow-Origin: <that origin>` and the fixed method and header lists, with `max-age` 600.
- A preflight or GET from `https://evil.example` or `Origin: null` gets **no** `Access-Control-Allow-Origin`, so the browser blocks the read.
- `Access-Control-Allow-Credentials: true` is sent on every response. It is harmless without a matching `Allow-Origin`, and the API uses bearer tokens, not cookies.
- A preflight asking for a header that is not allowed (`X-Evil`) gets the fixed allowed list, which excludes it.

Open points for deployment (unchanged from earlier phases, restated):
- set `trust proxy` once the reverse proxy is known, so rate limits and logs see the client IP;
- turn the Swagger UI off in production (`SWAGGER_ENABLED=false`);
- terminate TLS in front of the API (HSTS becomes effective).

## 3. Dependencies (F3)

Both images audit their dependencies **at build time**. The reports are inside the images:
- `api`: `/app/security/npm-audit.txt`, `npm-audit.json`, `licences.txt`, `licences.csv`;
- `ml`: `/app/security/pip-audit.txt`, `pip-audit.json`, `requirements.lock`, `licences.txt`, `licences.csv`.

If the registry or the vulnerability service cannot be reached, the report says `STATUS: NOT RUN - <reason>`. The build does not fail, and no result is invented. The licence inventories are offline.

Read them with:

```
docker compose exec api cat security/npm-audit.txt security/licences.txt
docker compose exec ml cat security/pip-audit.txt security/licences.txt
```

Result of the Phase 17 build (the registry was reachable, so the audits **RAN**):

**npm audit** (312 production dependencies): **3 high, 4 moderate**, 0 critical. All are **OPEN** (their fixes are semver-major).

| Package (path) | Severity | Advisory | Exposure here |
|---|---|---|---|
| `deepmerge-ts` <8 (via `@prisma/config`, `prisma` 6.19.3) | high | GHSA-ggr8-5vv4-36mx: stack exhaustion merging recursive object graphs | Used by the Prisma CLI config loader on our own config at start-up; no request data reaches it. The npm "fix" (prisma@6.12.0) is a downgrade: wait for a patched Prisma 6.x. |
| `decode-uri-component` <=0.4.2 via `query-string` via `minio` 8.0.7 | moderate | GHSA-vcc3-ghjq-m6fr: DoS on malformed percent-encoding | The minio client parses responses from our own MinIO on the internal network; no user input. |
| `stream-json` <=3.4.0 via `minio` | moderate | GHSA-528h-pc64-c93x: O(depth^2) filters on nested JSON | Same: our own MinIO responses only. |
| `query-string`, `minio` | moderate | (the two above) | npm suggests `minio@7.1.3`, a major downgrade: not taken. |

**pip-audit** (31 pinned runtime distributions of the ML service): **0 vulnerabilities**.

**Licences:**
- **npm** (311 production packages): 310 permissive: MIT 255, Apache-2.0 19, ISC 17, BSD-3-Clause 13, BSD-2-Clause, 0BSD, BlueOak-1.0.0, MIT-0, Python-2.0, and (MIT OR CC0-1.0). There is no copyleft.
  - One is flagged unknown: `png-js@2.0.0`, a pdfkit dependency with no `license` field in package.json.
  - Manual check: its bundled `LICENSE` file is MIT.
- **Python** (31 distributions): 30 permissive.
  - One is flagged copyleft: `certifi` (MPL-2.0). MPL is file-level (weak) copyleft; certifi is used unmodified as the CA bundle, so no obligation extends to VIDYASETU code.
  - Recorded as flagged and accepted.
- **Font** (added in F4): Lohit Devanagari, SIL Open Font License 1.1. It permits embedding and redistribution with software, and its licence text ships next to it (`/app/fonts/LICENSE-Lohit-Devanagari.txt`).
- **Not covered:** OS packages in the base images (Debian bookworm), which are Debian's own licences. Tesseract is Apache-2.0.

## 4. Database privileges and row-level security

Current grants to `app_user` were listed from `information_schema.role_table_grants` (Phase 17 report).

- **Default privileges:** `ALTER DEFAULT PRIVILEGES` grants `app_user` SELECT, INSERT, UPDATE and DELETE (`arwd`) on every new table.
  - Every migration that creates an insert-only or read-only table **must** `REVOKE` what it does not need.
  - Phase 17 found this the hard way: `retention_runs` was writable by app_user until `20261003111000_retention_runs_insert_only`.
  - Rule for new tables: the new-table checklist below.
- **OPEN (pre-existing): tables whose rows must never be removed are DELETE-able by app_user.** Under their RLS policy (officer jurisdiction, `FOR ALL`), app_user can delete rows from:
  - `decision_records`, `sanction_orders`, `disbursements`, `workflow_transitions`, `selections`, `applications`, `documents`, `deficiencies`, `grievances`, `renewals`, `scores`.
  - No application code path deletes them. A delete would be recorded in the hash-chained audit log (tamper-evident), but it is not prevented.
  - Revoking DELETE, or adding refusal triggers, touches the disbursement tables, which Phase 17 must not change. It is left open with this recommendation: `REVOKE DELETE, TRUNCATE` on these tables from app_user, table by table, with the e2e suite as the check.
- **No RLS** remains on:
  - `accounts`, `officers`, `roles`, `notifications`, `notice_templates`, `document_extractions`, `rule_evaluations`, `scheme_versions`, `schemes`, `workflow_transitions`, `selection_lists`, `refresh_tokens`;
  - `retention_runs` (read-only), `audit_logs` and `test_fixtures` (read-only).
  - `applicants` gained RLS in Phase 17 (M45).
  - The application code scopes these tables, but the database does not. Listed in KNOWN_LIMITATIONS.
- **M32, AUDITOR read-only in the database (Phase 17):** `refuse_auditor_writes()` is attached to every public table except these:
  - `authorization_denials` and its chain head (an AUDITOR's refused attempt must be recorded);
  - `audit_logs` and `audit_chain_head` (written only by the audit trigger);
  - `document_access_log` (an AUDITOR's view must be logged);
  - `_prisma_migrations` and `test_fixtures` (owner only).
  - A refused write surfaces as a 500 to the caller and is recorded as an `AUDITOR_READ_ONLY` denial.

### Checklist for a new table

1. `REVOKE` from app_user every privilege the table does not need (default privileges grant all four).
2. Enable RLS with an explicit policy for each actor that needs it (owner / officer jurisdiction / SYSTEM), or state why not.
3. Attach `trigger_refuse_auditor_writes` (M32), unless it is a log the AUDITOR must be able to write to.
4. Attach the audit trigger if rows change state (`process_audit_log_hash_chain()`; the table needs an `id` column).
5. Add the entity type to `test_fixtures_entity_type_check` if proofs create rows in it, and tag them.
6. If it holds personal data, add it to `scripts/proofs/leak-search.mjs` sources, to the data export, and to the retention review.

### Checklist for a new route

1. `@Roles(...)`, or it fails closed.
2. An entry in `test/rbac-matrix.e2e-spec.ts` (the matrix fails without one).
3. `ParseUUIDPipe` on ids, a DTO with bounds on every property.
4. `@RateLimit(...)` if it exports, uploads, acts in bulk or lists / filters.
5. `@LogDocumentAccess(...)` and an entry in `DOCUMENT_ACCESS_ROUTES` if it serves a document, file or crop.

## 5. Other findings

- **RESOLVED after Phase 17 (was pre-existing, Phase 13B D1): `GET /authorization-denials` returned 500 for every role** once any denial existed. `seq` is now sent as a decimal string.
  - The rows include the BigInt `seq` column, which JSON cannot serialise.
  - Found while proving the AUDITOR routes in Part D; not changed in Phase 17.
  - `GET /document-access` (Part E) does not have the problem.
- **Logs:** Part A redaction and the permanent leak search (`scripts/proofs/leak-search.mjs`, see `scripts/proofs/README.md`).
- **Postgres:** statement text and error detail are no longer logged (M60).

## 6. Route inventory

Generated by `f1-routes.py` from the controllers. The columns are:
- **Roles:** who the RBAC gate admits; `SCHEME_*_ROLES` are the config-driven authoring roles.
- **Path params:** `uuid` means ParseUUIDPipe; `int` means ParseIntPipe; `string` is discussed in §1.
- **Query / Body:** the DTO class. `+ file` marks the multipart upload.
- **Rate limit:** the kind from §1.
- **Phase 17.2 rows** (added by hand, same columns): `GET /documents/:id/file`, `GET /applications/:id/history`, `GET /selection-lists/:id/objections` and the public `GET /schemes`.
  - The file route leaves out SUPER_ADMIN, COMMITTEE and AUDITOR on purpose (least privilege; the database would allow the last two, see M79). It serves only JPEG / PNG / WebP / PDF (else 415), with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and an inline disposition. Each success writes a `document_access_log` row (`document_file`) in the request's transaction; a 404 is a `DOCUMENT_NOT_ACCESSIBLE` denial.
  - `GET /auth/me` keeps its row; its response now also carries `name` and `institution_code` for officers (read through `current_officer_profile()`, own row only).

| Method | Path | Roles | Path params | Query | Body | Rate limit |
|---|---|---|---|---|---|---|
| POST | `/api/v1/admin/officers` | SUPER_ADMIN | - | - | ProvisionOfficerDto | - |
| PUT | `/api/v1/admin/officers/:id/preferences` | SUPER_ADMIN | id:uuid | - | OfficerLanguageDto | - |
| POST | `/api/v1/admin/retention/run` | SUPER_ADMIN | - | - | RetentionRunDto | - |
| GET | `/api/v1/admin/retention/runs` | SUPER_ADMIN, AUDITOR | - | - | - | - |
| GET | `/api/v1/admin/schemes` | OFFICER_ROLES | - | - | - | - |
| POST | `/api/v1/admin/schemes` | SCHEME_AUTHOR_ROLES (config) | - | - | CreateSchemeDto | - |
| GET | `/api/v1/admin/schemes/:code/diff` | OFFICER_ROLES | code:string | DiffQueryDto | - | - |
| POST | `/api/v1/admin/schemes/:code/versions` | SCHEME_AUTHOR_ROLES (config) | code:string | - | CreateDraftDto | - |
| GET | `/api/v1/admin/schemes/:code/versions/:version` | OFFICER_ROLES | code:string, version:int | - | - | - |
| PATCH | `/api/v1/admin/schemes/:code/versions/:version` | SCHEME_AUTHOR_ROLES (config) | code:string, version:int | - | UpdateDraftDto | - |
| POST | `/api/v1/admin/schemes/:code/versions/:version/preview` | SCHEME_AUTHOR_ROLES (config) | code:string, version:int | - | PreviewVersionDto | - |
| POST | `/api/v1/admin/schemes/:code/versions/:version/publish` | SCHEME_PUBLISH_ROLES (config) | code:string, version:int | - | PublishVersionDto | - |
| POST | `/api/v1/admin/schemes/:code/versions/:version/retire` | SCHEME_PUBLISH_ROLES (config) | code:string, version:int | - | - | - |
| POST | `/api/v1/admin/schemes/:code/versions/:version/validate` | SCHEME_AUTHOR_ROLES (config) | code:string, version:int | - | - | - |
| GET | `/api/v1/analytics/disbursements` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/disbursements/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/disbursements/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/disbursements/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fairness` | FAIRNESS_ROLES | - | FairnessQueryDto | - | - |
| GET | `/api/v1/analytics/fairness/export.csv` | FAIRNESS_ROLES | - | FairnessQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fairness/export.pdf` | FAIRNESS_ROLES | - | FairnessQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fairness/export.xlsx` | FAIRNESS_ROLES | - | FairnessQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fraud` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/fraud/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fraud/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/fraud/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/funnel` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/funnel/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/funnel/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/funnel/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/jurisdiction` | ANALYTICS_ROLES | - | JurisdictionQueryDto | - | - |
| GET | `/api/v1/analytics/jurisdiction/export.csv` | ANALYTICS_ROLES | - | JurisdictionQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/jurisdiction/export.pdf` | ANALYTICS_ROLES | - | JurisdictionQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/jurisdiction/export.xlsx` | ANALYTICS_ROLES | - | JurisdictionQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/schemes` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/schemes/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/schemes/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/schemes/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/sla` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/sla/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/sla/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/sla/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/verification-quality` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/verification-quality/export.csv` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/verification-quality/export.pdf` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/verification-quality/export.xlsx` | ANALYTICS_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/workload` | WORKLOAD_ROLES | - | AnalyticsQueryDto | - | - |
| GET | `/api/v1/analytics/workload/export.csv` | WORKLOAD_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/workload/export.pdf` | WORKLOAD_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/analytics/workload/export.xlsx` | WORKLOAD_ROLES | - | AnalyticsQueryDto | - | EXPORT |
| GET | `/api/v1/applicants/me` | APPLICANT | - | - | - | - |
| PATCH | `/api/v1/applicants/me` | APPLICANT | - | - | UpdateProfileDto | - |
| GET | `/api/v1/applicants/me/aadhaar-authentication` | APPLICANT | - | - | - | - |
| POST | `/api/v1/applicants/me/aadhaar-authentication` | APPLICANT | - | - | AadhaarAuthenticationDto | - |
| GET | `/api/v1/applicants/me/consents` | APPLICANT | - | - | - | - |
| POST | `/api/v1/applicants/me/consents` | APPLICANT | - | - | ConsentDto | - |
| GET | `/api/v1/applicants/me/correction-requests` | APPLICANT | - | - | - | - |
| POST | `/api/v1/applicants/me/correction-requests` | APPLICANT | - | - | CorrectionRequestDto | - |
| GET | `/api/v1/applicants/me/data-export` | APPLICANT | - | - | - | DATA_EXPORT |
| GET | `/api/v1/applicants/me/erasure-requests` | APPLICANT | - | - | - | - |
| POST | `/api/v1/applicants/me/erasure-requests` | APPLICANT | - | - | - | - |
| GET | `/api/v1/application-drafts` | APPLICANT | - | - | - | - |
| POST | `/api/v1/application-drafts` | APPLICANT | - | - | SaveApplicationDraftDto | - |
| GET | `/api/v1/application-drafts/:id` | APPLICANT | id:uuid | - | - | - |
| PATCH | `/api/v1/application-drafts/:id` | APPLICANT | id:uuid | - | SaveApplicationDraftDto | - |
| POST | `/api/v1/application-drafts/:id/submit` | APPLICANT | id:uuid | - | - | - |
| GET | `/api/v1/applications` | APPLICANT, REVIEWER_ROLES, AUDITOR | - | - | - | SEARCH |
| POST | `/api/v1/applications` | APPLICANT | - | - | CreateApplicationDto | - |
| GET | `/api/v1/applications/:id` | APPLICANT, REVIEWER_ROLES, AUDITOR | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/assign-to-me` | REVIEWER_ROLES | id:uuid | - | - | - |
| GET | `/api/v1/applications/:id/deficiencies` | APPLICANT, REVIEWER_ROLES, AUDITOR | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/deficiencies` | REVIEWER_ROLES | id:uuid | - | IssueDeficiencyDto | - |
| POST | `/api/v1/applications/:id/deficiencies/:deficiencyId/resubmit` | APPLICANT | id:uuid, deficiencyId:uuid | - | - | - |
| GET | `/api/v1/applications/:id/deficiencies/items/:itemId/crop` | APPLICANT, REVIEWER_ROLES | id:uuid, itemId:uuid | - | - | - |
| GET | `/api/v1/applications/:id/disbursements` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/documents` | APPLICANT | id:uuid | - | - + file | UPLOAD |
| POST | `/api/v1/applications/:id/evaluate-eligibility` | APPLICANT, REVIEWER_ROLES | id:uuid | - | EvaluateEligibilityDto | - |
| GET | `/api/v1/applications/:id/history` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | READ |
| POST | `/api/v1/applications/:id/fraud-checks` | REVIEWER_ROLES | id:uuid | - | - | - |
| GET | `/api/v1/applications/:id/fraud-flags` | REVIEWER_ROLES, AUDITOR | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/mark-defective` | REVIEWER_ROLES | id:uuid | - | MarkDefectiveDto | - |
| GET | `/api/v1/applications/:id/nsp-duplicate-check` | REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/reject` | REVIEWER_ROLES | id:uuid | - | RejectDto | - |
| GET | `/api/v1/applications/:id/renewals` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/renewals` | APPLICANT | id:uuid | - | SubmitRenewalDto | - |
| POST | `/api/v1/applications/:id/resubmit` | APPLICANT | id:uuid | - | ResubmitDto | - |
| GET | `/api/v1/applications/:id/selection-result` | APPLICANT, READERS | id:uuid | - | - | - |
| GET | `/api/v1/applications/:id/sla-status` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/applications/:id/verify` | REVIEWER_ROLES | id:uuid | - | VerifyDto | - |
| POST | `/api/v1/applications/bulk-actions` | REVIEWER_ROLES | - | - | BulkActionDto | BULK |
| GET | `/api/v1/applications/queue` | REVIEWER_ROLES | - | QueueQueryDto | - | SEARCH |
| GET | `/api/v1/applications/sla-breaches` | REVIEWER_ROLES | - | - | - | - |
| GET | `/api/v1/applications/sla-breaches/recorded` | REVIEWER_ROLES, AUDITOR | - | - | - | - |
| POST | `/api/v1/applications/sla-breaches/sweep` | SUPER_ADMIN | - | - | - | - |
| GET | `/api/v1/audit/verify` | SUPER_ADMIN, AUDITOR | - | - | - | - |
| POST | `/api/v1/auth/login` | PUBLIC | - | - | LoginDto | login throttle |
| POST | `/api/v1/auth/logout` | PUBLIC | - | - | RefreshTokenDto | - |
| GET | `/api/v1/auth/me` | ALL_ROLES | - | - | - | - |
| POST | `/api/v1/auth/refresh` | PUBLIC | - | - | RefreshTokenDto | - |
| POST | `/api/v1/auth/register` | PUBLIC | - | - | RegisterDto | login throttle |
| GET | `/api/v1/authorization-denials` | DENIAL_READER_ROLES | - | DenialsQueryDto | - | - |
| GET | `/api/v1/correction-requests` | REVIEWER_ROLES, AUDITOR | - | CorrectionQueueDto | - | - |
| POST | `/api/v1/correction-requests/:id/decide` | REVIEWER_ROLES | id:uuid | - | CorrectionDecisionDto | - |
| POST | `/api/v1/disbursements/:id/initiate` | MINISTRY_OFFICER | id:uuid | - | - | - |
| POST | `/api/v1/disbursements/:id/reconcile` | MINISTRY_OFFICER | id:uuid | - | - | - |
| GET | `/api/v1/document-access` | DENIAL_READER_ROLES | - | DocumentAccessQueryDto | - | - |
| GET | `/api/v1/documents/:id` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/documents/:id/confirm` | REVIEWER_ROLES | id:uuid | - | ConfirmDocumentDto | - |
| GET | `/api/v1/documents/:id/file` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | FILE |
| POST | `/api/v1/fraud-flags/:id/disposition` | REVIEWER_ROLES | id:uuid | - | DispositionDto | - |
| POST | `/api/v1/fraud/backfill` | SUPER_ADMIN | - | - | - | - |
| GET | `/api/v1/grievances` | APPLICANT, REVIEWER_ROLES | - | GrievanceQueryDto | - | - |
| POST | `/api/v1/grievances` | APPLICANT | - | - | RaiseGrievanceDto | - |
| GET | `/api/v1/grievances/:id` | APPLICANT, REVIEWER_ROLES, COMMITTEE | id:uuid | - | - | - |
| POST | `/api/v1/grievances/:id/resolve` | REVIEWER_ROLES | id:uuid | - | ResolveGrievanceDto | - |
| POST | `/api/v1/grievances/:id/start` | REVIEWER_ROLES | id:uuid | - | - | - |
| GET | `/api/v1/notifications` | ALL_ROLES | - | NotificationsQueryDto | - | - |
| POST | `/api/v1/notifications/:id/read` | ALL_WRITING_ROLES | id:uuid | - | - | - |
| GET | `/api/v1/officers/me/preferences` | OFFICER_ROLES | - | - | - | - |
| PUT | `/api/v1/officers/me/preferences` | SETTING_ROLES | - | - | OfficerLanguageDto | - |
| POST | `/api/v1/renewals/:id/continuation-check` | MINISTRY_OFFICER | id:uuid | - | - | - |
| POST | `/api/v1/renewals/:id/decide` | MINISTRY_OFFICER | id:uuid | - | DecideRenewalDto | - |
| POST | `/api/v1/renewals/:id/endorse` | INSTITUTE_NODAL_OFFICER | id:uuid | - | EndorseRenewalDto | - |
| GET | `/api/v1/sanction-orders/:id` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| GET | `/api/v1/sanction-orders/:id/pdf` | APPLICANT, REVIEWER_ROLES | id:uuid | - | - | - |
| POST | `/api/v1/sanction-orders/verify` | ALL_ROLES | - | - | VerifySanctionOrderDto | - |
| GET | `/api/v1/schemes` | PUBLIC | - | - | - | throttle { auth: { limit: 60, ttl: 60_000 } } |
| POST | `/api/v1/schemes/:code/academic-years/:year/run-selection` | MINISTRY_OFFICER | code:string, year:string | - | RunSelectionDto | - |
| POST | `/api/v1/schemes/:code/versions/:version/check-eligibility` | PUBLIC | code:string, version:int | - | CheckEligibilityDto | throttle { auth: { limit: 30, ttl: 60_000 } } |
| GET | `/api/v1/schemes/:code/versions/:version/form-schema` | PUBLIC | code:string, version:int | - | - | throttle { auth: { limit: 60, ttl: 60_000 } } |
| POST | `/api/v1/schemes/check-eligibility` | PUBLIC | - | - | CheckEligibilityDto | throttle { auth: { limit: 30, ttl: 60_000 } } |
| GET | `/api/v1/selection-lists` | READERS | - | ListQueryDto | - | - |
| GET | `/api/v1/selection-lists/:id` | READERS | id:uuid | - | - | - |
| POST | `/api/v1/selection-lists/:id/approve` | COMMITTEE | id:uuid | - | ApproveListDto | - |
| POST | `/api/v1/selection-lists/:id/close-objection-window` | MINISTRY_OFFICER | id:uuid | - | - | - |
| POST | `/api/v1/selection-lists/:id/close-objection-window-early` | COMMITTEE | id:uuid | - | CloseWindowEarlyDto | - |
| POST | `/api/v1/selection-lists/:id/entries/:entryId/override` | COMMITTEE | id:uuid, entryId:uuid | - | OverrideEntryDto | - |
| GET | `/api/v1/selection-lists/:id/objections` | READERS | id:uuid | - | - | READ |
| POST | `/api/v1/selection-lists/:id/objections/:grievanceId/decide` | COMMITTEE | id:uuid, grievanceId:uuid | - | DecideObjectionDto | - |
| POST | `/api/v1/selection-lists/:id/publish-final` | MINISTRY_OFFICER | id:uuid | - | - | - |
| POST | `/api/v1/selection-lists/:id/publish-provisional` | MINISTRY_OFFICER | id:uuid | - | - | - |
| GET | `/api/v1/selections` | COMMITTEE, REVIEWER_ROLES | - | SelectionListQueryDto | - | - |
| POST | `/api/v1/selections/:id/confirm` | MINISTRY_OFFICER | id:uuid | - | ConfirmSelectionDto | - |
| POST | `/api/v1/selections/:id/disbursements` | MINISTRY_OFFICER | id:uuid | - | - | - |
| POST | `/api/v1/selections/:id/sanction-order` | MINISTRY_OFFICER | id:uuid | - | - | - |
| GET | `/health/live` | PUBLIC | - | - | - | - |
| GET | `/health/ready` | PUBLIC | - | - | - | - |
