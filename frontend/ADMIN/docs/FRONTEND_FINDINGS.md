# Frontend findings (admin portal)

Findings, blockers and deviations recorded while wiring the Figma Make
export to the VIDYASETU backend. Newest sections at the bottom.

## Step 0: housekeeping

- `pnpm typecheck` (`tsc --noEmit`) passed with no errors on the design
  baseline; nothing to fix.
- `.env.local` is git-ignored by the `.env*` rule in `.gitignore`
  (`git check-ignore -v .env.local` -> `.gitignore:6:.env*`).
- Dev and preview host default changed to `127.0.0.1`
  (`FIGMA_DEV_SERVER_HOST` still overrides it). Port stays 5174.

## Step 1: foundation from the student app

- Copied from `..\STUDENT` (read only): `src/api/client.ts` (bearer,
  single refresh + retry, ApiError with requestId; `put` added, upload/blob
  helpers dropped as unused), `src/i18n/index.tsx` (provider, `t`/`tk`,
  date/number formatting), the error mapper pattern (`src/i18n/errors.ts`),
  the auth provider pattern, react-router setup, `openapi/openapi.json`
  (identical to `GET http://localhost:3000/docs/openapi.json`, 87456 bytes)
  and the `gen:api` script. `pnpm gen:api` output is byte-identical to the
  student app's `src/api/schema.ts`.
- Dependencies at the student app's versions: react-router-dom 7.18.4,
  openapi-typescript 7.13.0, @fontsource/dm-sans 5.3.0, @fontsource/nunito
  5.3.0; plus the fonts only this design uses (@fontsource/domine, dongle,
  doppio-one, faculty-glyphic, fondamento, ibm-plex-mono, all 5.3.0).
- Google Fonts `@import url(...)` replaced by @fontsource imports. Dongle
  has no 500/600 weights in @fontsource (Google Fonts never served them
  either); 400/700 are bundled.
- Figma Make runtime removed as in the student app: `.figma/` (site.json,
  deploy/preview scripts) and the four Figma plugins in `vite.config.ts`
  (including the Google Analytics injection hook). `index.html` has a static
  title, `lang` and `noindex`.
- `rg` is not installed on this machine; the offline check was run with the
  same ripgrep pattern through the agent's search tool. `dist` lists only
  `http://localhost:3000/api/v1` (API default), `http://localhost`
  (react-router URL base), XML/SVG/MathML namespaces and inert text inside
  library messages (`https://react.dev/errors/`,
  `https://reactrouter.com/en/main/routers/picking-a-router.`, the Tailwind
  licence comment `https://tailwindcss.com`). `src` lists only the API
  default (and the generated schema's doc comments).
- Shell: officer card shows the role label and jurisdiction from
  `/auth/me`; the backend returns **no officer name** (BACKEND_REQUESTS R2).
  "Ananya Rao", "State Nodal Officer", "Social Welfare Directorate",
  "SCorarship", "All systems operational · Last check 09:42 IST", the
  sidebar subtitles, the inert search box, bell dot and help pill are gone.
  The breadcrumb shows the real jurisdiction ("National scope" when
  `jurisdictionState` is null).
- Audit design: "Integrity chain fully intact", "42,819 records/blocks",
  "01 Apr 2023", "SHA-256 + RSA", "100.000%", ledger head and last-verified
  time removed. Screens not yet wired carry a "Sample data" badge until
  their step replaces them.
- Role gating: `src/auth/permissions.ts` (one table, mirrors backend
  `@Roles`). Scheme Studio is hidden (Stage F3); its design is kept in
  `src/screens/hidden/SchemeStudio.tsx`. Analytics is hidden until 2.5.
- 403 from any call: `ErrorNote` shows "Not permitted for your role" plus
  the mapped text and the request id; a render error boundary keeps the
  shell alive.

## Step 1.5: investigation (read only, backend source)

No officer credentials are available to the agent (demo passwords live only
in `.demo-seed`, which this work never opens), so every shape below was read
from `backend/api/src`, not from live responses. The OpenAPI file documents
request bodies and query parameters only; no 2xx response has a schema.

### a. Original uploaded document (image / PDF bytes)

**No route serves it.** `documents.controller.ts` has upload
(`POST /applications/:id/documents`, APPLICANT), `GET /applications/:id/documents`
(list), `GET /documents/:id` (JSON view) and `POST /documents/:id/confirm`.
The only binary routes are `GET /applications/:id/deficiencies/items/:itemId/crop`
(image/png, only when an item has `crop_ref`, which is always null today:
the mock OCR returns no boxes), the sanction order PDF and analytics
exports. The scrutiny viewer therefore shows the extracted fields and an
"original scan viewer not available" note (BACKEND_REQUESTS R3).

### b. Documents, extracted fields, confidence, routing reason

- `GET /applications/:id/documents` (APPLICANT + reviewer roles; logged in
  document_access_log as LIST) -> `{application_id, ml_mode, mock_notice?,
  flags:{needs_eligibility_review, document_consistency_status,
  document_consistency_details, document_consistency_checked_at}, checklist[],
  slots[{slot, document_id, state}], documents[DocumentView]}`.
- `GET /documents/:id` (logged as VIEW) -> DocumentView `{document_id,
  application_id, document_type, file_name, mime_type, file_size_bytes,
  file_sha256, uploaded_at, state, source (UPLOAD|DIGILOCKER), digilocker,
  quality:{usable, issues[], confidence}, verification_status, extraction:
  {id, status, error_code, engine, classification:{type, confidence,
  alternatives, matches_slot}, review_status, review_threshold,
  fields[{name, value, confidence, review, sensitive, corrected}],
  eligibility_mismatches, confirmed_by_officer_id, confirmed_at,
  processed_at}}`. Sensitive values (e.g. certificate_number) are decrypted
  in the live response.
- **The routing reason is not returned.** `routeByConfidence()` computes
  `reasons[]` (field confidence below threshold; classified type differs
  from the slot; classification confidence below threshold; slot without a
  canonical type), but only `review_status` / `field_review` are stored.
  The portal derives the same reasons from `fields[].confidence`,
  `review_threshold` and `classification` using the backend's rule
  (BACKEND_REQUESTS R4).

### c. Response shapes

- `GET /applications/queue?needs_eligibility_review=true|false&fraud=HIGH|ANY`
  (MINISTRY, SNO, DNO, INO) -> `{role, stages[], count, applications[]}`;
  at most 100 rows ordered by `needs_eligibility_review desc, stage_due_at
  asc` (SLA risk first). Row = application (id, application_no,
  applicant_id, scheme_id, scheme_version_id, academic_year, current_stage,
  status, jurisdiction_state/district, institution_name/code,
  assigned_officer_id, submitted_at, stage_entered_at, stage_due_at,
  needs_eligibility_review) + `sla:{stage, stage_entered_at, sla_days,
  due_at, state WITHIN_SLA|BREACHED|NO_SLA}` + `fraud:{held, open_flags,
  flags[{id, flag_type, severity, status}]}`. **No applicant name** appears
  in any officer view (queue or detail); cases are shown by application
  number (BACKEND_REQUESTS R6).
- `GET /applications/:id` -> the same application fields (+ course fields)
  and, for reviewers, `aadhaar_authentication:{status, aadhaar_masked, at}`.
- `POST /applications/:id/verify` `{remarks?, eligibility_review_confirmed?}`
  (remarks required, >= 10 chars, only when confirming an eligibility
  review); `reject` `{remarks}` (required, >= 10); `mark-defective`
  `{code (UPPER_SNAKE), title, description, remarks (required, >= 10)}`.
  All return `{application:{...app, sla}, transition:{id, from_stage,
  to_stage, trigger_action}, decision_record_id, deficiency_id,
  eligibility_gate}`. 403 `principal_not_permitted` for the wrong role at a
  stage, 409 `transition_not_allowed`, 409 FRAUD_REVIEW_PENDING when held.
- `POST /documents/:id/confirm` `{corrections?: {field: primitive},
  remarks?}`: remarks required (>= 10) only when a value is corrected; 409
  `not_awaiting_review` unless the extraction is COMPLETED + NEEDS_REVIEW.
  Returns the DocumentView + `remarks`.
- `POST /applications/:id/deficiencies` `{reason (required, >= 10), items?:
  [{document_slot, check_code DOCUMENT_PRESENT|QUALITY_GATE|DOCUMENT_VALIDITY|
  FIELD_CONFIDENCE|OFFICER, field?, problem_code?}], include_failed_checks?
  (default true), dry_run?}` -> dry run `{dry_run:true, application_id,
  deadline_days, items[]}`; real `{application_id, application_no,
  current_stage, deficiency_id, decision_record_id, deadline_days, items[]}`.
  409 `no_deficiency_items`.
- `POST /applications/bulk-actions` `{action VERIFY|MARK_DEFECTIVE|
  ISSUE_DEFICIENCY|RESOLVE_DEFICIENCY, application_ids (1-25), reason?
  (required for MARK_DEFECTIVE and ISSUE_DEFICIENCY), deficiency?,
  deficiency_item?, dry_run?}` -> `{batch_id, action, dry_run, transaction,
  requested, changed, would_change, no_change, skipped, items[{application_id,
  application_no, outcome CHANGED|WOULD_CHANGE|NO_CHANGE|SKIPPED,
  skip_reason?, from_stage, to_stage?, fraud_flag_ids?, ...}]}`. Skip
  reasons: NOT_FOUND_OR_OUT_OF_SCOPE, WRONG_STAGE_FOR_ROLE,
  NEEDS_INDIVIDUAL_ELIGIBILITY_REVIEW, HELD_BY_FRAUD_REVIEW,
  NO_MATCHING_DOCUMENT_SLOT, NOT_DEFECTIVE, NO_OPEN_ITEMISED_DEFICIENCY.
  There is no bulk reject, and bulk actions never release fraud holds.
- Fraud: `GET /applications/:id/fraud-flags` (reviewers + AUDITOR) ->
  `{application_id, application_no, current_stage, held, holding_flag_ids[],
  flags[{id, created_at, flag_type, severity LOW|MEDIUM|HIGH, status,
  subject_type, application_id, institution_code, related_application_ids,
  related_document_ids, confidence, summary, evidence, detector,
  reviewed_by_officer_id, reviewed_at, review_notes}]}`. Flag types:
  SHARED_BANK_ACCOUNT, REPEATED_CERTIFICATE_NUMBER, DUPLICATE_FILE_HASH,
  INSTITUTION_SURGE, FUZZY_IDENTITY_MATCH. `POST .../fraud-checks`
  (reviewers) -> the same + `run`. `POST /fraud-flags/:id/disposition`
  `{status CONFIRMED|FALSE_POSITIVE|NEEDS_MORE_INFO, notes (required, >= 10)}`
  -> the flag. Evidence contains field names, counts, ids and a keyed-hash
  method note; `summary` is English text that embeds ids and counts.
- `GET /analytics/fraud?from&to(<=366 days)&scheme?&academic_year?`
  (reviewers, SUPER_ADMIN, AUDITOR) -> `{meta, application_flags[{flag_type,
  severity, status, flags, applications}], institution_flags[...],
  held_applications:{total, by_stage[]}}`. Counts are **not** suppressed in
  this view (plain numbers). Other views return `"<N"` / `"suppressed"`
  strings, which the portal prints as returned.
- Selection lists (readers = COMMITTEE + reviewers + AUDITOR):
  `GET /selection-lists?scheme&academic_year` -> `{lists[{id,
  selection_run_id, scheme_code, academic_year, status DRAFT|
  PROVISIONAL_PUBLISHED|OBJECTION_WINDOW_CLOSED|FINAL_PUBLISHED,
  approvals_required, objection_window_days, provisional_published_at,
  window_closes_at, window_closed_at, window_closed_early,
  final_published_at, created_at}]}`; `GET /selection-lists/:id` -> the list
  + `list_decisions[{kind, reason, officer_id, created_at}]`,
  `entries_in_scope`, `entries[{id, application_id, application_no,
  computed_outcome, computed_rank, not_selected_reason, vertical_category,
  horizontal_reservation, committee_decision INCLUDE|EXCLUDE|null,
  final_outcome, decisions[]}]`. Actions: approve `{reason?}` (COMMITTEE,
  DRAFT); override `{decision, reason (>= 10)}` (COMMITTEE, DRAFT);
  publish-provisional (MINISTRY; needs approvals_required approvals after
  the last override); objections/:grievanceId/decide `{outcome UPHELD|
  DISMISSED, reason (>= 10)}` (COMMITTEE, PROVISIONAL_PUBLISHED);
  close-objection-window (MINISTRY; window elapsed, no pending objections);
  close-objection-window-early `{reason}` (COMMITTEE); publish-final
  (MINISTRY, OBJECTION_WINDOW_CLOSED). The API has no waitlist and no
  quota counts.
- **The committee cannot list objections:** `GET /grievances` is for
  APPLICANT + reviewer roles only; COMMITTEE may only call
  `GET /grievances/:id`. The portal lists SELECTION_OBJECTION grievances
  for reviewer roles and gives the committee a grievance-id field
  (BACKEND_REQUESTS R5).
- `GET /audit/verify` (SUPER_ADMIN, AUDITOR) -> `{ok, checked_at,
  legacy:{rows, digest, checkpoint_rows, checkpoint_digest,
  matches_checkpoint, vouches_for, cannot_vouch_for, first/last_created_at_us},
  chain:{rows, first_seq, last_seq, last_hash, head_seq, head_hash,
  vouches_for, cannot_vouch_for}, first_break:{kind, record_id, seq, detail,
  fields?}|null, denials:{ok, legacy, chain, first_break}}`.
- `GET /authorization-denials?limit&before&denial_reason&subject_type&subject_id`
  (MINISTRY, SUPER_ADMIN, SNO, DNO, AUDITOR) -> `{denials[]}` raw rows
  (occurred_at, actor ids/type/role, action_attempted, subject_type/id,
  denial_reason, details, jurisdiction, ip_address, request_id, prev_hash,
  record_hash, seq, hash_version, hash_input). The portal shows neither the
  IP address nor details. Risk: `seq` is a Prisma BigInt and no BigInt JSON
  handling was found in the backend, so this route may answer 500 once a
  chained row is returned (not verifiable without credentials;
  BACKEND_REQUESTS R7).
- `GET /document-access?document_id&application_id&limit` (same roles) ->
  `{accesses[{id, accessed_at, actor_account_id, actor_role, access_kind
  LIST|VIEW|CROP|DOWNLOAD, resource_type, resource_id, application_id,
  document_id, route, request_id, jurisdiction_state/district}]}`.

### d. Demo officer accounts (emails only, backend/docs/DEMO.md)

- Ministry: `ministry.demo@example.org`
- State nodal officer: `sno.jharkhand.demo@example.org`
- District nodal officers: `dno.gumla.demo@example.org`,
  `dno.khunti.demo@example.org`, `dno.lohardaga.demo@example.org`
- Institute nodal officers: `ino.<code>.demo@example.org` for jh-gum-01..03,
  jh-khu-01..02 and jh-loh-01..03 (e.g. `ino.jh-khu-02.demo@example.org`)
- Committee: `committee.jharkhand.demo@example.org`
- Auditor: `auditor.jharkhand.demo@example.org`
- SUPER_ADMIN: `admin.p11@example.org`
- Applicants: `<name>.demo@example.org`, e.g. `a01.kusum.beck.demo@example.org`
- Passwords: only in `../.demo-seed/demo.env` (not opened).

## Step 2.1: scrutiny

- Queue from `GET /applications/queue` with the eligibility-review and
  fraud filters (URL query `?review=`, `?fraud=`); priority by SLA risk
  (past SLA, due within 2 days, on track, no SLA), computed from `sla`.
  The design's hard-coded case (Meera Tudu, NRF-25-018742, the certificate
  scan, "AI EXTRACTION 62%", "08 of 14", "Clear 6 identical issues") is gone.
- Case view (`?app=<id>`): application, documents and slots; the extracted
  fields with confidence and review state; the routing reasons recomputed
  from the backend rule (R4); fields that differ from the applicant data
  (names only, as the API returns them).
- **No original scan:** the viewer says "Original scan viewer not
  available" and shows file name, type, size, SHA-256 prefix, source and
  quality result instead (R3).
- Correct / confirm: `POST /documents/:id/confirm`; the reason is required
  (>= 10 characters, counted in the UI) when a value is changed, optional
  otherwise, exactly as the backend enforces it.
- Verify (reason required only when confirming a manual eligibility review),
  reject and mark defective (reason required, >= 10), issue a deficiency
  (reason required; officer items + automatic checks; dry run first, then
  issue). The design's "Officer note (optional)" is now the required reason
  where the backend requires one.
- Bulk: up to 25 ticked rows; VERIFY, MARK_DEFECTIVE, RESOLVE_DEFICIENCY;
  "Run for real" is enabled only after a dry run with the same inputs;
  per-item outcome and skip reason (including fraud-held items) are listed.
  ISSUE_DEFICIENCY in bulk is not offered (it needs a canonical document
  type and check per batch; the per-application deficiency covers it).
- Not exercised live: no officer credentials (see step 1.5).

## Step 2.2: fraud

- Table: `GET /applications/queue?fraud=HIGH` (held) or `ANY`, with the
  signal and severity of the most severe open flag. Real severities LOW,
  MEDIUM, HIGH only; the design's numeric risk scores (94, 87, ...),
  "Critical", "Showing 1-5 of 56" and the invented rows are gone.
- Flags: `GET /applications/:id/fraud-flags`; evidence shown as ids (first 8
  characters), counts and field names only. The English `summary` and the
  evidence strings are not shown.
- Disposition: `POST /fraud-flags/:id/disposition` (CONFIRMED,
  FALSE_POSITIVE, NEEDS_MORE_INFO) with the required reason (>= 10).
- "Run detection scan" is now "Run fraud check on the selected application"
  (`POST /applications/:id/fraud-checks`), enabled when a case is open.
- Metric cards: `GET /analytics/fraud` for the last 366 days (to is
  exclusive): applications held, and applications per flag type. A total is
  summed only when every cell is a number; otherwise the cells are shown
  as returned. The full table of rows is available under the cards. "Export
  report" was removed (the export routes need an authenticated download).
- AUDITOR may read flags but not the queue; the fraud module is shown to
  reviewer roles only.

## Step 2.3: selection

- Lists from `GET /selection-lists`; the entries of one list from
  `GET /selection-lists/:id`: computed rank, category and reservation,
  computed outcome, committee decision and final outcome side by side.
- The design's "Waitlist", 60:40 score columns, "1,842 eligible", "100
  provisionally selected", the quota widget numbers (100, 34, 06, 03, 30%,
  5%) and the invented rows are gone. The summary cards are counts of the
  returned entries (labelled "in your scope"); the API has no quota figure.
- Buttons by role and list state (the backend's SELECTION_LIST_WORKFLOW):
  COMMITTEE approve (DRAFT, note optional), override INCLUDE/EXCLUDE (DRAFT,
  reason required), decide objection UPHELD/DISMISSED (reason required,
  up to 4000 characters), close window early (reason required); MINISTRY
  publish provisional (disabled until the approvals after the last
  override reach approvals_required), close window (after it elapses),
  publish final. Publishing and closing ask for confirmation first.
- Objections: reviewer roles see this run's SELECTION_OBJECTION grievances
  (`GET /grievances`, filtered by `selection_run_id`); the committee enters
  a grievance id (R5).
- "Approvals since the last override" is derived from `list_decisions` and
  the entries' override decisions, with the backend's rule.

## Step 2.4: audit

- "Verify full chain" calls `GET /audit/verify` (SUPER_ADMIN, AUDITOR) and
  shows the real result: overall ok, chained rows, legacy rows and whether
  they match the checkpoint, the denials chain (rows, ok, its legacy rows
  and checkpoint), the chain head, the first break of each chain (kind,
  sequence, row id), and the backend's own "vouches for / cannot vouch for"
  texts (English, as returned). Nothing is shown before it is run.
- The fake event ledger is replaced by two tables: authorization denials
  (`GET /authorization-denials`, paged with `before`) and document access
  (`GET /document-access`, latest 200). Both show ids, roles, kinds,
  jurisdiction and hashes only; no audit row content, no IP address, no
  details JSON. "Export signed log" and "View cryptographic proof" were
  removed (no such routes).
- Roles: verify for SUPER_ADMIN and AUDITOR; the tables for MINISTRY,
  SUPER_ADMIN, SNO, DNO and AUDITOR. INO and COMMITTEE have no audit module.

## Step 2.5: analytics

- One Analytics screen with four views: funnel, SLA, verification quality
  (`GET /analytics/<view>?from&to&scheme`) and fairness
  (`GET /analytics/fairness?scheme&academic_year`: fairness has no date
  window; scheme and academic year are required by the backend).
- Date window control: from (inclusive) and to (exclusive); the UI refuses
  windows over 366 days, as the backend does.
- Every section is rendered generically: row arrays as tables, objects as
  key/value cards; every cell is printed exactly as returned, so the
  backend's suppression markers (`"<5"`, `"suppressed"`) appear verbatim.
  The view's own `meta.suppression` text is shown above the data (English,
  from the backend). Column headings are the API field names.
- Roles: funnel, SLA and verification quality for reviewers, SUPER_ADMIN
  and AUDITOR; fairness also for COMMITTEE.

## Step 3: proofs

- 3.1 `pnpm typecheck` and `pnpm build` pass. Offline check on the final
  `dist` (ripgrep pattern via the agent search tool; `rg` is not installed):
  `http://localhost` (react-router URL base), `http://localhost:3000/api/v1`
  (API default), XML/SVG/MathML namespaces, and inert text inside library
  messages (`https://react.dev/errors/`, `https://reactrouter.com/...`,
  `https://github.com/ungap/url-search-params.`, the Tailwind licence
  comment). Nothing is fetched from them.
- 3.2 `node scripts/click-path.mjs`: 4 passed, 0 failed, 3 skipped. It
  proves the wrong-password refusal and the applicant refusal (login,
  `/auth/me` role=APPLICANT, 403 on the officer queue). Officer, committee
  and auditor steps are skipped: no officer credentials exist in
  `.env.local`. With `E2E_EMAIL`/`E2E_PASSWORD` (and the optional role
  pairs) it runs queue, case, documents, the REASON_REQUIRED refusal,
  deficiency dry run, bulk dry run, fraud flags and checks, disposition
  refusal without a reason, analytics/fraud, selection lists, denials,
  document access and audit verify; `--write` adds one verify (or mark
  defective) and one disposition.
- A synthetic applicant (`e2e.admin-refusal.*@example.org`) was registered
  on the local backend through the public register route for the refusal
  check; its generated credentials are only in the git-ignored `.env.local`.
- 3.3 Role gating. Live: APPLICANT refused in the browser (message shown,
  logout sent, no token left in storage). Officer roles: **not tested
  live** (no credentials). In the browser, with `fetch` stubbed by synthetic
  data for a render test only, the sidebar and actions per role were:
  INO: Scrutiny, Fraud, Selection, Analytics. DNO / SNO: + Audit (logs, no
  verify). MINISTRY: all five; "Publish provisional list" on a DRAFT list.
  COMMITTEE: Selection, Analytics; "Approve" and "Record override".
  AUDITOR: Selection, Audit (verify + logs), Analytics. SUPER_ADMIN: Audit
  (verify + logs), Analytics. A mocked 403 showed "Not permitted for your
  role" with the request id; a 9-character reason kept the action disabled
  with the counter shown.
- 3.4 English and Hindi: every wired screen rendered in both languages
  (stubbed data) with no crash and no raw message key; in Hindi the only
  English was API data (the mock notice). `grep` for JSX text finds
  hard-coded English only in the hidden, unrouted Scheme Studio design.
- 3.5 `console.` does not occur in `src`.
- Browser console during the checks: Vite and React DevTools notices, and
  one expected 400 (`POST /auth/refresh` with the stub's fake refresh token
  after a reload, which correctly fell back to the login screen).
- Fix found during the checks: after an explicit logout the next login
  returned to the previous user's screen; now only an expired session (or a
  first deep link) keeps the return path.

## Live pass 1: shape check (2026-09-29)

`node scripts/shape-check.mjs` logged in as STATE_NODAL_OFFICER, COMMITTEE
and AUDITOR (credentials from `.env.local`) and called every GET endpoint
the portal uses. Output: `docs/live-shapes/<ROLE>.txt` (field names and
JSON types only; values only for enum-like fields). Interpretation of
"enum-like": a field named status, stage, severity, role, type, outcome or
reason_code, or ending in `_status`, `_stage`, `_severity`, `_role`,
`_type`, `_outcome`. That rule also printed two descriptive analytics
`meta` strings (`meta.document_type`, `meta.institution_type`) and the
document slot labels (`document_type`); they are backend texts, not personal
data. The first auditor login hit the login rate limit (5/min per IP,
HTTP 429); the script now waits 65 s and retries once.

Status per role (HTTP): SNO 200 on all except `/audit/verify` (403, as
designed). COMMITTEE 200 on `/selection-lists`, `/selection-lists/:id`,
`/analytics/fairness`; 403 on queue, fraud/funnel/sla/verification-quality
analytics, grievances, audit, denials, document access (all as in
`permissions.ts`). AUDITOR 200 on analytics, selection, audit verify,
denials, document access; 403 on queue and grievances (as designed).

### Mismatches against src/api/responses.ts

| # | Endpoint / type | Kind | Detail |
|---|---|---|---|
| M1 | `/officers/me/preferences` (OfficerPreferences) | extra fields | `supported_languages: string[]`, `updated_at: string|null` |
| M2 | DocumentView `extraction.classification.alternatives` | type too loose | live: `Array<{type, confidence}>` (typed `unknown`); alternative `type` is lower case (`marksheet`) while `classification.type` is upper case (`CASTE_CERTIFICATE`) |
| M3 | DocumentView `extraction.eligibility_mismatches` | type too loose | live: `Array<{field, source, sensitive}> | null` (typed `unknown`) |
| M4 | DocumentView `extraction.fields[].value` | narrower | live `string|number` (typed `unknown`; fine) |
| M5 | ApplicationDocuments `flags.document_consistency_details` | type too loose | live object `{checks, engine, confidence, min_confidence, documents_compared}`; `document_consistency_status` value `CONSISTENT` |
| M6 | ApplicationDetail `aadhaar_authentication.status` | enum | value `NOT_ATTEMPTED` (untyped string; no label) |
| M7 | SelectionList `window_closed_early` | narrower | always boolean live (typed `boolean|null`; compatible) |
| M8 | SelectionEntry `computed_rank` | null in practice | `null` for every entry of the observed FINAL_PUBLISHED list; the rank column must not be the only ordering hint |
| M9 | Grievance | extra fields (unused) | `raised_by_applicant_id, selection_id, disbursement_id, description, status_entered_at, resolution_note, resolved_by_officer_id, resolved_at` |
| M10 | AuthorizationDenial | extra fields (unused on purpose) | `actor_user_id, actor_id, details{...}, jurisdiction_source, ip_address, request_id, prev_hash, hash_version, hash_input`. **`seq` is a string**, so BACKEND_REQUESTS R7 (BigInt) does not occur |
| M11 | DocumentAccess | extra fields (unused) | `actor_account_id, route, request_id` |
| M12 | Fraud flag `evidence` | shape | keys vary by detector: `score, calibration, dob_relation, name_relation, district_match, matched_application_ids, field, match, sources, key_version, matched_document_ids, other_applicant_count`. The evidence list printed `key_version` as if it were a count |
| M13 | `/analytics/sla` `longest_waits` | render | array of **strings**, not rows; the generic renderer printed it as JSON |
| M14 | `/analytics/funnel` | shape | `steps[{step, count, of, base, conversion}]`, `current{pending, under_review, defective, rejected}`, `held{count, note}`, `state_dbt{count, status, note}` (generic view; no type needed) |
| M15 | `/analytics/fairness` | shape | `total{applied, selected, selection_rate}`, `dimensions{category, gender, pwd_status, district, institution_type}[]`; `selected`/`selection_rate` are `number|string` (suppression markers) |
| M16 | Fraud screen data source | behaviour | `GET /applications/queue?fraud=HIGH` returns 0 rows for SNO: the held applications wait at INO_VERIFIED and the queue lists only the caller's stages; `/analytics/fraud` reports them. The held table therefore needs a jurisdiction-wide source |

Enum values seen and already covered: stages, list statuses (DRAFT,
PROVISIONAL_PUBLISHED, FINAL_PUBLISHED), severities (LOW, MEDIUM, HIGH),
flag types, flag status OPEN, review statuses, grievance statuses (OPEN,
REJECTED, RESOLVED), actor types, roles. Not typed / no label: aadhaar
status `NOT_ATTEMPTED`, analytics `state_dbt.status`
`SELECTED_DISBURSEMENT_BY_STATE_DBT`.

## Live pass 2: types and screens

- `src/api/responses.ts`: M1 (preferences fields), M2 (classification
  alternatives), M3 (eligibility mismatches typed), M5 (consistency
  details), comments for M6, M7, M8 and M10 (`seq` is a string).
- Fraud (M16): the held/flagged table now scans the jurisdiction by default
  (`GET /applications`, then `GET /applications/:id/fraud-flags`, 6 at a
  time, with a progress line); "My queue only" keeps the queue source for
  reviewer roles. AUDITOR now gets the fraud module read-only (both routes
  allow it). Evidence no longer lists `key_version` (M12). BACKEND_REQUESTS
  R8 asks for a direct route.
- Analytics (M13): arrays of primitives (e.g. `sla.longest_waits`) render as
  a list instead of JSON.
- Null safety: queue rows (`sla`, `fraud`), documents, extraction fields,
  classification, selection entries and decisions, audit sub-reports and
  fraud analytics arrays are read with fallbacks; a missing field shows "–"
  or the empty state instead of throwing.
- Every screen has a loading state, an empty state and an error state
  (`ErrorNote`: mapped message, "Not permitted for your role" on 403, and the
  backend request id).

## Live pass 3: screens against the live backend (preview browser, real logins)

Logins: `sno.jharkhand.demo@example.org` (STATE_NODAL_OFFICER) and
`auditor.jharkhand.demo@example.org` (AUDITOR), read-only. Expected numbers
are the ones given in the task: backend `docs/DEMO.md` and
`scripts/demo/check-demo.mjs` are no longer on the backend's checked-out
branch, so they could not be read. (Finding that out, the agent ran one
read-only `git log` inside the backend repo, against the rule "git only in
this folder"; nothing was changed and it was not repeated.)

| Screen | Result | Detail |
|---|---|---|
| Scrutiny | **MATCHES** | Queue lists 8 applications at "At state review", ordered by SLA risk (past SLA first). The 6 with documents show slots, extracted fields with confidence, the review state and a routing reason (e.g. "classified as unknown_document, which differs from the slot"); the 2 without documents show the empty state. "Original scan viewer not available" shown. |
| Fraud | **MISMATCH (table), MATCHES (cards)** | Cards from `/analytics/fraud`: 4 applications held; identical file 2 and shared bank account 2 applications, i.e. 4 flags on 4 applications. The held table cannot show those 4: `GET /applications` is capped at the newest 100 (no paging) and includes test data, so the scan lists 8 held test applications instead. Fixed what the UI can: a warning now states the cap and the analytics count. Needs BACKEND_REQUESTS R8. |
| Selection | **MATCHES** | 3 lists for 2025-26, all "Final list published": POST_MATRIC 9 entries, TOP_CLASS 7 (1 committee exclusion shown beside the computed outcome), NFST 12. 28 entries in total. 5 other lists (other years, test data) are listed too. `computed_rank` is null for POST_MATRIC and TOP_CLASS entries (shown as "–"). |
| Audit | **MATCHES** | "Verify full chain" (auditor): ok on both chains, no break; 8,188 chained rows, 857 legacy rows matching the checkpoint, denials chain 158 rows intact, 34 legacy denial rows matching the checkpoint. Denials table 50 rows, document access 200 rows. |
| Analytics | **MATCHES** | Funnel: submitted 60, verified 28, selected 28, sanctioned 11 (disbursed 0; held 4; state DBT 9). SLA, verification quality (4 rows) and fairness (NFST 2025-26; 5 dimension tables, suppression markers "<5" and "suppressed" shown verbatim) render. |

Other observations:
- The API container was restarted externally during the pass (restart
  count 0, exit code 0, clean start); two requests failed with
  ERR_CONNECTION_REFUSED at that moment and succeeded after it.
- A Vite hot reload of `en.ts` produced "useI18n outside I18nProvider" (dev
  only, as seen in the student app); a fresh load fixed it and restored the
  session from the refresh token (only `vidyasetu.refresh` in storage).
- The auditor now sees the fraud module read-only (Refresh only, no queue
  source, no actions) with the same 8 held test applications.
- Login rate limit (5/min per IP) was hit twice by the scripts; the shape
  check waits and retries.
- Edge case: after a full page reload the first page counts as a deep link,
  so an explicit logout from it keeps that page as the return path.

## Live pass 4: write actions (ALLOW_WRITE=1)

Both made through the UI in the preview browser as the state nodal
officer, then confirmed through the API (statuses only):

- **Verify:** Scrutiny, case VS-2025-26-6D03DF8C98 (demo application at
  state review, no eligibility review needed), remarks "Live verification
  pass: documents reviewed at state level". UI: "Done: At state review ->
  Approved by the state; with the ministry". API before
  `current_stage=SNO_VERIFIED status=UNDER_REVIEW`; after
  `current_stage=MINISTRY_APPROVED status=APPROVED`, stage entered
  2026-09-29T16:42:13Z. This moves one demo application forward: later
  demo checks that count state-level queues will see one fewer.
- **Fraud disposition:** Fraud, source "My queue only", "Any open flag",
  application VS-2026-27-3D346E646D (test data, not the demo cohort), one
  MEDIUM FUZZY_IDENTITY_MATCH flag -> NEEDS_MORE_INFO with the notes
  "Live verification pass: evidence reviewed, more information requested".
  API before: 17 flags all OPEN, none reviewed, held=false; after: flag
  70aa1a3c `NEEDS_MORE_INFO` reviewed 2026-09-29T16:42:34Z, the other 16
  still OPEN, held=false.

## Stage F3-A step 1: Scheme Studio investigation (read only)

### 1.1 OpenAPI refresh and authoring routes

`openapi/openapi.json` refreshed from `http://localhost:3000/docs/openapi.json`
(HTTP 200, 87,456 -> 94,497 bytes); `pnpm gen:api` regenerated
`src/api/schema.ts`. New paths since F2: `GET /schemes` (public list of
active versions), `GET /documents/{id}/file` (original document: answers
BACKEND_REQUESTS R3), `GET /selection-lists/{id}/objections` (answers R5),
`GET /applications/{id}/history`. They are not wired in this stage.

Authoring routes (`api/src/schemes/scheme-authoring.controller.ts`, all under
`/api/v1/admin/schemes`). Reads: every officer role (AUDITOR included).
Writes: `SCHEME_AUTHOR_ROLES` (create, draft, edit, validate, preview) and
`SCHEME_PUBLISHER_ROLES` (publish, retire); both default
`SUPER_ADMIN,MINISTRY_OFFICER` (docker-compose passes the same default).

| Route | Roles | Request (generated DTO) | Response (from source) |
|---|---|---|---|
| `GET /admin/schemes` | officers | - | `{known_workflows[], schemes[{id, code, name, department, description, type, portal_url, is_active, disbursement_mode, created_at, updated_at, versions[{id, version_no, status draft/active/archived, effective_from, effective_to, created_at, updated_at}]}]}` |
| `POST /admin/schemes` | author | `CreateSchemeDto {code ^[A-Z][A-Z0-9_]{1,31}$, name, department, description?, type CENTRALLY_SPONSORED/CENTRAL_SECTOR, portal_url?, disbursement_mode?}` | the scheme; 409 `scheme_code_exists` |
| `GET /admin/schemes/:code/versions/:v` | officers | - | `{scheme, version{...summary, scheme_id, config, source_document, source_url, extraction_confidence, extraction_notes}, editable}` |
| `POST /admin/schemes/:code/versions` | author | `CreateDraftDto {config? | based_on_version?, source_*?}` | the new draft (version_no = max + 1) |
| `PATCH /admin/schemes/:code/versions/:v` | author | `UpdateDraftDto {config?, source_*?}` | the draft; 409 `version_published` for active/archived (API and a database lock) |
| `POST .../:v/validate` | author | - | `{scheme_code, version_no, status, valid, rules_by_type, form_fields[], document_checklist[], workflow}` or 400 |
| `POST .../:v/preview` | author | `PreviewVersionDto {applicant}` | `{outcome, eligible, rules[{rule_id, rule_type, verdict, value, message_key, explanation}], form_schema, stored:false}` |
| `POST .../:v/publish` | publisher | `PublishVersionDto {effective_from?}` | `{version, superseded[]}`; the previous active version is archived; 409 `effective_from_not_after_active_version` |
| `POST .../:v/retire` | publisher | - | the version (archived); 409 `version_not_active` |
| `GET /admin/schemes/:code/diff?from&to` | officers | `DiffQueryDto` | `{scheme_code, from, to, change_count, changes[]}` |

Validation: **create draft and edit draft validate before saving**, so an
invalid config is refused (400) and never stored; the validate route
re-checks a stored config. Each issue: `{field, message_key, params,
constraints}`; keys `scheme_config.schema_violation, expr_blank,
duplicate_rule_id, expr_unparseable, param_missing, unknown_workflow,
benefit_condition_unparseable, too_large, selection_policy_invalid`. The
backend ships en and hi text for them (`schemes/config-messages.ts`, Hindi
machine-drafted); the portal mirrors that catalogue.

### 1.2 Config schema and a seeded config

`api/schemas/scheme-config.schema.json` (7,414 bytes). Top level open
(`additionalProperties: true`); required `rules, benefits,
required_documents, fund_sharing_ratio`.

| Section | Schema | In the seed (POST_MATRIC v2) |
|---|---|---|
| Eligibility rules | `rules[]{id, type eligibility/benefit_note/operational/unmapped, expr, params{}, doc_refs[], message_key, verification?}`; expressions in the rules grammar; every `params.<key>` read must exist | 3 eligibility + 1 operational, e.g. `applicant.family_income_annual <= params.income_ceiling` with `income_ceiling: 250000`; `applicant.category in params.allowed_categories` with `["ST"]` |
| Mandatory documents | `required_documents: string[]` (free text labels) | 8 labels |
| Scoring weights | **not in the schema** | none |
| Selection policy | optional, closed: `basis NO_COMPETITION/RANKED_NO_CAP/QUOTA`, `merit{rule_id, direction HIGHER/LOWER_IS_BETTER}`, `pools[]{key ST_OTHERS/PVTG, seats >= 0, female_percentage 0-100, rounding HALF_UP/FLOOR/CEIL}` | absent in all 16 seeded versions (the platform maps NFST/NOS itself) |
| Workflow key | optional string; must be one of `known_workflows` (one: the platform workflow) | absent |
| Reservations | only as `pools` (ST_OTHERS, PVTG) with a female percentage; **no PwD pool**, no other pool keys | none |
| Benefits | `benefits[]{id, condition?, description, amounts, currency, ...}` | 3 |
| Fund sharing | `fund_sharing_ratio: string|null` | free text |

### 1.3 Design controls: stay, change or go

| Design control | Decision |
|---|---|
| Header "Saved 2 min ago" | change: real `updated_at` of the version, and save state from the last save response |
| "ACTIVE VERSION v4.2 · Draft" | change: real version picker (version_no + status) |
| "Publish changes" | change: publish the selected draft (confirmation: becomes immutable) |
| Eligibility rule block "Applicant category IS EXACTLY Scheduled Tribe (ST)" | change: one block per rule; expression shown read-only, params editable (e.g. `allowed_categories`) |
| Toggle on each rule | go: the schema has no enable flag |
| "Annual family income, Less than or equal to 8,00,000" | change: the real `income_ceiling` param (the design's 8,00,000 conflicts with the seeded 2,50,000) |
| Mandatory documents list + "Add document" | stay: `required_documents` strings (add, remove) |
| "Weighted composite score 100 points", "Academic merit 60%", "Research proposal 40%" | go: no weights in the schema; replaced by selection basis + merit rule + direction |
| "Horizontal reservation", "Women candidates 30%" | change: per pool (ST_OTHERS, PVTG) seats, female percentage, rounding |
| "Persons with Disabilities 5%" | go: no PwD pool in the schema |
| (new) Workflow key | select from `known_workflows` |
| (new) Advanced JSON | the exact config, editable, saved through the same validation |

### 1.4 Roles

- Author and publish: MINISTRY_OFFICER and SUPER_ADMIN (both lists default
  to these two; configurable on the server).
- AUDITOR: may read (`GET /admin/schemes`, one version with config, diff),
  may not create, edit, validate, preview, publish or retire. The other
  officer roles have the same read access; the portal shows the Studio to
  authors and, read-only, to AUDITOR (as the task asks).
- `.env.local` has no `E2E_MINISTRY_EMAIL` / `E2E_MINISTRY_PASSWORD` yet;
  step 3.2 needs them.

## Stage F3-A steps 2 and 3: Scheme Studio built and proven

Live checks in the preview browser (ministry officer, auditor, institute
officer) and by script:

- 2.1 list: 8 schemes with their versions and status, from
  `GET /admin/schemes`.
- 2.2 create: scheme `STUDIO_UI_TEST_0930` and a draft copied from
  POST_MATRIC v2 (4 rules, 8 documents); a duplicate code shows "A scheme
  with this code already exists" with the request id (409
  `scheme_code_exists`).
- 2.3 editor: income ceiling 250000 -> 300000 saved; an invalid config via
  the JSON panel (pool key `PWD`, no merit) was refused with 3
  `scheme_config.schema_violation` issues shown at the selection card; with
  the policy removed, `scheme_config.param_missing` was shown under the
  `income_ceiling` rule; after the fix, "Validate on server" returned the
  summary (5 form fields, 13 checklist documents). A published version has
  no enabled input, no Save and a read-only JSON panel. Note: the server
  reports schema violations first and the code-level checks only when the
  schema passes.
- **The database was restored during the session** (API container
  restarted at 21:09 UTC, Postgres not restarted; sessions invalidated;
  `STUDIO_UI_TEST_0930` gone). The portal showed the not-found error with
  its request id. Later tests used a new scheme, `STUDIO_UI_PUB_0930`.
- 2.4 preview on POST_MATRIC v2 (read only): income 180000 -> Eligible;
  320000 -> Not eligible, `income_ceiling` Fail, others Pass/Computed.
- 2.5 publish and retire on `STUDIO_UI_PUB_0930` v1: dialogs shown; Active
  and in the public `GET /schemes`; then Archived and gone from it.
- 2.6 diff NFST v4 -> v5: 13 changes (added, changed).
- 3.2 `node scripts/scheme-closer.mjs`: 16 passed, 0 failed (output in the
  final report); scheme `CLOSER_TEST_1790716713873` created, published and
  retired.
- 3.3 role gating (API): INSTITUTE_NODAL_OFFICER `GET /admin/schemes` 200,
  create / preview / publish 403; APPLICANT 403 on all; AUDITOR list 200,
  writes 403. UI: the institute officer has no Studio item and `/studio`
  redirects to Scrutiny; the auditor sees a read-only Studio (badge, no
  create/save/validate/preview/publish/retire, 0 enabled inputs, diff
  available); the applicant is refused at login (earlier proof).
- 3.4 Hindi: list, draft editor, save error (the backend key rendered in
  Hindi), preview result, diff, publish dialog and create forms rendered
  with no raw keys; the only English left is API data (rule parameter
  names, form field keys, scheme names). `console.` does not occur in
  `src`. Switching language saved the ministry officer's preference; it was
  set back to English.
- 3.1 offline: `dist` lists only localhost, XML/SVG namespaces and inert
  library text (as before).
- Scheme name and department are not editable after creation (R10); test
  schemes cannot be deleted (R9); public list vs. eligibility check differ on
  test fixtures (R11).

## F2-B step 1: OpenAPI refresh (2026-09-30)

`openapi/openapi.json` fetched again (HTTP 200, 94,497 bytes, unchanged
since F3-A step 1); `pnpm gen:api` regenerated `src/api/schema.ts`.

| Item | Exists | Response schema |
|---|---|---|
| `GET /documents/{id}/file` | yes: "The stored file of one document (JPEG, PNG, WebP or PDF), streamed inline" | 200 `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (binary) |
| `GET /applications/{id}/history` | yes: "stages, action, time; no officer or reason" | `ApplicationHistoryDto {application_id, history: HistoryEntryDto[]}`; entry `{from_stage, to_stage, trigger_action, at}` |
| `GET /selection-lists/{id}/objections` | yes: "ids, status and dates only (no names, no text)" | `ListObjectionsDto {selection_list_id, objections: ObjectionDto[]}`; objection `{grievance_id, application_no, status OPEN/IN_PROGRESS/RESOLVED/REJECTED, created_at, decided}` |
| `name` / `institution_code` in `GET /auth/me` | yes (officers) | `MeDto` adds `name?`, `institution_code?` |
| `GET /schemes` | yes (public) | `ActiveSchemesDto` |
| `selection_run_id` in the selection result | yes | `SelectionResultDto.list.selection_run_id` |

Only 7 routes have a 2xx schema (these five plus the two health routes);
all other responses are still undocumented, so the rest of
`src/api/responses.ts` stays hand-written (R1 stays open).

Replaced with generated types: `Me` (`MeDto`, `role` narrowed to the role
union), new `HistoryEntry` / `ApplicationHistory`, `ListObjections` /
`Objection`. Spec quirk: `HistoryEntryDto.from_stage` and
`SelectionResultListDto.window_closes_at` are declared nullable without a
type and generate as `Record<string, never> | null`; the portal overrides
`from_stage` to `string | null` (BACKEND_REQUESTS R12).
