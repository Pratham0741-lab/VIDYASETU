# VIDYASETU student portal (prototype)

The applicant-facing portal: React 19, Vite 8, Tailwind CSS v4 and
react-router-dom, wired to the VIDYASETU backend API. It began as a static
Figma Make design; the markup and CSS are kept, the data and logic are real.

## Run

```bash
cp .env.example .env              # first time only
pnpm install --frozen-lockfile
pnpm dev                          # http://127.0.0.1:5173
```

- Port **5173** (`strictPort`); `PORT` overrides it. Dev and preview bind
  to `127.0.0.1` by default (`FIGMA_DEV_SERVER_HOST` overrides it).
- The backend must be running (Docker, see `backend/README.md`) and must
  list the portal's origin in `CORS_ORIGINS` (both `http://localhost:5173`
  and `http://127.0.0.1:5173` are allowed by the local backend today).
- Before every commit: `pnpm typecheck` and `pnpm build`.
- `pnpm gen:api` regenerates `src/api/schema.ts` from `openapi/openapi.json`
  (refresh that file from `http://localhost:3000/docs/openapi.json`).

## Environment

| Variable | File | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `.env` | API base, default `http://localhost:3000/api/v1` |
| `E2E_EMAIL`, `E2E_PASSWORD` | `.env.local` | Synthetic applicant for `scripts/click-path.mjs` |
| `E2E_OFFICER_EMAIL`, `E2E_OFFICER_PASSWORD` | `.env.local` (optional) | Officer account for the role-gate proof |

`.env` and `.env.local` are git-ignored (`.env*`); `.env.example` is committed.

## Proof scripts

```bash
node scripts/click-path.mjs --register-if-missing
```

Drives the API calls the UI makes (login, consent, scheme list, eligibility, draft,
submit incl. the 409 consent path, upload, poll, deficiencies, resubmit,
selection result, notifications, refresh and logout). Prints statuses,
codes and counts only; never credentials, tokens or bodies.

## Screens

| Route | Screen | State |
|---|---|---|
| `/` | Landing + eligibility checker | **wired**: public `GET /schemes` (list, once per page load), form-schema, check-eligibility |
| `/login`, `/register` | Login, registration | **wired**: auth routes; APPLICANT only |
| `/consent` | Consent notices, give / withdraw | **wired** |
| `/apply` | Profile → scheme form (draft) → submit → document upload | **wired**; scheme picker from `GET /schemes` |
| `/dashboard` | Status, stage timeline, notifications | **wired**; timeline from `GET /applications/{id}/history`, a date on every past stage |
| `/deficiencies` | Items, replacement uploads, resubmit | **wired** (itemised case not exercised live) |
| `/result` | Selection result, merit score, objection | **wired**; objection uses `list.selection_run_id` |
| DigiLocker "Verify" | `src/screens/hidden/Verification.tsx` | **hidden** (Stage F3), not routed |
| "Post-award" | `src/screens/hidden/PostAward.tsx` | **hidden** (Stage F3), not routed; its figures are design samples |

No screen shows sample data as live data. The hidden screens contain the
design's sample figures and are not reachable.

## Session and privacy

- Access token in memory only; refresh token in `sessionStorage`
  (`vidyasetu.refresh`) so a page refresh keeps the session. This is a
  documented prototype trade-off. Tokens never go into a URL or
  `localStorage`; the only `localStorage` key is `lang`.
- A 401 triggers one refresh and exactly one retry; a failed refresh
  signs the user out with a "session ended" notice.
- Any account whose `/auth/me` role is not `APPLICANT` is refused with a
  message and logged out.
- No `console.*` call in `src/`. No analytics, CDN, remote fonts or remote
  images (fonts from `@fontsource`, hero image replaced by a gradient).

## Languages

English and Hindi (`src/i18n/en.ts`, `hi.ts`). Hindi is machine-drafted and
unreviewed; see `docs/TRANSLATION_NOTES.md`. The choice is kept in
`localStorage` (`lang`) and, when signed in, saved as the applicant's
`preferred_language`. The backend also supports `sat` (Santali); this UI
offers English and Hindi only.

## Demo accounts (emails only; from backend/docs/DEMO.md)

| Role | Email |
|---|---|
| Applicant (sanctioned, NFST) | `a01.kusum.beck.demo@example.org` |
| Applicant (open deficiency) | `a36.darsan.tigga.demo@example.org`, `a58.kamla.tigga.demo@example.org` |
| Applicant (resubmitted) | `a37.rosalin.kispotta.demo@example.org` |
| Applicant (not selected after committee override) | `a27.leela.dang.demo@example.org` |
| Ministry officer | `ministry.demo@example.org` |
| State nodal officer | `sno.jharkhand.demo@example.org` |
| District nodal officers | `dno.{gumla,khunti,lohardaga}.demo@example.org` |
| Institute nodal officers | `ino.<institution code, lower case>.demo@example.org` |
| Committee | `committee.jharkhand.demo@example.org` |
| Auditor | `auditor.jharkhand.demo@example.org` |

Passwords live outside this repository and are not used by this work.
Officer accounts are refused by this portal.

## Polish pass F1-C (2026-09-30)

- **Category labels:** seat pool / vertical category and reservation codes
  from the backend (`ST_OTHERS`, `PVTG`, `ST`, `FEMALE`, `PWD`) are shown
  with en/hi labels (`category.*`, `reservation.*`); an unknown code is
  humanised. Used on the result screen, the application summary and the
  landing checker.
- **Timeline:** a step shows its action label only when it differs from the
  stage name ("Returned for corrections" appears once).
- **Result banner:** green = selected on a final list, navy = not selected
  (no red, no celebratory wording), blue = provisional / held. All banner
  text is at least 4.5:1 (ratios in docs/FRONTEND_FINDINGS.md).
- **Narrow screens:** below 650px a 44x44 icon log-out button (accessible
  label "Log out" / "लॉग आउट") replaces the top-bar button the design hides.
  Desktop is unchanged. Checked at 375, 650 and 1280px.
- Checked in the browser with a58 (English profile: timeline, header widths)
  and a27 (Hindi profile: result screen, banner, narrow header). The header
  language switch writes `preferred_language` when signed in, so it was not
  used on the demo accounts; the other language was checked signed out only.


- OpenAPI response schemas exist for 8 routes only. The portal generates
  `Me`, the scheme list, the stage history and the selection result; all other
  responses are hand-kept in `src/api/responses.ts` (R1, partly resolved).
  Two generated fields are mistyped upstream and narrowed locally (R8).
- `POST /schemes/check-eligibility` evaluates two synthetic test schemes
  that `GET /schemes` does not list; they are shown, marked, never hidden
  (R9). Scheme texts are English only (R5); one PRE_MATRIC rule errors (R6);
  error messages are English (R7).
- Throttled routes answer 429; the portal shows "please wait a moment and
  try again" (English and Hindi).
- The published demo selection lists are FINAL_PUBLISHED, so an objection
  cannot be raised live with the demo data.
- The backend runs `ML_MODE=mock`; upload quality results are fixtures,
  and the portal says so on the upload step.
- The design's A-/A/A+ controls and "Help" link were inert and are not
  rendered.
- Below 650px the design also hides the language switch and the log-in
  button on inner pages (only the new log-out icon is added for signed-in
  users); a signed-out visitor on a phone reaches log-in and the language
  switch from the landing page.

See `docs/FRONTEND_FINDINGS.md` for the full record and
`docs/BACKEND_REQUESTS.md` for the backend changes requested.
