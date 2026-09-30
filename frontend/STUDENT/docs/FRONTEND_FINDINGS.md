# Frontend findings (student portal)

Findings, blockers and deviations recorded while wiring the Figma Make
export to the VIDYASETU backend. Newest sections at the bottom.

## Step 0: housekeeping

- `pnpm typecheck` (`tsc --noEmit`) passed with no errors on the design
  baseline; nothing to fix.
- `.env.local` is git-ignored by the `.env*` rule in `.gitignore`
  (`git check-ignore -v .env.local` -> `.gitignore:6:.env*`).
- Dev and preview host default changed to `127.0.0.1`
  (`FIGMA_DEV_SERVER_HOST` still overrides it).

## Step 1: investigation (read only)

### 1.1 OpenAPI

- `curl http://localhost:3000/docs/openapi.json` -> `HTTP 200 87456 bytes`,
  saved to `openapi/openapi.json` (OpenAPI 3.0.0, "VIDYASETU API" 0.1.0).
- **Gap: the spec documents request bodies and the error shape only.**
  Every 2xx response is `{"description": ""}` with no schema, so
  `openapi-typescript` can generate request DTOs, path/query parameters
  and `ErrorResponseDto`, but no response types. Response shapes below were
  read from the backend source (read only) and from real responses of the
  public routes. Recorded in docs/BACKEND_REQUESTS.md (R1).
  Frontend consequence: `src/api/responses.ts` holds narrow response view
  types, each marked "not in OpenAPI"; request types come only from the
  generated `src/api/schema.ts`.

### 1.2 Error language

- Error bodies are `{code, message, details, requestId}` (ErrorResponseDto;
  `code` is an enum of 18 values).
- `message` is **English text** from one catalogue
  (`api/src/common/errors/error-messages.ts`, marked "TODO(i18n)"). It is
  not a key and is not localised per request.
- Some errors carry a **message key in `details`**, e.g. 409 on
  `POST /applications`: `details.reason = "consent_required"`,
  `details.message_key = "consent.required"`, `details.missing_purposes`.
  Other structured reasons seen in source: `details.reason` values
  `invalid_refresh_token`, `no_applicant_profile`, `application_closed`,
  `slot_not_in_open_deficiency` (+ `allowed_slots`), `not_defective`,
  `deficiency_not_open`, `objection_window_not_open`,
  `not_a_non_selection`, `no_published_result`. Validation errors: 400 with
  `details: [{field, constraints}]`.
- **Language selection:** the applicant profile field `preferred_language`
  (`PATCH /applicants/me`, one of `supported_languages` returned by
  `GET /applicants/me`; default config `en,hi`). It drives consent notice
  texts (`GET /applicants/me/consents` returns `title`/`text` in that
  language plus `title_key`/`text_key`) and notification templates.
  `Accept-Language` is allowed by CORS but no code reads it. There is no
  per-request language header.
- Frontend decision: map `code`, `details.reason` and `details.message_key`
  to text in src/i18n; unknown ones fall back to the raw `message`.

### 1.3 Public schemes and eligibility

- **No public route lists schemes.** `GET /admin/schemes` needs a token
  (scheme authoring roles). Recorded as BACKEND_REQUESTS R2.
- `POST /schemes/check-eligibility` (public, 30/min per IP) with
  `{"applicant":{}}` returned HTTP 200 and evaluated **7 active scheme
  versions**, all `indeterminate` (every rule ERROR "not provided"). So an
  empty-profile call is a usable stand-in for a scheme list. Shape (field
  names only):
  `{evaluation_run_id, storage:{persisted, reason, redaction_policy, redacted_fields[]}, evaluated_at, schemes_evaluated, eligible[], not_eligible[], indeterminate[]}`
  where each scheme entry is
  `{scheme_code, scheme_name, version_no, scheme_version_id, outcome, eligible, failed_rules[{rule_id, message_key, explanation}], error_rules[{rule_id, explanation}], rules[{rule_id, rule_type, verdict, value, message_key, explanation, decisive}]}`.
- `GET /schemes/{code}/versions/{version}/form-schema` (public, 60/min):
  `{scheme_code, scheme_name, version_no, scheme_version_id, status, fields[{key, path, types[], used_by[{rule_id, rule_type}], options[], limits[{rule_id, param, value}]}], documents:{required_documents[], rule_doc_refs[{doc_ref, rule_ids[]}], checklist[]}, unparseable_rules[]}`.
  Thresholds (e.g. POST_MATRIC `income_ceiling` 250000) come from
  `fields[].limits`.
- Profile keys used by the seeded rules include `category`,
  `family_income_annual`, `education_level`, `academic_year_number`,
  `enrolled_course_duration_years`, `degree_enrolled`, ... (per scheme).
- One rule (PRE_MATRIC `pre_matric_class_tenure`) answers ERROR
  "Unexpected character "[" at position 0" for an empty profile: a
  backend rule-config issue (R6); the scheme then shows as "Needs details".

### 1.4 Field shapes (request DTOs from OpenAPI; responses from source)

- `RegisterDto` (request): email, password (12-128), first_name,
  last_name, category (ST|PVTG), domicile_state, domicile_district?,
  phone?, caste_cert_number, annual_income (string "185000.00"),
  bank_account, gender? (FEMALE|MALE|OTHER), dob? (YYYY-MM-DD),
  is_disabled?, disability_percentage?, preferred_language?.
  Response 201: `{account_id, applicant_id}` (no tokens; log in after).
- `LoginDto`: email, password. Response: `{access_token, token_type,
  expires_in, refresh_token, refresh_expires_in}` (access TTL default
  900 s, refresh 7 days).
- `POST /auth/refresh` `{refresh_token}` -> `{access_token, token_type,
  expires_in}` (no rotation). `POST /auth/logout` `{refresh_token}` -> 204.
- `GET /auth/me` -> `{accountId, role, officerId, jurisdictionState,
  jurisdictionDistrict}`. `role` values: APPLICANT, SUPER_ADMIN,
  MINISTRY_OFFICER, STATE_NODAL_OFFICER, DISTRICT_NODAL_OFFICER,
  INSTITUTE_NODAL_OFFICER, COMMITTEE, AUDITOR.
- `GET /applicants/me` -> `{applicant_id, email, first_name, last_name,
  phone, gender, dob, category, pvtg_group, is_disabled, disability_type,
  disability_percentage, domicile_state, domicile_district, annual_income,
  caste_cert_number_masked, bank_account_masked, preferred_language,
  supported_languages[], editable_fields[], updated_at}`; PATCH
  (`UpdateProfileDto`: phone?, preferred_language?) returns the same plus
  `changed_fields[]`.
- `GET /applicants/me/consents` -> `{notice_version, language,
  purposes[{purpose, required_for_applications, title_key, text_key, title,
  text, current, status, status_notice_version}], missing_for_applications[],
  history[{purpose, status, notice_version, language, method, at}]}`.
  `POST` (`ConsentDto`: purpose, status GIVEN|WITHDRAWN, notice_version,
  language) returns the same object.
- `CreateApplicationDto`: scheme_version_id, academic_year, institution_name?,
  institution_code?, course_name?, course_year?, is_hosteller?, declared?
  (object). Response 201: application view (below) + `eligibility_gate
  {outcome, routed_to, needs_eligibility_review, evaluation_run_id,
  storage, failed_rules[], error_rules[]}`. The gate runs in the same
  request, so the application is already INO_VERIFIED or DEFECTIVE.
  409 `consent_required` when consents are missing.
- `SaveApplicationDraftDto`: same fields, all optional. Draft view:
  `{id, status, scheme_version_id, academic_year, institution_name,
  institution_code, course_name, course_year, is_hosteller, declared,
  submitted_application_id, submitted_at, created_at, updated_at}`.
  `POST /application-drafts/{id}/submit` -> `{draft, application}`.
- `POST /applications/{id}/documents` multipart: `file`, `document_type`
  (a checklist slot), or `digilocker_reference`. 10 MiB default
  (`UPLOAD_MAX_BYTES`). Response 202 `{status:"PROCESSING", document_id,
  document_type, file_sha256, uploaded_at, ml_mode, mock_notice?,
  quality:{usable, issues[], confidence}, poll}` or 200
  `{status:"QUALITY_REJECTED", ..., quality:{usable:false, issues[],
  confidence}}` ("retake"). While DEFECTIVE with open items, other slots
  get 409 `slot_not_in_open_deficiency` with `allowed_slots`.
- `GET /documents/{id}` -> `{ml_mode, mock_notice?, document_id,
  application_id, document_type, file_name, mime_type, file_size_bytes,
  file_sha256, uploaded_at, state, source, digilocker, quality:{usable,
  issues[], confidence}|null, verification_status, extraction:{id, status,
  error_code, engine, classification:{type, confidence, alternatives,
  matches_slot}, review_status, review_threshold, ...}|null, ...}`.
  `state`: QUALITY_REJECTED | PROCESSING | FAILED | COMPLETED |
  review_status (e.g. NEEDS_REVIEW).
- `GET /applications/{id}/documents` -> `{application_id, ml_mode,
  mock_notice?, flags:{...}, checklist[], slots[{slot, document_id, state}],
  documents[]}`.
- `GET /applications/{id}` -> `{id, application_no, applicant_id,
  scheme_id, scheme_version_id, academic_year, current_stage, status,
  jurisdiction_state, jurisdiction_district, institution_name,
  institution_code, course_name, course_year, assigned_officer_id,
  submitted_at, stage_entered_at, stage_due_at, needs_eligibility_review}`.
  Stages: SUBMITTED, INO_VERIFIED, DNO_VERIFIED, SNO_VERIFIED,
  MINISTRY_APPROVED, DEFECTIVE, REJECTED, DISBURSED. Status is derived:
  PENDING, UNDER_REVIEW, DEFECTIVE, APPROVED, REJECTED, DISBURSED.
- **Stage history: no route for applicants** (workflow_transitions are
  read only internally). The dashboard uses the stage order of the
  workflow and the dates on the application record. BACKEND_REQUESTS R3.
- `GET /applications/{id}/deficiencies` -> `{application_id,
  application_no, current_stage, deficiencies[{id, itemised, code, title,
  status, created_at, resolved_at, items[{id, document_slot, document_type,
  field, check_code, source, problem_code, fix_code,
  previous_problem_code, deadline_at, status, stored_status, crop_ref,
  last_check, resolved_at}]}]}`. `problem_code` / `fix_code` are message
  keys (`deficiency.problem.*`, `deficiency.fix.*`); their en/hi texts live
  in the backend's notice_templates and are mirrored in src/i18n.
  `crop_ref` is always null today ("the OCR service returns no bounding
  boxes"), so the crop image is shown only when `crop_ref` is set.
- `POST /applications/{id}/deficiencies/{deficiencyId}/resubmit` ->
  `{application_id, resubmitted, transition|null, deficiency_id,
  changed_slots[], checks_run[], checks_skipped[], items[{id, status,
  problem_code, previous_problem_code}], all_cleared}`.
- `GET /applications/{id}/selection-result` -> `{application_id,
  application_no, list:{id, scheme_code, academic_year, status,
  window_closes_at}, computed_outcome, computed_rank, not_selected_reason,
  vertical_category, horizontal_reservation, committee_decision,
  final_outcome, current_outcome, score:{score_type, score_value,
  breakdown}|null}`; 404 `no_published_result` before publication.
- Objection (`POST /grievances`, `RaiseGrievanceDto`, subject_type
  SELECTION_OBJECTION) needs `selection_run_id`, which selection-result
  does **not** return; it appears only in the text of the non-selection
  notification. Allowed only when the list is PROVISIONAL_PUBLISHED, the
  window is open and the outcome is NOT_SELECTED. BACKEND_REQUESTS R4.
- `GET /notifications` -> `{count, notifications[{id, event_type,
  template_key, locale, application_id, subject, body, created_at,
  read_at}]}` (latest 50, already rendered in the applicant's language);
  `POST /notifications/{id}/read` -> `{id, read}`.

### 1.5 Demo accounts (emails only; from backend/docs/DEMO.md)

- Applicants: `<name>.demo@example.org`, e.g.
  `a01.kusum.beck.demo@example.org` (NFST, sanctioned),
  `a36.darsan.tigga` / `a58.kamla.tigga` (open deficiency),
  `a37.rosalin.kispotta` (resubmitted), `a27.leela.dang` (NOT_SELECTED
  after override), `a23.niranjan.dang` (gate refused).
- Officers: `ministry.demo@example.org`, `sno.jharkhand.demo@example.org`,
  `dno.{gumla,khunti,lohardaga}.demo@example.org`,
  `ino.<institution code>.demo@example.org`,
  `committee.jharkhand.demo@example.org`,
  `auditor.jharkhand.demo@example.org`; SUPER_ADMIN `admin.p11@example.org`.
- Passwords are only in `../.demo-seed/demo.env`, which this work never
  opens. So no demo password is available to the agent.

### Other observations

- CORS allows both `http://localhost:5173` and `http://127.0.0.1:5173`
  (preflight checked).
- Access token lifetime is 15 minutes, so the 401 -> refresh -> retry path
  matters in normal use.

## Step 2: foundation

### 2.2 Fonts and offline

- Google Fonts `@import url(...)` replaced by `@fontsource` imports
  (DM Sans 400-700, Molengo 400, Newsreader 600 italic, Nunito 400/700),
  bundled into `dist/assets` by Vite.
- The Unsplash hero photo is replaced by a local CSS gradient in the same
  navy/blue range; the existing `.vidya-overlay` stays on top.
  `src/imports/*.png` are design screenshots (962x682), not a usable hero
  image, so they were not used.
- Removed Figma Make runtime bits: `.figma/` (site.json with the analytics
  hook, deploy/preview scripts that upload to Figma, langserver via
  `pnpm dlx`), and the four Figma plugins in `vite.config.ts`
  (site configuration / gtag injection, kit story page, error-overlay
  replay, refresh-boundary fallback). `index.html` now has a static title,
  `lang` and `noindex`.
- `rg -n -o "https?://..." src dist` after the change lists only XML/SVG
  namespace URLs plus three inert strings: `https://react.dev/errors/`
  (text inside React's production error messages; nothing is fetched),
  the Tailwind licence banner `https://tailwindcss.com` (a CSS comment),
  and the `https://…` placeholder of the TypographyEditor (removed in 2.7).
- Fonts cover Latin only; Devanagari text (Hindi UI, the emblem letter)
  uses the operating system's fonts. No remote font is loaded for Hindi.

## Step 3

### 3.1 Auth and consent

- Checked in the browser (dev server, synthetic account created through the
  register form with a password generated in the page and never displayed):
  register -> automatic login -> `/consent`; the three purposes and notice
  texts come from the API; "I agree" on all three, then withdraw
  `notifications`; the history lists 4 records. Switching to Hindi sent
  `PATCH /applicants/me` and the backend then served the Hindi notice texts.
  A page reload stayed on `/consent`; storage held only `lang`
  (localStorage) and `vidyasetu.refresh` (sessionStorage); no token in the URL.
- The A-/A/A+ text-size labels of the design were inert and are not
  rendered; "Help" had no content behind it and is not rendered either.

### 3.2 Landing eligibility

- The scheme list is the set of versions evaluated by the public
  `POST /schemes/check-eligibility` for an empty profile (no public list
  route, R2). Category and course-level options are the union of the
  `category` / `education_level` options in the form schemas; income limits
  come from `fields[].limits` of `family_income_annual`.
- The API currently returns two synthetic test schemes
  ("Forest Science Fellowship (P16 synthetic)", "Workload / verification
  oracle (P16 synthetic)") as active. They are shown as the API returns
  them; hiding them would need a backend flag.
- Checked in the browser: category ST, income 268000 -> "Eligible for 2
  scheme(s)"; POST_MATRIC and PRE_MATRIC "Not eligible" with the text
  "income ₹2,68,000 is above this scheme's limit of ₹2,50,000" (limit from
  the API).
- The "Scheduled Caste (SC)" and "Other" category options were removed:
  no scheme in the API accepts them.

### 3.3 Application and upload

- Wizard order now matches the API: 1 profile (recorded, read only),
  2 scheme form (fields from form-schema; draft via
  `POST/PATCH /application-drafts`), 3 review and submit, 4 document
  uploads (`POST /applications/{id}/documents`, only possible after the
  application exists).
- Submit uses `POST /application-drafts/{id}/submit` when a draft exists
  (the backend documents it as "the unchanged submit path
  (POST /applications)"), otherwise `POST /applications`. Both answer 409
  `consent_required`, which sends the user to `/consent` and back.
- Recorded profile keys (category, income, age, institution, course year,
  hostel, ...) are never sent in `declared` (the backend refuses them);
  only the other form-schema fields are asked for.
- Client checks before upload: 10 MiB, PDF/JPG/PNG. The backend limit is
  `UPLOAD_MAX_BYTES` (default 10 MiB).
- Checked in the browser with the synthetic account: POST_MATRIC form,
  draft saved, submitted (gate passed, application in INO_VERIFIED),
  13 checklist slots listed, a generated PNG uploaded to
  `income_certificate` -> 202 PROCESSING -> polled -> "Officer will
  review" (NEEDS_REVIEW). A .txt file and an 11 MB file were refused in
  the browser. `QUALITY_REJECTED` (retake) was not reproduced: the backend
  runs `ML_MODE=mock`, whose quality verdict does not depend on the image;
  the portal says so on the upload step (from `mock_notice`).
- Checklists name most documents twice (descriptive label and canonical
  key, e.g. "Family Income Certificate" and `income_certificate`); the
  portal shows every slot the API returns (backend DEMO.md notes the same).
- The design's helpdesk number "1800-11-2026" was invented; replaced by
  "ask the nodal officer of your institution".

### 3.4 Dashboard

- Status, stage, application number and dates come from
  `GET /applications` (newest first; `?app=<id>` selects another one).
  The timeline shows the workflow's review path with the real stage codes
  (SUBMITTED, INO_VERIFIED, DNO_VERIFIED, SNO_VERIFIED, MINISTRY_APPROVED)
  labelled by officer level; the current stage shows `stage_entered_at`
  and `stage_due_at`. Past stages show "Completed" without a date, because
  no history route exists for applicants (R3).
- The "next expected update" card shows `stage_due_at`, labelled as coming
  from the backend's placeholder SLA durations (backend DEMO.md: "SLA
  durations are placeholders"). The design's invented "Typical review time
  is 7-10 working days" and "SMS and email notifications enabled" texts are
  gone; the cards show document counts and unread notifications from the API.
- Notifications: `GET /notifications`, `POST /notifications/{id}/read`;
  checked in the browser (the gate notification was marked read).

### 3.5 Deficiencies

- Items (problem, fix, deadline, status, source) come from
  `GET /applications/{id}/deficiencies`; problem/fix message keys are
  mapped to the backend's own en/hi texts (mirrored in src/i18n). The crop
  (`.../items/{itemId}/crop`, PNG with bearer token, shown via an object
  URL) is requested only when `crop_ref` is set, which the backend never
  sets today (no bounding boxes from OCR).
- Replacement upload is offered per item for the item's `document_slot`
  (an item without a slot, e.g. a name mismatch, lets the applicant pick
  the document). An "another document" upload stays available so the
  backend's 409 `slot_not_in_open_deficiency` (with `allowed_slots`) is
  shown when a document that no open item names is sent.
- Resubmit: `POST /applications/{id}/deficiencies/{deficiencyId}/resubmit`
  for an itemised deficiency; for a DEFECTIVE application without items
  (refused by the automatic gate, which creates no deficiency rows) the
  screen explains that and uses `POST /applications/{id}/resubmit`.
- **Not exercised live:** an itemised deficiency needs an officer
  (`POST /applications/{id}/deficiencies` or MARK_DEFECTIVE), and the demo
  applicants with open deficiencies (A36, A58) need the demo password,
  which is not available. The screen was checked only in the "nothing to
  correct" state (two applications, picker shown). A second synthetic
  application (TOP_CLASS, course year 5 of 3) was created while trying to
  reach DEFECTIVE through the gate; the tenure rule is operational, so the
  gate passed it.

### 3.6 Result

- `GET /applications/{id}/selection-result`: outcome (current, computed,
  committee, final), computed rank, reason, reservation category, list
  status and window. 404 `no_published_result` shows "no result yet"
  (checked in the browser with the synthetic account).
- The backend's score is **one merit value** read from the scheme's merit
  rule (`breakdown = {rule_id, evaluation_run_id, read_from, direction}`);
  there are no score components. The design's four weighted bars, "of
  1,284 eligible applicants", "72 provisional positions", the tie-break
  paragraph, the "Verified" tag and "Download result" (no route) were
  invented and are not shown. The screen shows score type, value, rule
  and ranking direction.
- Objection (`POST /grievances`, SELECTION_OBJECTION) is offered only when
  the list is PROVISIONAL_PUBLISHED, its window is open and the current
  outcome is NOT_SELECTED (the backend's own rule). The run reference is
  pre-filled from the non-selection notification when found (R4).
- **Not exercised live:** no published result exists for the synthetic
  account, and demo applicants with results (A01, A27) need the demo
  password. Demo lists are FINAL_PUBLISHED, so an objection could not be
  raised on them anyway.
- DigiLocker "Verify" and "Post-award" are not routed or in the module
  bar; their design code is kept in `src/screens/hidden/`.

## Step 4: proofs

- `node scripts/click-path.mjs --register-if-missing` against the running
  backend: 29 steps passed, 1 skipped (officer role gate, no officer
  credentials). It registered the synthetic applicant from `.env.local`
  (first run only). Output is reproduced in the final report.
- New from the click-path: `GET /applicants/me` lists
  `supported_languages = en/hi/sat` (Santali). The portal offers en/hi
  only. The resubmit of a non-DEFECTIVE application answers 409 with
  `details.reason = transition_not_allowed` (now mapped).
- Browser check (the in-app browser of the agent's desktop app, offline,
  against the dev server): each route loaded in English and Hindi
  (18 loads) with a page-level hook on `console.error`, `console.warn`,
  `window.onerror` and `unhandledrejection`: **0 errors, 0 warnings**.
  The network log shows the expected 404s of `selection-result` (no
  published result). Earlier console entries "useI18n outside
  I18nProvider" were Vite hot-reload artefacts during editing (their
  module URLs carry `?t=` HMR timestamps); a fresh load does not show them.
- Role gating (4.3): **not proven live.** No officer password is available
  (demo passwords are in `.demo-seed`, which this work does not open), so
  the refusal path (`NotApplicantError`: logout + message) is covered by
  code review only. `scripts/click-path.mjs` checks it when
  `E2E_OFFICER_EMAIL` / `E2E_OFFICER_PASSWORD` are put in `.env.local`.
- Hindi audit (4.4): in Hindi mode no raw message key is visible on any
  wired screen, and `rg` finds no hard-coded English JSX text. Remaining
  English on screen is API data: scheme names, education-level options,
  document checklist labels, scheme codes, and notifications rendered when
  the profile language was English (R5).
- Console hygiene (4.5): `rg -n "console\." src` finds nothing.
- Test data created in the local backend by this work (synthetic):
  two applicants (`ui.flow.*@example.org` via the register form,
  `e2e.student.*@example.org` via the click-path), three applications,
  consent records, one draft, uploaded synthetic PNGs.
- Offline check (4.1) on the final build: `rg -n -o "https?://..." src dist`
  lists `http://localhost:3000/api/v1` (API default), `http://localhost`
  (react-router's URL base), XML/SVG/MathML namespaces, and inert text
  inside library messages: `https://react.dev/errors/` (React error text),
  `https://reactrouter.com/en/main/routers/picking-a-router.` and
  `https://github.com/ungap/url-search-params.` (react-router warning text),
  and the Tailwind licence comment `https://tailwindcss.com`. None of them
  is fetched; there is no CDN, font, image or analytics URL.

## Live verification pass (demo accounts)

Accounts come from `.env.local`; the passwords were typed in by the owner
and never read or printed by the agent. There are three accounts:
deficiency (E2E_*), not-selected (E2E_RESULT_*) and sanctioned
(E2E_SANCTIONED_*). The shapes are in `docs/live-shapes/*.txt`, made by
`node scripts/shape-check.mjs` (read only; field names and JSON types,
values only for status/stage/outcome keys).

### L1. Shape check vs src/api/responses.ts

Every field that `responses.ts` declares and a screen reads exists in the
live responses with a compatible type. Mismatches found:

| # | Response | Declared | Live | Effect |
|---|---|---|---|---|
| M1 | `GET /applications/{id}/documents` -> `documents[]` | `DocumentView.ml_mode: string` (required) | absent on list items (only on `GET /documents/{id}`) | type is wrong, nothing reads it; split into list item / detail types |
| M2 | `GET /applications/{id}/selection-result` -> `score.score_value` | `string \| number` | `number` | compatible; narrowed to `number` |
| M3 | same -> `computed_rank` | `number \| null` | `null` for the not-selected account although `computed_outcome = SELECTED` (committee EXCLUDE) | screen must show "no rank", not "#null" (it shows "–") |
| M4 | same -> `score` | `... \| null` | `null` for the not-selected (TOP_CLASS) account; `{score_type, score_value, breakdown{direction, evaluation_run_id, read_from, rule_id}}` for the sanctioned (NFST) account | as declared; the screen handles both |
| M5 | `GET .../deficiencies/items/{itemId}/crop` | PNG | `404 NOT_FOUND` when `crop_ref` is null (both live items have `crop_ref: null`) | the screen asks for a crop only when `crop_ref` is set, so there is no request; no crop image can be shown live (backend: no bounding boxes) |
| M6 | `GET /applications/{id}/deficiencies` -> `items[].document_slot` | `string \| null` | `string` on both live items | compatible |
| M7 | `GET /applicants/me/consents` -> `history[].method` | not declared | `string` | unused; ignored |
| M8 | `POST /schemes/check-eligibility` -> `evaluation_run_id` | not declared | `null` | unused; ignored |

Live values seen: deficiency account `current_stage = DEFECTIVE`, one
itemised deficiency `OPEN` with 2 items `OPEN`, `selection-result` 404;
not-selected account `MINISTRY_APPROVED` / `APPROVED`, list
`FINAL_PUBLISHED`, `computed_outcome SELECTED`, `final_outcome` and
`current_outcome NOT_SELECTED`; sanctioned account `MINISTRY_APPROVED`,
`FINAL_PUBLISHED`, `SELECTED`, numeric merit score. Document review status
`NEEDS_REVIEW`, verification `PENDING` (ML_MODE=mock).

### L2. Fixes

- M1: `DocumentView` (list item) no longer declares `ml_mode`;
  `GET /documents/{id}` returns `DocumentDetail` (item + `ml_mode`).
- M2: `score_value` typed `number`.
- Defensive typing: `selection-result.list` and deficiency
  `problem_code` are now nullable in the types, so the compiler forces a
  guard at each use (Result screen, Deficiencies screen).
- States: every wired screen has a loading, an empty and an error state
  (error: text + "Reference for support: <requestId>"). Added the missing
  empty states (landing scheme table, consent purposes, upload checklist).
- A render error boundary around each screen shows a message and a retry
  button instead of a blank page; it resets on navigation and logs nothing.

## F1-B: new backend routes

### B2. Public scheme list

- `GET /schemes` (no token) -> HTTP 200, 5 schemes: NFST v5, NOS v2,
  POST_MATRIC v2, PRE_MATRIC v4, TOP_CLASS v3 (all `effective_to: null`).
  The landing list and the application scheme picker now use it, loaded once
  per page load (module cache; form schemas are cached with it). The
  empty-profile check-eligibility workaround is removed.
- The two synthetic test schemes (FOREST_SCIENCE_P16, WQ_ORACLE_P16) are
  **not** in `GET /schemes`, but `POST /schemes/check-eligibility` still
  evaluates them (7 schemes; both "eligible" for category ST). The portal
  hides nothing: after a check, a scheme evaluated but not listed gets its
  own row, marked "Evaluated by the check, not in the published scheme
  list", so the "Eligible for N scheme(s)" heading matches the rows.
  Backend request R9.

### B3. Stage history timeline

- `GET /applications/{id}/history` -> HTTP 200 for all three demo
  accounts (read-only shape check). Live sequences: deficiency account
  `SUBMITTED -eligibility_passed-> INO_VERIFIED -mark_defective->
  DEFECTIVE`; not-selected and sanctioned accounts `eligibility_passed`,
  then three `verify` steps up to `MINISTRY_APPROVED`.
- trigger_action values, read from the backend workflow definition
  (`api/src/workflow/vidyasetu-workflow.ts`, transition table `T`; every
  `workflow_transitions` row is written with `decision.transition`):
  `eligibility_passed`, `eligibility_indeterminate`, `eligibility_failed`,
  `verify`, `reject`, `mark_defective`, `resubmit`, `disburse`. All eight have
  `history.action.*` keys in en and hi; unknown values fall back to a
  humanised raw value ("some_action" -> "Some action").
- The submission itself is not a history row (the first row is the gate
  leaving SUBMITTED), so the "Submitted" step uses `submitted_at`.
- The timeline now follows the real sequence (including a DEFECTIVE
  detour and resubmission loops) with the action and date on every past
  step, then the review stages still ahead. When the sequence is not five
  steps long, the grid's column count is set inline on the existing
  `.timeline` element; classes and styling are unchanged. If the history
  request fails, the error (with requestId) is shown and the previous
  stage-order timeline is used.
- Dates: `toLocaleString` with `en-IN` / `hi-IN` (Intl).
- The OpenAPI declares `from_stage` as `type: object` (it is a string or
  null) and `window_closes_at` likewise: BACKEND_REQUESTS R8.

### B4. Objection run id

- `selection-result.list.selection_run_id` is present (string) for both
  accounts with a published result. The objection form now takes it from
  there (shown read-only as "Selection run reference") and sends it to
  `POST /grievances` (SELECTION_OBJECTION). The notification-text pre-fill
  runs only when the field is null, and the field then stays editable.
- Both published demo lists are FINAL_PUBLISHED, so the objection panel is
  closed for them; raising an objection live is not possible with the demo
  data.

### B5. Rate limit message

- Any HTTP 429 (or code `TOO_MANY_REQUESTS`) now shows "Too many requests
  right now. Please wait a moment and try again." (Hindi: "अभी बहुत अधिक
  अनुरोध हैं। कृपया थोड़ी देर रुककर फिर से प्रयास करें।"), with the request id
  under it as for every error. This is checked before message keys and
  reasons, so it applies even when a 429 has no JSON body.
- A live 429 body was not captured: the backend stopped responding
  (`curl http://localhost:3000/health/live` -> connection refused) during
  this step. The backend README states that 429 uses code
  `TOO_MANY_REQUESTS`.

### F1-B proofs (2026-09-30)

- `node scripts/click-path.mjs --read-only` (deficiency demo account): 9/9
  passed, output in `docs/proofs/click-path-read-only.txt`. `GET /schemes`
  without a token 200 with 5 schemes; history of own application 200 with 2
  dated entries; history without a token 401 (`missing_token`).
- Browser, signed in by the owner as a58 (DEFECTIVE): the timeline is built
  from the history (no history error). Every past stage has a date:
  Submitted 16 Sept 2026 11:10 am; Institute nodal officer "Rule check
  passed · 16 Sept 2026, 11:10 am"; current "Returned for corrections ·
  29 Sept 2026, 5:53 pm · Since 29 Sept 2026 · target 14 Oct 2026"; then
  District, State, Ministry ahead. **Result: MATCHES.** Minor: the current
  step repeats "Returned for corrections" (stage name and action label).
- Browser, signed in by the owner as a27 (Hindi profile, not switched to
  avoid writing preferred_language): result screen shows TOP_CLASS
  2025-26, final list, "not selected", rank "–" (computed_rank null), no
  merit score, "computed Selected, committee excluded, final Not selected";
  objection panel "not open" (FINAL_PUBLISHED), no input. **MATCHES**, with:
  - **MISMATCH:** vertical category shows the raw code `ST_OTHERS` (no
    translation key for it).
  - Design: the merit hero keeps its green success gradient for a
    not-selected result (original CSS; for the UI v2 pass).
- **BROKEN (narrow screens):** below 650 px the design CSS
  (`.topbar > .btn { display: none }`) hides the top-bar button, which is
  now "Log out", so a signed-in user on a phone-width screen has no visible
  way to log out. Found in the ~507 px preview pane.
- 429 capture (run once, with the owner's go-ahead): 65 unauthenticated
  `GET /schemes` calls in 0.4 s -> 60 x HTTP 200, 5 x HTTP 429; the 429
  body has `code: TOO_MANY_REQUESTS`, `details.reason: null`. The portal
  maps it by status/code to the "please wait a moment" message. After
  62 s, `GET /schemes` -> HTTP 200 again.

## F1-C polish

### Result banner colour and contrast

- Colour by outcome: SELECTED on a FINAL_PUBLISHED list = existing green
  (#0d513d -> #087a57); NOT_SELECTED = navy `--navy` #0b192c (the header
  nav colour), no red and no celebratory wording; provisional / held /
  window closed = blue (#135a91 -> `--blue` #1769aa). Layout unchanged;
  only background and text colours differ.
- The existing green banner's muted text failed WCAG 4.5:1 at the light
  end of its gradient (#087a57): #a9d9c9 3.42, #bfdfd4 3.74, #c7e5dc 3.99,
  #b7dbcf 3.57. Muted text is now #eaf6f1 on green.
- Ratios after the change (WCAG 2.x, computed):

| Banner | Background | White headings | Muted text |
|---|---|---|---|
| Selected (green) | #0d513d / #087a57 | 9.29 / 5.34 | #eaf6f1: 8.38 / 4.82 |
| Not selected (navy) | #0b192c | 17.65 | #c3cfdb: 11.15 |
| Provisional (blue) | #135a91 / #1769aa | 7.24 / 5.77 | #e6f0f8: 6.27 / 5.00 |
| Outcome tag (white chip) | #ffffff | green text #07583e 8.49; navy #0b192c 17.65; blue #135a91 7.24 | |

### F1-C browser checks (owner signed in; profile language not changed)

- a58 (English): timeline current step "Returned for corrections" shown
  once, with "29 Sept 2026, 5:53 pm · Since 29 Sept 2026 · target 14 Oct
  2026"; other steps keep differing action labels ("Rule check passed").
  Header: 375px shows the 44x44 icon "Log out" (the labelled button is
  hidden); 650px shows the labelled "Log out Kamla" button (150x42), icon
  hidden; 1280px unchanged desktop header. Clicking the icon at 375px
  logged out and opened /login.
- a27 (Hindi): result banner navy with white text and a navy-on-white
  "चयनित नहीं" tag, no red, no congratulations text; vertical category
  "अनुसूचित जनजाति (PVTG के अलावा)" (was `ST_OTHERS`); horizontal "कोई नहीं";
  objection panel "खुली नहीं". At 375px the icon has the accessible name
  "लॉग आउट".
- Tooling note: at 375px emulation the browser automation's element-ref
  click landed beside the icon twice for a27 (the Hindi top strip wraps to
  two lines and shifts the header); a coordinate click on the icon works.
  Not an app defect: the same icon logged a58 out.
- Still open (outside F1-C): below 650px the design hides the inner-page
  language switch and the signed-out "Log in" button.
