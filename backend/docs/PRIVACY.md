# VIDYASETU privacy (Phase 17, DPDP)

- **What this covers:** how VIDYASETU records consent, gives applicants their own data, handles correction and erasure requests, retains data, and logs who looked at documents.
- **Where the proofs are:** the `b-*`, `c-*` and `e-*` scripts in `scripts/proofs/p11/p17/`; their output is in the Phase 17 report.
- **Hindi texts:** the Hindi versions of every notice here are machine-drafted and await review (`docs/TRANSLATION_REVIEW.md`).

## Consent (B2)

- **What is recorded.** Each consent decision is a row in `consent_records`:
  - purpose, notice version, language, GIVEN or WITHDRAWN, method, time;
  - no personal data beyond the applicant id.
- **Insert-only.** app_user may only insert and read, and only the owner can read (RLS). Rows are audited.
- **The latest row per purpose is the current state.** A withdrawal is a new row; nothing is updated.
- **Purposes and notice version** are configuration:
  - `CONSENT_PURPOSES` (default `application_processing`, `government_verification`, `notifications`);
  - `CONSENT_REQUIRED_PURPOSES` (the first two);
  - `CONSENT_NOTICE_VERSION` (`2026-10-v1`).
- **Notice texts** are message keys in English and Hindi (`api/src/privacy/privacy-messages.ts`), served by `GET /applicants/me/consents` in the applicant's language.
- **Submission gate.** `POST /applications` refuses (409 `consent_required`, message key `consent.required`, the missing purposes listed) unless the applicant's current consent for every required purpose is GIVEN for the current notice version.
- **No silent backfill.** Applicants who registered before Phase 17 have no consent rows. They are asked at their next submission; nobody's consent is assumed.
- **Changing the notice version** makes every applicant consent again before their next submission.
- **Withdrawal does not stop what was already submitted.** The gate is at submission. Withdrawing `notifications` is recorded, but delivery does not yet consult it (KNOWN_LIMITATIONS M67).

## The applicant's own data (B3)

`GET /applicants/me/data-export` (APPLICANT only, rate-limited to 5 per minute) returns the caller's own data as JSON:
- profile;
- applications with their documents' processing state;
- deficiencies, selection-list outcomes, grievances, disbursements and sanction order references;
- renewals, notifications, consents, correction and erasure requests;
- Aadhaar authentication outcomes (masked).

**Masking decision.** Identifiers stay masked exactly as on every other screen:
- caste certificate number and bank account show the last characters only;
- Aadhaar shows as `XXXX XXXX 1234`.

There is no unmasking route. An export is a copy that leaves the system, and the applicant already holds the originals of these identifiers. The export says so in its `masking` field.

**Excluded, and stated in the export's `excluded` field:**
- officers' internal remarks on decisions;
- fraud flags and match hashes;
- committee reasons (an objection's reason reaches its owner as the grievance note);
- officer identities;
- raw OCR text;
- the audit and denial logs;
- anything about other people.

These are not the applicant's data, or they are investigation records whose disclosure would defeat the investigation.

**Format.** JSON only; there is no PDF export (KNOWN_LIMITATIONS M68). Officers, SUPER_ADMIN and AUDITOR get 403; there is no route to export someone else's data.

## Corrections (B4)

1. **Filing.** An applicant files a correction request (`POST /applicants/me/correction-requests`) for `first_name`, `last_name`, `dob` or `gender`.
   - The new value is stored **encrypted**.
   - A reason of at least 10 characters is required (API and database CHECK).
   - The request snapshots the applicant's jurisdiction.
2. **The officer queue.** `GET /correction-requests` shows the requests of the officer's jurisdiction (RLS) to the reviewer roles; AUDITOR can read it.
3. **Deciding.** `POST /correction-requests/:id/decide` records APPROVE or REJECT, with a reason of at least 10 characters (API and DB).
   - The decision is insert-only, one per request, and audited; a decided request cannot be reopened (trigger).
4. **Applying an approval.** An approved value goes through the verified path (`ApplicantsService.applyVerifiedCorrection`): the applicant row is updated and an `applicant_profile_changes` row names the officer.
   - Eligibility-relevant data is never changed by the applicant alone.
5. **Notice.** The applicant is notified in their language (`privacy.correction_decided`).

## Erasure (B5): recorded only

`POST /applicants/me/erasure-requests` records the request (status RECORDED, audited). It deletes **nothing**. The applicant is told, in their language:
- that nothing is deleted yet;
- that records needed for legal, audit or scholarship purposes must be kept for the period the law and the scheme require:
  - decided applications, selections, sanction orders, payments, the audit trail;
- that other data is erased under the retention policy.

**Policy:**
- **Kept as long as the law and the scheme require:** everything the retention job protects (below), the audit and denial logs (append-only by design), and the applicant's identity while any of those exist.
- **Erased under retention:** the data classes below.
- **Not built yet:** a person-level erasure of an applicant with nothing decided (e.g. a registration with no submitted application). It needs a DPO decision on the audit trail: the audit log keeps row images, and it is never edited. Open: KNOWN_LIMITATIONS M70.

## Retention (C)

The retention job is **off by default** (`RETENTION_ENABLED=false`). When it is turned on, it runs as a **dry run** unless `RETENTION_DRY_RUN=false`. It runs every `RETENTION_INTERVAL_MS` (default one day), as a BullMQ repeatable job. SUPER_ADMIN can run it once with `POST /admin/retention/run`; that too is a dry run unless `{"dry_run": false}`.

| Data class | Purged when | Period (default) |
|---|---|---|
| notifications | delivered or failed (never PENDING) and older than the period | `RETENTION_NOTIFICATIONS_DAYS` = 365 |
| refresh tokens | expired or revoked longer ago than the period | `RETENTION_REFRESH_TOKENS_DAYS` = 30 |
| application drafts | status DRAFT (abandoned), not touched for the period | `RETENTION_DRAFTS_DAYS` = 180 |

A period of 0 means the class is never purged.

**Kept whatever their age:**
- anything whose application has an **open grievance** (OPEN or IN_PROGRESS);
- anything whose application has an **open deficiency** (OPEN, RESUBMITTED or OVERDUE, old or itemised).

**Never touched, by construction:**
- `audit_logs`, `authorization_denials`, decision records, final selection lists, sanction orders, disbursements;
- applicants, applications, documents, the fraud match index.

The only code that deletes, `retention_apply()`, names the three tables above and nothing else. It runs only as the SYSTEM actor.

**Every run is recorded.** Each run, dry or real, inserts one `retention_runs` row:
- trigger, who started it, dry run or not, the cutoffs, and per class the counts eligible / protected / deleted;
- never an id or a value;
- the row is insert-only and audited.

**Interaction with the audit chain.**
- The audit log is append-only and hash-chained; retention never updates or deletes an audit row.
- Deleting an **application draft** (an audited table) writes a DELETE row to the audit log carrying the draft as it was. The draft's content therefore stays in the audit log, which is not pruned. Retention removes it from the working tables only (KNOWN_LIMITATIONS M71).
- Notifications and refresh tokens are not audited tables. Their deletion leaves no per-row trace, only the counts in the (audited) `retention_runs` row.
- Proof: audit rows up to the pre-run sequence are byte-identical after a real run, and both chains verify.

**Interaction with the fraud match index.**
- `pii_match_index` holds keyed hashes of applicants' identifiers, taken from the applicant profile and from documents.
- Retention deletes neither, so the index is untouched and duplicate detection keeps working.
- Drafts are not indexed.

## Who looked at which document (E)

- **Logged.** Every successful document view, document list, deficiency crop view, sanction order view and sanction order PDF download writes one `document_access_log` row:
  - account and role, access kind, resource and document id, application id, route pattern, request id, jurisdiction;
  - no content, no names.
- **Fails closed.** The row is written in the request's own transaction; if it cannot be written, the view fails.
- **Refused accesses** are authorization denials:
  - 403 (wrong role), as before;
  - 404 on these routes: document not visible to the caller, or nonexistent. This is recorded as `DOCUMENT_NOT_ACCESSIBLE`, though the caller still sees only 404.
- **Who can read the log.** The denial-reader roles, via `GET /document-access`, under the jurisdiction rule. Applicants cannot read it.
- **Insert-only and audited.** It is deliberately writable by an AUDITOR's session, so an AUDITOR's view would be logged too.

## Logs

- **Application logs** carry no personal data:
  - sensitive keys are redacted at any depth;
  - request bodies are logged as field names and sizes;
  - error messages are scrubbed.
- **Postgres** logs no statement text and no row detail (M60 resolved).
- **The permanent leak search** (`scripts/proofs/leak-search.mjs`, a routine check, see `scripts/proofs/README.md`) looks for every applicant's name, e-mail and phone in every log, export and notification.
