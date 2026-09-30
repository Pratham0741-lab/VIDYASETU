# VIDYASETU officer portal (prototype)

The officer-facing portal: scrutiny, fraud review, selection, audit and
analytics. It started as a static Figma Make design and is wired to the
VIDYASETU backend API. It is a prototype, not an official government service.

## Run

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5174 (FIGMA_DEV_SERVER_HOST / PORT override)
pnpm typecheck    # tsc --noEmit
pnpm build        # dist/
pnpm gen:api      # regenerate src/api/schema.ts from openapi/openapi.json
node scripts/click-path.mjs [--write]   # API click-path proof (see below)
```

The backend must be running (default `http://localhost:3000/api/v1`). Its CORS
allows `http://127.0.0.1:5174` and `http://localhost:5174`.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `.env` / `.env.local` | API base URL, default `http://localhost:3000/api/v1` |
| `E2E_EMAIL`, `E2E_PASSWORD` | `.env.local` only | reviewer officer for `scripts/click-path.mjs` |
| `E2E_COMMITTEE_*`, `E2E_AUDITOR_*`, `E2E_APPLICANT_*` | `.env.local` only | optional role checks in the click-path |
| `E2E_MINISTRY_EMAIL`, `E2E_MINISTRY_PASSWORD` | `.env.local` only | ministry officer for `scripts/scheme-closer.mjs` |
| `ALLOW_WRITE=1` | `.env.local` only | required by the scripts that write (`scheme-closer.mjs`, `click-path.mjs --write`) |

`.env.local` is git-ignored (`.env*` rule). The click-path never prints
credentials, tokens or response bodies (status codes and counts only).

## Security and privacy rules in the code

- Access token in memory only; refresh token in `sessionStorage`
  (`vidyasetu.refresh`) only; never in a URL; nothing else is stored except
  the UI language (`localStorage.lang`).
- One refresh + one retry on 401; a failed refresh signs out with "session
  expired".
- APPLICANT accounts are refused after `/auth/me` and logged out.
- No `console.*` calls in `src`. Errors show the mapped text and the
  backend request id, never a response body.
- Offline: fonts from `@fontsource`, no CDN, remote image or analytics. The
  Figma Make runtime (site.json analytics hook, deploy scripts) is removed.

## Modules: wired, hidden, sample data

| Module | Status | Routes used |
|---|---|---|
| Login | wired | `POST /auth/login`, `GET /auth/me`, `GET/PUT /officers/me/preferences`, `POST /auth/logout`, `POST /auth/refresh` |
| Officer Scrutiny | wired | `GET /applications/queue`, `GET /applications/:id`, `GET /applications/:id/documents`, `GET /documents/:id/file` (scan viewer, reviewer roles, fetched only when opened), `GET /applications/:id/history` (stage timeline), `POST /documents/:id/confirm`, `POST /applications/:id/verify`, `reject`, `mark-defective`, `POST /applications/:id/deficiencies` (dry run + issue), `POST /applications/bulk-actions` (dry run + run) |
| Fraud & Anomalies | wired | `GET /applications/queue?fraud=HIGH|ANY`, `GET /applications/:id/fraud-flags`, `POST /applications/:id/fraud-checks`, `POST /fraud-flags/:id/disposition`, `GET /analytics/fraud` |
| Selection & Quotas | wired | `GET /selection-lists`, `GET /selection-lists/:id`, `GET /selection-lists/:id/objections`, approve, override, publish-provisional, objections decide, close window (normal and early), publish-final |
| Audit Inspector | wired | `GET /audit/verify`, `GET /authorization-denials`, `GET /document-access` |
| Analytics | wired | `GET /analytics/funnel`, `/sla`, `/verification-quality`, `/fairness` |
| Scheme Studio | wired (Stage F3-A) | `GET /admin/schemes`, `POST /admin/schemes`, `GET/POST/PATCH /admin/schemes/:code/versions[/:v]`, `POST .../validate`, `POST .../preview`, `POST .../publish`, `POST .../retire`, `GET /admin/schemes/:code/diff` |

No screen shows sample data any more. Counts on the selection summary are
counts of the returned entries; analytics cells are printed exactly as
returned (suppression markers included).

## Role gating

One table: `src/auth/permissions.ts` (mirrors the backend `@Roles`). The
backend stays the authority; a 403 shows "Not permitted for your role".

| Role | Modules | Special actions |
|---|---|---|
| INSTITUTE_NODAL_OFFICER | Scrutiny, Fraud, Selection (read), Analytics | scrutiny + fraud actions |
| DISTRICT_NODAL_OFFICER | Scrutiny, Fraud, Selection (read), Audit (logs), Analytics | scrutiny + fraud actions |
| STATE_NODAL_OFFICER | Scrutiny, Fraud, Selection (read), Audit (logs), Analytics | scrutiny + fraud actions |
| MINISTRY_OFFICER | Scheme Studio, Scrutiny, Fraud, Selection, Audit (logs), Analytics | Studio: create, edit, validate, preview, publish, retire; selection: publish provisional, close window, publish final |
| COMMITTEE | Selection, Analytics (fairness) | approve, override, decide objection, close window early |
| AUDITOR | Scheme Studio (read), Fraud (read), Selection (read), Audit (verify + logs), Analytics | read only |
| SUPER_ADMIN | Scheme Studio, Audit (verify + logs), Analytics | Studio: create, edit, validate, preview, publish, retire |
| APPLICANT | refused at login | none |

## Demo accounts (emails only; backend/docs/DEMO.md)

Passwords are only in `../.demo-seed/demo.env`, which this work never opens.

- Ministry: `ministry.demo@example.org`
- State nodal officer: `sno.jharkhand.demo@example.org`
- District nodal officers: `dno.gumla.demo@example.org`, `dno.khunti.demo@example.org`, `dno.lohardaga.demo@example.org`
- Institute nodal officers: `ino.<code>.demo@example.org` for jh-gum-01..03, jh-khu-01..02, jh-loh-01..03
- Committee: `committee.jharkhand.demo@example.org`
- Auditor: `auditor.jharkhand.demo@example.org`
- SUPER_ADMIN: `admin.p11@example.org`

### Recommended demo logins (checked live 2026-09-30, read-only)

An institute officer's queue covers the whole **district**, not only its
institution, so all institute officers of one district see the same
queue. Live `GET /applications/queue` results (statuses and application
numbers only):

| District | Institute officers | Queue (INO_VERIFIED) | Held (`?fraud=HIGH`) |
|---|---|---|---|
| Gumla | jh-gum-01, jh-gum-02, jh-gum-03 | 5 (3 verifiable in bulk) | 2: VS-2025-26-551C0C5D62, VS-2025-26-BB149BBE81 (DUPLICATE_FILE_HASH, HIGH, OPEN) |
| Khunti | jh-khu-01, jh-khu-02 | 3 (2 verifiable in bulk) | 1: VS-2025-26-EA1D0D6750 (SHARED_BANK_ACCOUNT, HIGH, OPEN) |
| Lohardaga | jh-loh-01, jh-loh-02, jh-loh-03 | 4 (3 verifiable in bulk) | 1: VS-2025-26-D13FC0B18F (SHARED_BANK_ACCOUNT, HIGH, OPEN) |

These are the 4 held applications counted by `/analytics/fraud`. No single
login shows all four in a queue: state and district officers do not act at
the institute stage, and their jurisdiction scan is capped at 100
applications (BACKEND_REQUESTS R8).

- **Fraud screen:** `ino.jh-gum-03.demo@example.org`. Choose source "My
  queue only" and "Held (HIGH)": the two DUPLICATE_FILE_HASH holds (the
  identical-file pair). For a SHARED_BANK_ACCOUNT hold use
  `ino.jh-khu-01.demo@example.org` (VS-2025-26-EA1D0D6750). The metric
  cards show all 4 holds for any of these logins.
- **Scrutiny bulk-action demo:** `ino.jh-loh-01.demo@example.org`
  (Lohardaga; no bulk action done there yet). Tick the 4 queue rows and run
  a VERIFY dry run: 3 would change and VS-2025-26-D13FC0B18F is skipped with
  "Held for fraud review". jh-gum-01 and jh-khu-02 already did one bulk
  action each (the workload view counts them), so avoid them for a fresh
  demo; their districts still have 3 and 2 verifiable applications.
- Counts will change as other agents work on the demo data; rerun the
  check before a demo.

## Languages

English and Hindi (`src/i18n/en.ts`, `hi.ts`). Hindi is machine-drafted and
unreviewed; see `docs/TRANSLATION_NOTES.md`. Backend free text (fraud
summaries, audit vouches-for texts, analytics meta, mock notices) stays in
English as returned.

## Live verification (2026-09-29)

Real logins against the local backend (state nodal officer, committee,
auditor). Details: docs/FRONTEND_FINDINGS.md "Live pass 1-4" and
`docs/live-shapes/`.

| Screen | Verified live | Known gaps |
|---|---|---|
| Login and role gating | yes (SNO, COMMITTEE, AUDITOR, APPLICANT refused) | INO, DNO, MINISTRY, SUPER_ADMIN not logged in live; the role table is checked against the live 403s |
| Officer Scrutiny | yes: queue, case, documents, extracted fields, confidence, routing reason; verify written once | no original scan (R3); routing reasons recomputed (R4); no applicant name (R6) |
| Fraud & Anomalies | partly: cards match (4 held, 4 flags on 4 applications); disposition written once | held table cannot reach the demo holds: `GET /applications` capped at 100 and includes test data (R8); the screen warns |
| Selection & Quotas | yes (read): 3 lists for 2025-26 with 28 entries | committee actions not written live (no DRAFT demo list for 2025-26) |
| Audit Inspector | yes: verify ok on both chains; denials and document-access tables | none found |
| Analytics | yes: funnel 60/28/28/11; SLA, verification quality, fairness | column headings are API field names |
| Scheme Studio (2026-09-30) | yes: list, create, draft (copy), edit and save, server validation with per-field issues, preview, publish, retire, diff (ministry); read only (auditor); hidden (institute officer); applicant refused | see "Scheme Studio" below |

Write actions made during the pass (ALLOW_WRITE=1), confirmed by the API:
- `POST /applications/:id/verify` on VS-2025-26-6D03DF8C98 as the state
  officer: `SNO_VERIFIED`/`UNDER_REVIEW` -> `MINISTRY_APPROVED`/`APPROVED`.
- `POST /fraud-flags/:id/disposition` on one MEDIUM FUZZY_IDENTITY_MATCH
  flag (id prefix 70aa1a3c) of the test application VS-2026-27-3D346E646D:
  `OPEN` -> `NEEDS_MORE_INFO`; the application stays not held.

## Known gaps

- Only SNO, COMMITTEE and AUDITOR were logged in live (see the table above).
- The fraud held table cannot list the demo holds (R8).
- The routing reasons are recomputed in the UI (R4).
- No applicant name in case views (R6).
- The scan viewer, the officer name and the objection list (F2-B) are
  verified through the API only until a signed-in browser check is done.
- Bulk ISSUE_DEFICIENCY is not offered (the per-application deficiency is).
- Export buttons of the design were removed (the export routes need an
  authenticated file download; not built).
- Response types are hand-written from the backend source (R1).

## Scheme Studio (Stage F3-A)

Route `/studio?scheme=<CODE>&v=<version>`. Design kept (studio cards, rule
blocks, document list, quota cards, header version control and publish
button); data and logic come from the API.

- **List:** every scheme with its versions and status (draft, active,
  archived).
- **Create:** a scheme (code, name, department, type, disbursement mode),
  then a draft from a blank config (no rules, documents or benefits) or a
  copy of any version (this scheme: `based_on_version`; another scheme: its
  config is fetched and sent).
- **Editor:** rule expressions read-only, rule parameters editable in their
  own type (the income ceiling is the `income_ceiling` parameter of its
  rule); mandatory documents (add, remove); selection basis, merit rule and
  direction; seats, women % and rounding for the two pools the schema allows
  (ST_OTHERS, PVTG); workflow key from `known_workflows`; "Advanced: JSON"
  with the exact config. Save sends the config; the server validates before
  storing, and each issue is shown next to its rule or section with the
  backend message key rendered in English or Hindi. "Validate on server"
  re-checks the stored draft. Published versions are read only.
- **Preview:** a synthetic applicant form derived from the version itself
  (`form_schema.fields`); the outcome and a result per rule. Nothing stored.
- **Publish / retire:** confirmation dialogs (publish states that the
  version becomes immutable; optional effective date). Publisher roles only.
- **Diff:** any two versions of a scheme.
- **Removed from the design** (not in the schema or invented): rule toggles,
  "v4.2", "Saved 2 min ago", the 60/40 scoring weights and 100 points, the
  PwD 5% quota, the 8,00,000 income limit.
- **Roles:** MINISTRY_OFFICER and SUPER_ADMIN author and publish (backend
  `SCHEME_AUTHOR_ROLES` / `SCHEME_PUBLISHER_ROLES` defaults); AUDITOR reads
  (list, versions, diff); other roles do not see the module (the backend lets
  every officer read, but the Studio is not offered to them).
- **Proof:** `node scripts/scheme-closer.mjs` (needs `ALLOW_WRITE=1` and
  `E2E_MINISTRY_*`): create, invalid config refused with message keys, fix,
  validate, publish, public list + eligibility + form schema, edit of the
  published version refused, retire, gone from the public list. Click-path
  for the demo: `docs/DEMO_CLICKPATH.md`.
- **Test data left behind** (no delete route exists; BACKEND_REQUESTS R9):
  schemes `STUDIO_UI_PUB_0930` (v1 archived, v2 draft) and
  `CLOSER_TEST_<timestamp>` (v1 archived) per closer run. A database restore
  during the session removed `STUDIO_UI_TEST_0930`.

## F2-B: routes wired (2026-09-30)

- **Scan viewer (Scrutiny):** `GET /documents/:id/file` through the API
  client as a Blob and an object URL (revoked when the document changes or
  the viewer closes with the case). Nothing is fetched until "Show the
  original file" is pressed; the file is kept for the current document only.
  Images: `<img>` with zoom 50-300%; PDFs: `<iframe sandbox="">`. Errors
  (403, 404 incl. `no_stored_file`, 415 `document.file.unsupported_type`,
  429 "try again in a moment") show the mapped message and request id.
  Reviewer roles only (INSTITUTE, DISTRICT, STATE, MINISTRY); DigiLocker
  documents have no file and say so. Every view is recorded by the backend
  in the document access log.
- **Stage history (Scrutiny):** `GET /applications/:id/history`, oldest
  first; labels `history.action.<trigger_action>` for all eight workflow
  transition names (eligibility_passed, eligibility_indeterminate,
  eligibility_failed, verify, reject, mark_defective, resubmit, disburse;
  texts mirror the backend catalogue), unknown values humanised; dates with
  `Intl.DateTimeFormat` en-IN / hi-IN.
- **Officer card:** name and institution code from `/auth/me` when present,
  with role and jurisdiction.
- **Objections (Selection):** the list from
  `GET /selection-lists/:id/objections` (application number, status,
  created, decided) for every non-draft list; the committee selects an
  undecided objection to decide it while the provisional list is published.
  The grievance-id field appears only if the route answers 404.
- **Types:** `Me`, `HistoryEntry`/`ApplicationHistory`,
  `ListObjections`/`Objection` are generated (`src/api/schema.ts`).
