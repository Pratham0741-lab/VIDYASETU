# Demo click-path: the Scheme Studio closer

About 5 minutes. A ministry officer creates a scheme, edits and validates
it, publishes it, and the new scheme appears on the student portal. All
data is synthetic. Every step changes the local database (no undo: the
scheme stays, retired, after the demo).

Before the demo:
- Backend running (`curl http://localhost:3000/health/live` answers 200).
- Officer portal: `pnpm dev` in `frontend/ADMIN` -> http://127.0.0.1:5174
- Student portal: `pnpm dev` in `frontend/STUDENT` -> http://127.0.0.1:5173
- Pick a fresh code, e.g. `DEMO_TRIBAL_ARTS_1`. Codes are permanent and
  unique; a code used once cannot be reused.
- Optional dry run of the same steps through the API:
  `node scripts/scheme-closer.mjs` (needs `ALLOW_WRITE=1` and
  `E2E_MINISTRY_*` in `.env.local`).

## 1. Log in (officer portal)

1. Open http://127.0.0.1:5174, sign in as `ministry.demo@example.org`
   (the demo password; never shown on screen).
2. The sidebar shows **Scheme Studio** first. Open it: every scheme with
   its versions and status (Draft, Active, Archived).

## 2. Create

3. **New scheme** (in the Schemes card): code `DEMO_TRIBAL_ARTS_1`, name
   "Tribal Arts Scholarship (demo)", department "Ministry of Tribal Affairs
   (demo)", type Central sector, disbursement by the platform. **Create
   scheme**.
4. The "New draft" form opens. **Start from**: `POST_MATRIC v2 · Active`
   (a copy of a real, valid configuration). **Create draft**. Version 1
   opens as a Draft.

## 3. Edit and validate

5. In **Eligibility & requirements**, rule `income_ceiling`: change
   `income_ceiling` from 250000 to 300000. The header shows "Unsaved
   changes".
6. **Mandatory documents**: add "Portfolio of artwork (demo)". **Save
   draft**: "Saved ...".
7. Show the server's validation: open **Advanced: JSON**, delete the
   `"income_ceiling": 300000,` line, **Apply JSON to the form**, **Save
   draft**. The server refuses: "Rule income_ceiling reads
   params.income_ceiling but its params have no income_ceiling", shown
   under that rule with its message key. Switch to हिन्दी to show the same
   message in Hindi, then back.
8. Put the line back (or reload the page to discard), **Save draft**,
   then **Validate on server**: "The server accepts this version" with the
   form fields and checklist it derives.
9. Optional: **Preview with a synthetic applicant**: category ST, income
   280000 -> Eligible; income 320000 -> Not eligible, `income_ceiling` Fail.

## 4. Publish

10. **Publish** (header). The dialog says the version becomes immutable.
    **Publish (cannot be undone)**. The version is Active and the editor is
    read-only ("Published: read only").

## 5. Show it on the student portal

11. Open http://127.0.0.1:5173 (landing page). The eligibility checker now
    evaluates the new scheme: enter category ST and income 280000 -> "Tribal
    Arts Scholarship (demo)" is listed as eligible; with 320000 it shows the
    300000 limit from the new version.
12. Sign in as a demo applicant (or the synthetic applicant) and start an
    application: the new scheme is offered, and its form is the one derived
    from the version (the same fields as the Studio preview) with the
    document checklist including "Portfolio of artwork (demo)".

## 6. Close

13. Back in the Studio: **Compare versions** is available once a second
    version exists (create a new draft from v1 to show it).
14. **Retire** the version after the demo (dialog, then Archived). It
    disappears from the public list; existing applications keep it.

## Known limits

- Schemes and drafts cannot be deleted (BACKEND_REQUESTS R9); use a fresh
  code for every demo.
- Scheme name and department cannot be edited after creation (R10).
- New rules (new expressions) are added in the Advanced JSON panel; the
  form edits the parameters of existing rules.
- The public `GET /schemes` hides test-fixture schemes while
  `check-eligibility` does not (R11).
