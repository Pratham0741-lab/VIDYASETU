# Proof scripts

The harness scripts used to prove each phase against the running stack
(real HTTP and read-only SQL). They were written and run from untracked
working directories next to the repository (`.phase4-proof`, `.p11`, ...)
and are archived here, one folder per working directory (leading dot
dropped), so the proofs are reviewable and repeatable.

**Not in the repository, by design:** the working directories' local state
- `pw.env` (the harness account password), `state.json` (tokens and row
ids), `versions.json` (this database's scheme-version ids), `responses/`
(saved API responses), logs, images and result dumps. To re-run a script,
recreate a working directory with those files (the scripts read `pw.env`
and write `state.json` / `responses/` next to themselves) and run it from
there against a running stack (`docker compose up -d`).

All data the scripts create is synthetic test data, tagged in
`test_fixtures` by `tag-fixtures.sql` (run as the database owner; see its
header).

| Folder | Phase / purpose |
|---|---|
| phase4-proof | workflow state machine |
| phase7-proof | document intelligence pipeline |
| phase8-proof | notifications and domain events |
| phase9-proof | post-selection (sanction, disbursement, renewals, grievances) |
| p10 | integration adapters (DigiLocker, PFMS, NSP) |
| denials-proof | authorization-denials audit trail |
| mlcal, mlreal-proof, mlsec, ml-merge-check | ML calibration, real-image checks, OCR metadata-fallback security fix |
| p11 | fraud and duplicate detection (Phase 11), 11.5 (`a2*`, `b*`), 11.6 (`p116/`), 12 (`p12/`), 13A (`p13/`, `audit/`), 13B-13E (`p13b/` ... `p13e/`), Phase 14 loose ends (`p14/`: scheme authoring, SLA sweep, drafts, renewal years and sanction chain reference, Aadhaar mock, scope, leak search, tagging), Phase 16 (`p16/`: analytics oracle and exports, declared selection basis, officer language, Aadhaar status, Postgres logging, leak search, tagging), Phase 17 (`p17/`: Postgres logging markers, consent / export / correction / erasure, applicants RLS and AUDITOR refusal (incl. through app code in the api container: `d-auditor-app.sh`), retention, document access log, route / DTO inventory, headers / CORS / rate limits, Hindi PDFs and ASCII byte stability (`f4-render.js`, pinned clock), bulk batch id, tagging), Phase 17.2 (`p17_2/`: authorization-denials after the BigInt fix, document file route with SHA-256 match / headers / 404 denials / 415, database scoping as `app_user` with no actor, history / selection run id / objections / `me` / public schemes live, per-file leak attribution) |

## Routine check: leak search (Phase 17)

`scripts/proofs/leak-search.mjs` is the permanent leak search. Run it after
any change that touches logging, notifications, exports or error handling,
and before a demo:

    LEAK_SEARCH_EMAIL=<super-admin> LEAK_SEARCH_PASSWORD=<password>       node scripts/proofs/leak-search.mjs [--extra values.json] [--saved <dir>] [--exclude <file name>] [--since 24h]

It reads every applicant's name, e-mail and phone from the database (plus
optional extra values, e.g. identifiers that are stored encrypted), and
searches them raw, normalised, hex- and base64-encoded in: the logs of every
compose service (Postgres included), every analytics view as JSON / CSV /
XLSX / PDF, notification bodies, Mailpit and any saved-response directory.
Two positive controls must pass. Exit code 1 on any hit or failed control.
Saved responses of sanction orders legitimately name the scholar (the order
is addressed to them): scan response directories that do not hold them, or
read such hits as by-design. `--exclude <file name>` (repeatable) skips a
by-design file by name; each skipped file is printed, so an exclusion is
always visible in the output.

