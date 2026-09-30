# VIDYASETU - known limitations

The running list of accepted, documented limitations (H = high, M = medium),
in the style of the original H1/H2/M1 review. Each entry says what is wrong,
why it is accepted for now, and what would fix it. Entries are never deleted:
a resolved one is marked resolved.

> The H1-H4 / M1-M5 entries were first recorded in the initial database
> review (before Phase 1). They are reproduced here as recorded; unless marked
> otherwise their status has **not** been re-verified since. They have been
> explicitly out of scope for every later phase.

## From the initial database review

| ID | Limitation | Status |
|---|---|---|
| H1 | The PII extension does not cover every Applicant query: it handles `create`, `update`, `upsert`, `findUnique`, `findFirst` and `findMany` only. Other operations would read or write encrypted columns without encryption / decryption. | Open (out of scope in every phase) |
| H2 | The PII encryption key is not validated at startup; a missing or malformed key surfaces on first use. | Open (out of scope in every phase) |
| H3 | A usable encryption key was hard-coded in the repository. | Recorded; not re-verified |
| H4 | There was no way to run migrate or seed against the compose database. | **Resolved**: the `db-migrate` compose service runs `prisma migrate deploy` + seed |
| M1 | Encrypted fields have misleading TypeScript types (`Bytes` in the schema, strings at runtime through the extension). | Open (out of scope in every phase) |
| M2 | Lint is suppressed for the crypto files (to be removed after H2 and M1). | Open |
| M3 | Prisma 6 deprecation warning: `package.json#prisma` seed config (Prisma 7 uses `prisma.config.ts`). | Open |
| M4 | No `migration_lock.toml` in the migrations folder. | Recorded; not re-verified |
| M5 | Migrations and schema were never checked for drift (`prisma migrate diff`). | Recorded; not re-verified |

## Added by later phases

### H5 - Notification / domain-event delivery is at-most-once (Phase 8)

Domain events are emitted in-process after the request's transaction
commits; there is no transactional outbox. A crash between commit and
delivery loses the event (and so its notifications, and anything else that
listens - including Phase 11's post-transition fraud detection).
**Accepted** as the Phase 8 design. **Mitigation in Phase 11:** the fraud
hold guard re-runs detection itself before every held forward action, so a
lost event cannot let a flagged application advance. **Fix:** a
transactional outbox table written in the same transaction, drained by a
worker with retries.

### H6 - PFMS call and the disbursement-status write are not one transaction (Phases 9-10)

`DisbursementService.initiate` calls `PfmsAdapter.initiateDisbursement`
(an external system) and then writes the disbursement's `PROCESSING` status
and PFMS reference inside the request's database transaction. They are not
atomic: if PFMS accepts the payment and the local write then fails (or the
process dies before commit), money is committed at PFMS with no local record
of the reference; a retry is safe only because `disbursement_id` is the PFMS
idempotency key. Recorded in Phase 10, **deliberately not fixed in Phase 11**
(Phase 9's disbursement logic and Phase 10's adapters are out of its scope).
**Fix:** a two-step state (`SUBMITTING` committed before the call, then the
reference), or an outbox, plus a reconciliation job that looks up PFMS by
idempotency key for any `SUBMITTING` row.

### M6 - Fuzzy identity matching is uncalibrated (Phase 11)

`FUZZY_IDENTITY_MATCH` scores (name + date of birth + district) were set
against hand-constructed cases only: no labelled duplicate / look-alike data
exists (Group C's generator has produced none). It is therefore advisory -
LOW or MEDIUM only (a database CHECK forbids HIGH) - and never holds an
application. **Fix:** calibrate weights and cut-offs on labelled data.

### M7 - Institution-surge detection rests on applicant-declared institution codes (Phase 11)

`applications.institution_code` is supplied by the applicant and not
verified, so a surge can be diluted (codes spread) or fabricated. The
detector also refuses to fire until the platform's history spans the whole
baseline (`INSUFFICIENT_BASELINE`), so it is silent on a new deployment by
design. **Fix:** a verified institution registry.

### M8 - A HIGH fraud flag does not stop Phase 6's selection run (Phase 11)

The hold guard refuses forward workflow actions (`verify`) and disbursement
initiation while a HIGH flag is unreviewed; Phase 6's allocator (out of
scope) still includes a flagged MINISTRY_APPROVED application in a selection
run. Money cannot move (disbursement is held), but a seat can be allocated.
**Fix:** have the selection run exclude, or report, held applications.

**RESOLVED in Phase 11.5 (B2).** `SelectionService.run` now leaves
applications with a HIGH flag in OPEN / NEEDS_MORE_INFO / CONFIRMED out of
the candidate pool (the fraud hold guard's rule, `fraud/holding.ts`) and
reports them in `held[]` / `counts.held` with status `HELD_FRAUD_REVIEW` -
never in `not_selected`, never with a stage or status change, no "not
selected" notice. The run event carries an additive `held` field.
`allocator.ts` and `selection-policies.ts` are unchanged. Proof: a
TOP_CLASS 2028-29 run held H and selected C; two dry runs were identical;
after FALSE_POSITIVE a dry run selected H and C; Phase 6 suites 28/28.
Residual: the pool reads existing flags, it does not re-run detection (so
it depends on Phase 8's event-driven detection - H5); and see M12.

### M9 - Duplicate-application and cross-account identity are detection-only (Phase 11)

Nothing prevents a second account or a second application for the same
scheme and year (no unique constraint, no Aadhaar - see Phase 10); Phase 11
detects shared identifiers and look-alike identities after the fact and
routes them to review. **Fix:** a verified identity key (e.g. an Aadhaar
vault reference) with a uniqueness rule.

### M10 - OCR-extracted income / disability certificate numbers are stored in plaintext (Phase 7; found in Phase 11)

Phase 7 stores `certificate_number` for income and disability certificates in
plaintext in `document_extractions.extracted_data` (only `caste_cert_number`
goes to the encrypted `sensitive_values`), and the audit trigger copies it
into `audit_logs`. Phase 11's redaction search confirmed it appears there and
nowhere in `fraud_flags`, `pii_match_index`, logs or API responses (Phase 11
matches it only through the keyed HMAC). **Not changed in Phase 11** (Phase
7's pipeline is out of scope). **Fix:** move `certificate_number` into
`sensitive_values` in the OCR pipeline.

**RESOLVED for live data in Phase 11.5 (B3); residual in audit history
(ACCEPTED).** `review-routing.ts` adds an extraction-only sensitive key
(`SENSITIVE_EXTRACTION_ONLY_KEYS = {certificate_number}`; Phase 3's
`SENSITIVE_PROFILE_KEYS` is unchanged), so pipeline, DigiLocker and
officer-correction writes store it encrypted in `sensitive_values` with the
marker in `extracted_data`. Exact-match lookup stays the keyed
`pii_match_index` hash. Existing rows were moved by
`api/scripts/backfill-extraction-certificates.ts` (4 extractions, as the
SYSTEM actor; its audit rows record the redacted row). Proof: 0 hits for new
values in 27 tables, logs and responses (raw, normalised, hex, base64); Phase
7 review / confirm-with-correction and Phase 11's MEDIUM OCR flag still work.
**Residual:** the 4 original INSERT rows in `audit_logs` (2026-09-28
05:02 UTC, fixture data) still contain the pre-fix values. `audit_logs` is
append-only (UPDATE / DELETE / TRUNCATE refused by triggers) and
hash-chained, so they are deliberately not rewritten. The Phase 7 review
endpoint returns the decrypted value to the authorised officer (live
response only), as it does for every sensitive field.

## Added by Phase 11.5 (verification and limitation fixes)

### H7 - The audit hash chain forks (Phase 1 audit trigger; found in Phase 11.5)

`process_audit_log_hash_chain()` links each row to the row with the latest
`(created_at, id)`, but `created_at` defaults to `CURRENT_TIMESTAMP` - the
*transaction* start - and `id` is a random UUID. So when one transaction
writes several audit rows, or an older transaction commits after a newer
one, two rows can name the same predecessor. On 2026-09-28: 609 rows, one
chain start, 0 dangling links, unique hashes, but **137 forks** (115 before
Phase 11.5, the first at the very first seed row). Every link still points
at a real predecessor and rows cannot be altered (triggers refuse UPDATE /
DELETE / TRUNCATE), but a verifier that expects one linear chain fails.
**Open** - the audit trigger is off-limits in every phase so far. **Fix:** order
by a monotonic sequence column (or `clock_timestamp()`) instead of
`(created_at, id)`, and ship a chain verifier that walks links.

**RESOLVED in Phase 13A (commit d7903fe) for every row written from
2026-09-28 10:04 UTC; the 857 earlier rows are legacy (M29).** The Phase 13A
audit also found that no stored row could be recomputed at all (0 of 857:
the trigger hashed `row_to_json` text but stored `jsonb`) and that the
metadata columns were outside the hash. Migration
`20260928080000_audit_chain_v2`: one writer (`audit_chain_append`) takes a
row lock on `audit_chain_head`, assigns a gap-free `seq` and the single
predecessor, and stores `hash_input` = canonical JSON of the whole row
(`record_hash = sha256(hash_input)`); `api/src/audit/canonical.ts` is the
rule definition. Verifier: `GET /api/v1/audit/verify` (SUPER_ADMIN) and
`api/scripts/verify-audit-chain.ts` (exit 0 / 1 / 2). Proof: the live chain
verifies (legacy digest recomputed in TypeScript equals the checkpoint
written by SQL); 26 concurrent API requests (182 audit rows) and 200
concurrent writes on a scratch restore left 0 forks and 0 gaps; on scratch
restores an edited row, a deleted row, two swapped rows, a relinked row and
an edited legacy row each failed verification naming the record (or the
legacy set); the live log's md5 and head were identical before and after;
UPDATE / DELETE / TRUNCATE remain refused for the owner and app_user.

### M11 - Bank-account matching is separator-sensitive (Phase 11; found in Phase 11.5 A2)

`normalizeIdentifier('bank_account', ...)` keeps `:`, so
`SBIN0004455:88002002` and `sbin0004455 - 88002002` normalise differently and
the shared account is missed (seen live in A2: that disbursement reached mock
PROCESSING). Case and spaces around `:` are handled. **Open (FIX LATER)** -
not in Phase 11.5's fix list. **Fix:** normalise to IFSC + account digits
(split on the IFSC pattern, not the separator), bump `MATCH_KEY_VERSION`,
then rebuild (see "FRAUD_MATCH_KEY rotation").

**RESOLVED in Phase 11.6 (commit 910d0a9).** `normalizeIdentifier`
(`api/src/fraud/fraud-match.ts`, the only normaliser; every path - declared,
OCR, DigiLocker, backfill - hashes through it) now applies NFKC, maps decimal
digits of any script to ASCII, upper-cases and removes everything that is not
a letter or digit, for all three fields. `matchableValue` refuses values
below a per-field minimum length (bank 9, certificates 6), with fewer than
4 digits, or that are an IFSC alone. Leading zeros are kept. The same
`FRAUD_MATCH_KEY` is used and `MATCH_KEY_VERSION` stays 1 (it records the key
generation, which did not change). Also fixed: non-ASCII digits used to be
*deleted*, so two different accounts typed in fullwidth digits both
normalised to `SBIN0004455:` and would have matched each other (a false HIGH
hold). Proof: 39 new unit tests (every format, negatives, weak values); the
rebuild (`POST /api/v1/fraud/backfill`, 58 applications) kept index rows at
58/58/6 and all 27 earlier flags byte-identical (4 dispositions kept, 0
duplicate dedup keys), and added exactly the missed A2U / A2Z pair; live, the
same account typed `SBIN0004455:66007007`, `SBIN000445566007007` and
`sbin0004455-` + fullwidth digits gave HIGH flags and 409
FRAUD_REVIEW_PENDING on verify for all three (the same for a declared caste
certificate in three formats); OCR-read numbers still give MEDIUM; the leak
search found 0 raw / hex / base64 values in 27 tables, logs and 69 saved
responses. A2U's instalment had already gone to mock PFMS in Phase 11.5; the
new flag routes it to review, nothing is reversed.

### M12 - A hold released after the year's committed selection run has no way back in (Phase 6; found in Phase 11.5 B2)

B2 re-includes a released application in the *next* run, but Phase 6 allows
one live run per scheme and academic year (`409 selection_exists`). A hold
released after that run leaves the application MINISTRY_APPROVED with no
selection path. **Open (FIX LATER)** - changing the run rule is outside B2's
candidate-pool scope. **Fix:** a supplementary selection run for released
holds (seat availability permitting), or run selection only when no HIGH
hold is pending.

### M13 - The surge flag kept the count from its first detection (Phase 11)

The INSTITUTION_SURGE flag was raised at the 5th arrival and never updated
(it said 5 when 12 had arrived). **RESOLVED in Phase 11.5 (B1):** re-evaluation
refreshes `summary`, `evidence` and `related_application_ids` through the
SYSTEM-only `fraud_refresh_surge_flag()` (SECURITY DEFINER; it cannot write
`status` or any reviewer column; still one flag per institution per week).
Proof: 5 -> 13 -> 14 -> 15 on one flag; after the officer's NEEDS_MORE_INFO,
16 -> 17 with status, reviewer, notes and `reviewed_at` unchanged; every
step in `audit_logs`.

### M14 - No seed history, so the surge detector is silent in a fresh demo (Phase 11; found in Phase 11.5 A3)

The seed creates schemes and versions only; every application comes from a
harness, all created within hours. Without backdating, the detector returns
INSUFFICIENT_BASELINE (M7). **Open (FIX LATER, Group C generator).**
Requirement for a working demo: applications with `institution_code` whose
`submitted_at` (written directly; the API stamps "now") starts at least 63 days
(`FRAUD_SURGE_WINDOW_DAYS` x (`FRAUD_SURGE_BASELINE_WINDOWS` + 1)) before the
demo, dated relative to generation time; for each demo institution at least
one submission per week across the 8 baseline weeks (threshold = max(5, 3 x
weekly median)). Example: 2-3 per week for ~10 weeks for a normal institution,
plus one with >= 10 in the final 7 days to show a surge.

### M15 - No version control before Phase 11.5 (process)

There was no git repository, so "do-not-touch" claims for Phases 1-11 cannot
be checked with git. **RESOLVED going forward:** Phase 11.5 created a
baseline commit of the end-of-Phase-11 tree (`.env` excluded by
`.gitignore`; `DB/node_modules` and `.old-ml-backup` excluded locally), and its
fixes are committed on top. Earlier phases remain unverifiable by git.

### M16 - POST_MATRIC and NFST cannot produce a disbursement instalment (Phase 9; found in Phase 11.5 A2)

The sanction order computes entitlements from the recorded profile only.
POST_MATRIC's benefits state no numeric amount; NFST's stipends depend on
`applicant.fellowship_tier` / `applicant.hosteller`, which the profile does
not hold. Both schedule 0 instalments (TOP_CLASS does). **Open (FIX LATER,
Phase 9 / scheme data).**

**Phase 11.6 investigation: OPEN - a question for Pratham; no code or data
changed.** Not a Phase 9 bug: `entitlement.ts` deliberately schedules only
lines with a numeric annual amount and an evaluable condition ("Decision B:
nothing is guessed") and reports the rest as UNSCHEDULABLE with a reason.
Not a simple configuration gap either:
- POST_MATRIC v2: the maintenance rates exist, but only as a table by course
  group (I-IV) x hosteller / day scholar; the guideline pays them for at most
  10 months a year (from April or the admission month to the examination
  month); tuition is the actual fee fixed by a state committee, and the state
  decides whether it goes to the student or the institute. The scheme is
  centrally sponsored: the Ministry releases its share to the State in two
  or more instalments and the **State** pays students by DBT. The platform
  records none of course group, hosteller status, admission month or actual
  fee.
- NFST v4: the guideline pays **quarterly** through PFMS in DBT mode on
  quarterly continuation certificates, at Rs.31,000 / month for the first two
  PhD years and Rs.35,000 after (plus a discipline-based contingency and HRA
  at 8 / 16 / 24 %). Rates were revised from 1-1-2023, but that circular in
  `DB/NFST/Circulars/` is a scanned image (text extraction is garbage) and
  the 2020 hike letter has no text layer: **the current rates are not
  determinable from the evidence**. The seeded config also has JRF / SRF
  amounts `null`, keyed on an `applicant.fellowship_tier` the platform does
  not record, and Phase 9 schedules one instalment a year, not quarterly.

Questions that need an answer: (1) POST_MATRIC - should this platform
schedule payments at all, given the State disburses? If yes, will the
application collect course group, hosteller status, admission month and the
actual fee (or should the institute enter them at verification)? (2) NFST -
what are the current monthly rates (the 2023 circular's figures), how does
the tier map (JRF / SRF vs PhD year 1-2 / 3-5), and should Phase 9 schedule
quarterly? Until answered, Phase 12 analytics should report these schemes as
"selected - disbursement not scheduled (state-disbursed / rates not
recorded)", never as zero-amount payments.

**RESOLVED in Phase 12 Part A (commit 914a388), with decisions recorded:**
- **D1 - NFST is scheduled by the platform, quarterly.** JRF Rs 37,000 /
  month for PhD years 1-2 and SRF Rs 42,000 / month for years 3-5 (five-year
  tenure). These are **WORKING VALUES PENDING CONFIRMATION** against the
  Ministry of Tribal Affairs circular revising rates w.e.f. 1-1-2023 (not
  readable in the repository scan). They live only in seed data - NFST v5
  in `api/prisma/scheme_versions_seed_v2.json`, each line
  `rate_status: PENDING_CONFIRMATION`, plus
  `disbursement_schedule: {cadence: QUARTERLY, rates_status:
  PENDING_CONFIRMATION}` - never in code; the schedule response repeats the
  status. The tier comes only from the recorded PhD year
  (`applications.course_year`, surfaced as `applicant.academic_year_number`
  and verified at the INO stage); with no recorded year nothing is
  scheduled, and nothing upgrades JRF to SRF automatically. NFST v4 was
  retired (lifecycle only; its config is untouched).
- **D2 - POST_MATRIC is not scheduled by the platform.** `schemes.
  disbursement_mode` (migration `20260928060000`): POST_MATRIC
  `FORWARDED_TO_STATE`; TOP_CLASS and NFST `SCHEDULED_BY_PLATFORM`.
  Scheduling a FORWARDED_TO_STATE selection returns `HANDLED_BY_STATE_DBT`
  ("Selected; disbursement is handled by the State through DBT") with no
  instalments and no error.
Proof (mock PFMS only): an NFST year-1 application got 4 x Rs 111,000
(37,000 x 3) and a year-3 application 4 x Rs 126,000 (42,000 x 3), three
months apart; initiation returned 409 FRAUD_REVIEW_PENDING (with a denial
row) under an unreviewed HIGH flag and 200 PROCESSING after FALSE_POSITIVE;
the POST_MATRIC selection returned HANDLED_BY_STATE_DBT with 0 rows and no
zero-amount row exists; TOP_CLASS still schedules 1 x Rs 41,000 annually;
validate:rules 16 versions, 0 mismatches. Phase 9's initiation guards are
unchanged. HRA and contingency: see M20.

### FRAUD_MATCH_KEY rotation (Phase 11; documented in Phase 11.5 B4)

`FRAUD_MATCH_KEY` keys the HMACs in `pii_match_index`; a new key makes every
stored hash unmatchable until rebuilt. `.env` is git-ignored and in no
commit; the value appears in no other file, transcript or log (checked
without printing it). Procedure:

1. Generate a new 32-byte key (`openssl rand -base64 32`) and set it in `.env`.
2. `docker compose up -d api` (the api reads it at start-up).
3. As SUPER_ADMIN: `POST /api/v1/fraud/backfill` - re-indexes every
   applicant's declared and extracted identifiers with the new key
   (upsert overwrites `match_hmac`) and re-runs detection; flags dedupe.
4. Until step 3 finishes, matches against not-yet-rebuilt rows are missed;
   do it in a quiet window.

Proven with the same key (Phase 11.5): 58 applications, all 122 index rows
rewritten byte-identical, the same 27 flags, 0 new. Not built: a
`key_version` bump per rotation (the column exists; `MATCH_KEY_VERSION` is a
constant), and cleanup of index rows whose source value was removed.

### Test fixtures (Phase 11.5 B5)

Harness-created rows are listed in the owner-maintained `test_fixtures`
table (`entity_type`, `entity_id`, `label`, `note`; read-only to `app_user`).
Labels: `p11-harness`, `p11-scenario`, `p11-surge-fixture` (18 with
backdated `submitted_at`, noted), `p11.5-fixture`. Exclude them in analytics
with:

```sql
WHERE NOT EXISTS (SELECT 1 FROM test_fixtures f
                  WHERE f.entity_type = 'application' AND f.entity_id = a.id)
```

(same shape for `account`, `applicant`, `officer`, `selection`,
`sanction_order`, `disbursement` and `fraud_flag`). All harness accounts also
use `@example.org`, a reserved domain. The tagging script is
`.p11/tag-fixtures.sql` (idempotent; outside the repository).

## Phase 11.5 audit of every entry (A4)

| Entry | Class | Reason |
|---|---|---|
| H1 | FIX LATER | Phase 1 PII extension; own phase |
| H2 | FIX LATER | Phase 1 key handling; pairs with M1 / M2 |
| H3 | FIX LATER | Needs a verification pass; no git history to check |
| H4 | ACCEPT | Already resolved |
| M1 | FIX LATER | Type change across Phase 1 crypto |
| M2 | FIX LATER | Waits on H2 and M1 |
| M3 | ACCEPT | Until the Prisma 7 upgrade |
| M4 | FIX LATER | Trivial, but not in this phase's list |
| M5 | FIX LATER | Belongs in CI (`prisma migrate diff`) |
| H5 | FIX LATER | Needs a transactional outbox |
| H6 | FIX LATER | Needs Phase 9 / 10 changes |
| M6 | ACCEPT | No labelled data |
| M7 | FIX LATER | Needs a verified institution registry |
| M8 | FIX NOW | Done (B2) - RESOLVED |
| M9 | ACCEPT | No verified identity key (Aadhaar out of scope) |
| M10 | FIX NOW | Done (B3) - RESOLVED for live data; audit residual ACCEPTED |
| H7, M11, M12, M14, M16 | FIX LATER | Found in Phase 11.5; outside its fix list |
| M13, M15 | - | RESOLVED in Phase 11.5 |

## Added by Phase 11.6 (M11 and M16 patches)

### M17 - Certificate numbers that differ only in separator placement match (Phase 11 rule, confirmed in Phase 11.6)

Certificate numbers are compared with every non-letter / non-digit removed,
so `JHCC/2026/12/345` and `JHCC/2026/123/45` (or `12/3456` and `1234/56`)
produce the same match key. Kept deliberately: the rule has applied since
Phase 11, missing a genuine reuse typed with different separators is the
worse error, and a match only raises a flag for human review (HIGH for
declared numbers holds forward actions until an officer marks it
FALSE_POSITIVE; nothing is rejected). A unit test pins the behaviour.
**ACCEPT** unless an issuing format with variable-width segments is found.
**Fix then:** a per-issuer canonical form (parse the segments) before hashing.

### M18 - Bank-account forms that still do not match (Phase 11.6)

After M11: an account entered without its IFSC does not match the same
account entered with it (`88002002` vs `SBIN0004455:88002002`), and a
look-alike letter from another script (Cyrillic `В` for Latin `B`) is kept
as a different letter - a miss, by design never a false match. The form
accepts any 1-64 character string. **Open (FIX LATER).** **Fix:** validate
the IFSC and account on registration (format and, ideally, the IFSC
directory), or index the account digits separately when the IFSC is valid.

### M19 - A growing match group adds a flag instead of updating one (Phase 11)

Flag dedup keys include the sorted applicant group, so when a third
applicant joins a shared account or certificate, each application gets a
new flag for the larger group next to its existing pair flag (seen in
Phase 11.6: M11A and M11B each hold a pair flag and a triple flag). Nothing
is lost and each flag holds forward actions until reviewed, but reviewers
see overlapping flags. **Open (FIX LATER).** **Fix:** key bank / certificate
flags on (application, field, match hash) and refresh the group in place,
as INSTITUTION_SURGE flags now do.

### Test fixtures - Phase 11.6 additions

`test_fixtures.entity_type` now also accepts `document` (migration
`20260928050000_test_fixtures_documents`). The tagging script is committed
as `scripts/proofs/tag-fixtures.sql` (the copy under `.p11/` is the working
copy) and adds the `p11.6-fixture` label for the M11 proof applicants and
their documents. After Phase 11.6: 0 untagged rows in accounts, officers,
applicants, applications, documents, selections, sanction_orders,
disbursements and fraud_flags; the documented exclusion query leaves 0 of 64
applications.

## Added by Phase 12 (M16 decisions and analytics)

### M20 - NFST HRA and the annual contingency grant are not scheduled (Phase 12, decision D1)

Out of scope by decision: HRA depends on city classification (8 / 16 / 24 %
of the stipend) and on hostel status, and the contingency grant on the
discipline - none recorded, and no amounts are invented. Both stay
UNSCHEDULABLE with a stated reason on every NFST schedule. **ACCEPT** until
the inputs are recorded. **Fix:** record discipline, hostel status and city
class, then price them from the scheme data.

### M21 - Renewal years are not scheduled; JRF -> SRF only through a recorded PhD year (Phase 12; RESOLVED in Phase 14 loose ends)

Phase 9 schedules the sanctioned academic year only. An approved renewal
(`renewals`, institution-endorsed, ministry-decided, with its
`academic_year_number`) schedules nothing, so a scholar moving from year 2
to year 3 gets no SRF instalments from the platform. The tier is taken from
`applications.course_year`, which the applicant enters and the INO verifies;
there is no separate upgrade record. **Open (FIX LATER).** **Fix:** schedule
the renewal year's quarters when a renewal is APPROVED, with the tier from
the renewal's `academic_year_number` (the institution-endorsed value).

**RESOLVED (Phase 14 loose ends, D1, commit 4d4508a).** Approving a renewal
records the year advance on the renewal row (`year_advanced_from` ->
`year_advanced_to`, `year_advanced_at`; audited; a DB CHECK allows exactly
one year forward and only on an APPROVED renewal) and, in the same
transaction, schedules that year from the FROZEN version's benefits with the
recorded year as `applicant.academic_year_number`, at the version's cadence,
linked to the renewal (`disbursements.renewal_id`), the confirmed selection
and its sanction order. Proved: an NFST scholar in year 2 (JRF, 4 x 111000)
renewed to year 3 -> 4 quarterly SRF rows of 126000. Pending, discontinued
and skipped-year renewals schedule nothing. Notes: M53.

### M22 - PRE_MATRIC's disbursement mode was not decided (Phase 12)

Decision D2 covered POST_MATRIC only. PRE_MATRIC (also centrally sponsored,
State-disbursed in the scheme guidelines) and NOS keep today's behaviour,
`SCHEDULED_BY_PLATFORM`. **Open - question for Pratham:** should PRE_MATRIC
be `FORWARDED_TO_STATE` too? (A one-line seed change.)

### M23 - Rejections carry no reason code (Phase 4; found in Phase 12)

A REJECT decision records only free-text `remarks`, which analytics never
reads (it may hold anything). Scheme performance therefore reports
rejections by review level (institute / district / state) and defects by
`deficiency_code`, not rejection reasons. **Open (FIX LATER).** **Fix:** a
reason-code list on the reject action.

### M24 - No non-fixture data for analytics (Phase 12; see M14)

Every row in the database is a registered test fixture, so the default
analytics views (fixtures excluded) show zeros; the demo path is
`include_fixtures=true` as SUPER_ADMIN. Group C's generator needs to write,
directly (the API stamps "now"): applications over several months and
several districts / institutions with `submitted_at`, back-dated
`workflow_transitions` and matching `stage_entered_at` / `stage_due_at`
(some past SLA); REJECT and DEFECT decision records (with deficiency codes);
selections, sanction orders and disbursements in several statuses; and at
least 5 applications per district / institution bucket so small-count
suppression does not mask everything. **Open (Group C).**

### M25 - Analytics scope and precision notes (Phase 12)

- Scoping is database RLS on the RLS-protected tables; `workflow_transitions`
  and `rule_evaluations` have no RLS (Phase 1), so analytics reaches
  transitions only through the RLS-scoped application cohort. Any other
  direct read of `workflow_transitions` as `app_user` is unscoped
  (pre-existing; not changed).
- Small-count threshold is 5. Counts 1-4 are shown as `<5`; a row with fewer
  than 5 applications is masked entirely; where one masked cell could be
  derived from a published state total, the smallest other non-zero cell is
  shown as `suppressed` (as are masked amounts - their true value may be any
  size). Totals at state level are published.
- The cohort is "applications submitted in [from, to)" (UTC), at most 366
  days; SLA timings come from `workflow_transitions` (the rows of the
  backdated surge fixture have a `submitted_at` older than their first
  transition).
- "Selected" mirrors Phase 6's unexported `LIVE_STATUSES`; a unit test fails
  if they drift.
- Audit history is not reported by analytics; where audit integrity is
  described it is "append-only, each row hashed and linked" (see H7).

## Added by Phase 13A (integrity fixes)

### M26 - The ML test suite failed 10 of 60 and was not part of the routine (ML; RESOLVED in Phase 13A)

All 10 failures were test-fixture defects, not service defects. The test
helper `make_doc_image` drew only `line[:50]` of at most 10 lines in ~10 px
glyphs and carried the full text in a PNG `ocr_text` chunk - the metadata
channel the OCR service deliberately stopped reading (security fix,
`tests/test_ocr_metadata_security.py`). Seven asserted values sat past
column 50 and were never in the pixels; the IFSC ended exactly at the cut;
two confidence floors (>= 0.88) measured 0.87 / 0.86 on the illegible
rendering. Fix (commit 509b823): `ml/tests/doc_render.py` draws every line,
word-wrapped and legible, with no text chunk; **no assertion or threshold
changed**. Measured with the legible fixture: clean income certificate
income 0.93, date 0.90, certificate number 0.91; degraded certificate number
0.49; passbook `SBIN0001234:30948291048` at 0.92. 60 / 60 pass with
`npm run test:ml` (production image + pytest, `--network none`), now in the
README's list of checks. Note: the synthetic fixtures use Hershey fonts at
one size; accuracy on real scans is not measured by this suite (see the ML
calibration notes).

### DEV-1 - OCR engine is Tesseract, not PaddleOCR (ACCEPTED deviation)

The plan named PaddleOCR with bundled models. The ML service uses Tesseract
(English + Hindi language data installed into the image at build time) with
OpenCV preprocessing; there are no separate model files. It runs offline at
runtime. Revisit only with a measured accuracy gap on real documents.

### DEV-2 - Scheme rules use the project's own expression language, not json-logic (ACCEPTED deviation)

The plan named json-logic. Rules are expressions in `api/src/rules-engine`
(tokenizer, parser, evaluator, per-criterion traces, `validate:rules`),
stored in scheme-version config. Same capabilities the plan asked for
(per-criterion results, message keys, reverse evaluation); a different
notation.

### M27 - Audited writes are serialised and slower (Phase 13A)

Every audited write takes the `audit_chain_head` row lock until its
transaction ends (the previous advisory lock serialised them too) and builds
canonical JSON in PL/pgSQL. Measured on a scratch copy, 8 connections x 25
single-row updates: audited 701 tps (11.4 ms mean latency) against 4,030 tps
(2.0 ms) for the same load on a table without an audit trigger. A long
transaction that touched an audited table delays every other audited write
until it commits. **ACCEPT** at current scale. **Fix if needed:** keep
transactions short; batch audit writes; or move to a per-partition chain.

### M28 - What the audit verifier cannot vouch for (Phase 13A)

The verifier proves every row from the checkpoint is intact, ordered and
continuous up to `audit_chain_head`. It cannot detect the database owner
deleting the newest rows AND rewriting `audit_chain_head` to match, nor
anything the owner does with the triggers disabled and then re-hashes
consistently (the chain is keyed by nothing secret). **Fix:** periodically
export `audit_chain_head` (seq + hash) outside the database, or sign it.
The API endpoint runs inside the 15 s request transaction; for large logs
use the CLI (10 min limit).

### M29 - The 857 audit rows before 2026-09-28 10:04 UTC are unverifiable legacy rows (Phase 13A)

They were hashed over text that was never stored and fork 177 times; they
are kept unchanged (the log is append-only). The CHECKPOINT row (seq 1)
anchors their count (857), time range (2026-09-27 19:50:33 to
2026-09-28 08:38:28 UTC) and digest `18b1535f...4c44`, so any later change to
the legacy set is detected - but not which row, and nothing that happened
to them before the checkpoint. **ACCEPTED.**

### M30 - `make install-ml` / venv tests cannot run on this setup (tooling; found in Phase 13A; RESOLVED in Phase 13B)

`make install-ml` pins with `ml/constraints.txt`, which does not exist; `make`
is not installed on the Windows development machine; a host venv would also
need Tesseract. The routine ML check is therefore the container command
(`npm run test:ml` / `make test-ml`); the venv path is kept as
`make test-ml-venv`. **Open (FIX LATER):** add `ml/constraints.txt` or drop
the pin.

**RESOLVED (Phase 13B, commit d95e30b).** `ml/constraints.txt` is the
`pip freeze` of the production ml image (`vidyasetu-ml:0.1.0`, Python
3.11.16, 30 packages); the Makefile's `PY` is Python 3.11, the image's
version. `make install-ml` now builds a venv with the production versions
(checked: numpy 2.4.6, fastapi 0.141.1, opencv 5.0.0). Remaining, by
design: the venv tests also need Tesseract on the host (20 of 60 fail
without it), so the routine ML check stays the container,
`npm run test:ml` (60 / 60).

### M31 - The authorization-denials chain is separate and not covered by the audit verifier (Phase 13A; RESOLVED in Phase 13B)

`authorization_denials` has its own `prev_hash` / `record_hash`, computed in
application code (0 forks among 18 rows at the time of the audit). It is not
part of `audit_logs` and `GET /api/v1/audit/verify` does not check it.
**Open (FIX LATER):** bring it under the same canonical rules and verifier.

**RESOLVED (Phase 13B, commit fc9bbd4; migration
`20260928100000_denials_chain_v2`).** The denials chain had the audit
chain's two defects (predecessor = latest `(occurred_at, id)`; hash over
`jsonb::text`), so it got the same fix: gap-free `seq` and the predecessor
from its own row-locked `authorization_denial_chain_head`;
`record_hash = sha256(hash_input)`, `hash_input` = the canonical JSON
(`api/src/audit/canonical.ts`) of the whole row. The 34 earlier rows are
legacy (seq NULL), anchored by a `DENIALS_LEGACY_CHECKPOINT` row in the
audit chain. `GET /api/v1/audit/verify` and `scripts/verify-audit-chain.ts`
now verify both chains (`report.denials`; `ok` needs both). Proven: 30
concurrent denials -> seq 1-30, 0 forks, 0 gaps; on a scratch restore a
content edit, a deleted row and a legacy edit were each reported
(CONTENT_MISMATCH at seq 12, SEQUENCE_GAP at seq 21, legacy mismatch); the
live database was fingerprinted before and after (identical).

## Added by Phase 13B (roles, override reasons, bulk clearing)

### Role gap (Phase 2 plan: committee and auditor roles) - RESOLVED in Phase 13B

`COMMITTEE` and `AUDITOR` exist (`api/src/auth/roles.ts`, `roles` seed,
provisioning via `POST /admin/officers`: both need a state, district
optional, no institution). AUDITOR reads applications, fraud flags,
authorization denials, analytics and `GET /audit/verify`, and gets 403 on
every write route. COMMITTEE reads `GET /selections` (provisional list,
ranks, score breakdowns, objections) and selection-objection grievances in
its scope. Both are scoped by the same RLS jurisdiction pattern as the
other officers (proven as `app_user`; no actor sees nothing). One dev user
per role: `api/scripts/seed-dev-role-users.ts` (password from
`DEV_ROLE_USER_PASSWORD`, refuses `NODE_ENV=production`). The RBAC matrix
covers both roles on every route.

### Override-reason gap (PHASE_MAP check c) - RESOLVED in Phase 13B

Every decision-changing action needs a reason of at least 10 characters
(trimmed; stored): reject, mark-defective, verify with an eligibility-review
override, OCR value correction (`POST /documents/:id/confirm` with
corrections; stored in `document_extractions.confirmation_reason`), fraud
disposition, renewal DISCONTINUE, grievance resolve / reject. API: `400
REASON_REQUIRED` (`api/src/common/reason.ts`). Database (migration
`20260928090000_decision_reasons`): `decision_records_reason_check` added
**NOT VALID** (the table is insert-only; the one earlier DEFECT row without
remarks is never re-checked), and BEFORE triggers on `document_extractions`,
`fraud_flags`, `renewals` and `grievances` that fire only when a decision
is being made, so later updates of old rows are unaffected. The reason is
in the decision's row, so the audit row for that write carries it. Reasons
are never logged and never reach analytics (leak search, Phase 13B proof 5).

### Bulk clearing (Phase 10/11 plan) - BUILT in Phase 13B

`POST /api/v1/applications/bulk-actions`: VERIFY or MARK_DEFECTIVE, at most
25 applications, `dry_run`, one shared reason (required for
MARK_DEFECTIVE). Every item runs through the ordinary workflow transition
(so it gets its own decision record and audit rows). Items outside the
caller's scope, at a stage the caller cannot act on, needing individual
eligibility review, or held by a HIGH fraud flag are skipped and reported
per item. There is no bulk reject and no bulk hold release. **One
transaction:** the whole batch commits or none of it does (a failing item
returns 409 with `committed: 0` and the failing item).

### M32 - AUDITOR read-only is enforced by the API only (Phase 13B)

The RLS policies are `FOR ALL` and scope by jurisdiction, not by role, so
the database would accept a write from an AUDITOR's actor context. Every
write route refuses AUDITOR (RBAC matrix), and there is no other write
path. **ACCEPTED.** **Fix:** role-aware `FOR INSERT/UPDATE/DELETE` policies
(`current_setting('app.actor_role') <> 'AUDITOR'`).

**RESOLVED in Phase 17 (Part D):** the database refuses it too. A
statement-level trigger, `refuse_auditor_writes()` (migration
20261003100000), is attached to every public table and raises
`AUDITOR_READ_ONLY` (SQLSTATE 42501) on INSERT / UPDATE / DELETE / TRUNCATE
while `app.actor_role = 'AUDITOR'`. Exceptions: `authorization_denials` and
its chain head (a refused attempt must be recorded), `audit_logs` and
`audit_chain_head` (audit trigger only), `document_access_log` (an
AUDITOR's view must be logged), `_prisma_migrations`, `test_fixtures`.
Proved as app_user and through application code (ActorTransactionRunner +
NotificationsService in the api container): refused, recorded as an
`AUDITOR_READ_ONLY` denial. A new table needs the trigger (checklist in
docs/SECURITY_REVIEW.md). See M65.

### M33 - The objection-window override stays with MINISTRY_OFFICER (Phase 13B; committee part RESOLVED in Phase 13E)

COMMITTEE reviews but does not confirm selections. Confirming a selection
(with or without the objection-window override) is the gate to the
sanction order and the disbursement path (an order is issued only for a
CONFIRMED selection, `sanction.service.ts`), which this phase was not
allowed to change. **Open (question for Pratham):** should COMMITTEE confirm, or
recommend with MINISTRY_OFFICER confirming?

**Phase 13E (commit c7eba26).** The committee now decides at list level:
it approves the provisional list, overrides rows with reasons, decides
objections, and may close the objection window early with a reason (the
list-level override). MINISTRY_OFFICER publishes. The per-selection
confirm and its objection-window override were **not moved**: confirming
still gates the sanction order and disbursement (out of scope). Instead,
for a list-managed run, confirm is refused until the final list is
published and for any row the final list did not select (so by then the
window has closed and the override is moot). Runs without a list (before
13E) confirm as before.

### M34 - The selection override reason has a 1-character minimum (Phase 13B; RESOLVED in Phase 13C)

`selections.override_reason` keeps its original rules (API `@Length(1,
1000)`; DB `selections_override_reason_check` from migration
`20260927020000_post_selection`: non-blank), not the
10-character minimum of the other reasons. Left as it was to avoid
changing the confirm / sanction path (M33). **Open (FIX LATER):** raise
both to 10.

**RESOLVED (Phase 13C, commit fba4334; migration
`20260929100000_selection_override_reason_min`).** API: confirming inside
the window with a reason under 10 trimmed characters is `400
REASON_REQUIRED` (`requireReason`); no reason at all keeps the existing
`409 objection_window_open`. DB: a BEFORE trigger refuses an override
being made (insert, newly overridden, or a changed reason) under 10
trimmed characters; `selections_override_reason_check` is unchanged and
existing rows are never re-checked (0 of the 7 had a short reason). Proven
as app_user: raw INSERT with 9 characters and with 6 after trimming
refused; changing an existing reason to "short" refused; a 30-character
reason accepted; updating the 8 overridden rows without touching the
reason accepted. The confirm flow itself (M33) is unchanged.

### M35 - A grievance resolution note is sent to the applicant (by design; Phase 13B)

The required `note` on grievance resolve / reject is the answer to the
applicant and goes into the `grievance.resolved` notification. Officers
must not put third-party details in it. **ACCEPTED.**

### M36 - `GET /audit/verify` falsely fails the denials chain for a state-scoped AUDITOR (Phase 13B; found at the end of 13B; RESOLVED in Phase 13C)

The verifier reads `authorization_denials` inside the caller's request
transaction, and that table is under jurisdiction RLS. A SUPER_ADMIN
(national) and the owner CLI see every row and verify both chains
(`ok: true`; 34 / 34 legacy denial rows, 30 chain rows). An AUDITOR scoped
to Jharkhand sees 32 of the 34 legacy rows (the other 2 are national
MINISTRY_OFFICER denials with no jurisdiction), so the digest does not
match and the report says `ok: false` with no break found - a false alarm.
Any later denial outside the auditor's scope would likewise appear as a
SEQUENCE_GAP. The audit_logs chain is not affected (no RLS on it). Not
fixed: both fixes touch the RLS boundary (a SECURITY DEFINER read of all
denial rows for the verifier, or national-scope AUDITORs), so they were
left for a decision. **Open.** Until then, verify with the CLI
(`scripts/verify-audit-chain.ts`) or as SUPER_ADMIN.

**RESOLVED (Phase 13C, commit c6cb543; migration
`20260929090000_denials_verifier_read`).** The api's verifier reads the
denial rows only through `audit_verifier_denial_rows()`: SECURITY
DEFINER, STABLE, EXECUTE for app_user only; it refuses unless
`app.actor_role` is AUDITOR or SUPER_ADMIN **and** the actor's active
officer row holds that role (the setting alone is not trusted); it returns
only the columns the hash check needs. The CLI keeps its owner-connection
read. The response stays a summary (the NOT_CANONICAL detail no longer
quotes the JSON parser's message, which can echo row text). Proven:
Jharkhand AUDITOR `ok: true` on both chains (34 / 34 legacy denials) over
HTTP and as app_user; SUPER_ADMIN unchanged; DNO and applicant 403, no
token 401; as app_user the function refuses a DNO, a DNO or applicant
claiming `actor_role=AUDITOR`, and no actor. On a scratch restore, through
the same app_user / AUDITOR path: edit -> CONTENT_MISMATCH at seq 12
[ip_address], delete -> SEQUENCE_GAP at seq 22, relink (re-hashed
consistently) -> LINK_MISMATCH at seq 25; live fingerprint identical before
and after.

## Added by Phase 13C (M36, M34, the deficiency loop)

### Deficiency loop (plan Phase 10) - BUILT in Phase 13C

Itemised deficiencies (`deficiency_items`: document slot / type, check,
problem and fix message keys, deadline, status, crop reference) raised by
`POST /applications/:id/deficiencies` from the automatic checks that fail
(document present, quality gate, certificate validity, name / date-of-birth
consistency) and officer-added items (a field marked unreadable, or a
manual problem) with the shared reason; one notice per deficiency in the
applicant's language (English and Hindi `notice_templates`; English
fallback recorded in `notifications.requested_locale`); only the named
documents may be replaced while items are open;
`POST .../deficiencies/:id/resubmit` re-runs only the checks the changed
documents feed and, when every item is cleared, uses the existing resubmit
transition; bulk ISSUE_DEFICIENCY / RESOLVE_DEFICIENCY with dry run. Commits
a575ae2, 693b753.

### M37 - Certificate validity months are an assumption and not per scheme (Phase 13C; per-scheme part RESOLVED in Phase 13D)

No validity rule existed anywhere (scheme config or code). The deficiency
checks read `DOCUMENT_VALIDITY_MONTHS` (default `{"INCOME_CERTIFICATE":12}`):
one value per document type for every scheme. 12 months is an assumption
(issuing states differ; some tie it to the financial year). Locked scheme
versions cannot take a new config key, so a per-scheme rule needs a new
scheme version. The item deadline can already be per scheme
(`deficiency_policy.deadline_days` in a version's config, else
`DEFICIENCY_DEADLINE_DAYS`, default 15). **Open - question for Pratham:**
the validity rule per document type (and per scheme, if it differs).

**Phase 13D (commit 576787b): per scheme - RESOLVED; the 12-month value -
still OPEN.** The check now uses the scheme version's
`deficiency_policy.document_validity_months` laid over the
`DOCUMENT_VALIDITY_MONTHS` default (a type listed there uses its months,
`null` drops the rule, a type with no rule never expires - unit-tested). A
version already used by applications is immutable (the trigger refused a
live update: "referenced by 113 application(s)"), so a per-scheme value
arrives with a new scheme version; how-to in `docs/DEFICIENCY_CONFIG.md`.
The 12-month income-certificate default still awaits confirmation.

### M38 - No crop reference: the OCR service returns no bounding boxes (Phase 13C; RESOLVED in Phase 13D)

Tesseract's `image_to_data` computes word boxes, but
`ml/app/services/ocr_service.py` keeps only the text, and fields are found
by regular expressions over that text, so no field is tied to a region.
`deficiency_items.crop_ref` is therefore always NULL and there is no crop
route (nothing was fabricated). **Open (FIX LATER):** return word boxes
from the ml service, map each extracted field to its words' union box
(page + box), store it, and add a scoped crop route.

**RESOLVED (Phase 13D, commits bba54ab, 287a5b5).** The ml service keeps
Tesseract's word boxes and ties each extracted value to the words that read
as it (the extractors' own date / number / token normalisation); a box only
for exactly one match, otherwise null. Boxes are in the stored image's pixel
grid (EXIF orientation undone). Measured on the renderer's own layout
(`ml/tests/test_field_boxes.py`): issue date IoU 0.85, certificate number
0.73, income 0.77, name 0.72 (each box covers 72-85% of the true region); the
same on a phone-style JPEG stored rotated with EXIF orientation 6; a date
printed twice gets no box. `document_extractions.field_boxes` stores them;
validity and field items carry `crop_ref`; `GET
/applications/:id/deficiencies/items/:itemId/crop` returns the region (24 px
margin; the ml service refuses anything over half the page) to the owning
applicant and officers in jurisdiction - 404 for others, 403 AUDITOR /
COMMITTEE / SUPER_ADMIN, 401 without a token; generated on demand, not
stored, `Cache-Control: no-store`. Live (ML_MODE=real): a 191x69 px crop =
1.7% of the page, showing only "Date: 01/06/2024". The notice links to the
crop. Remaining limits: M44.

### M39 - The original resubmit route ignores deficiency items (Phase 13C; RESOLVED in Phase 13D)

`POST /applications/:id/resubmit` (Phase 4) still returns a DEFECTIVE
application to review without looking at deficiency items: the workflow
rules were out of scope. The itemised path
(`.../deficiencies/:id/resubmit`) requires every item to be cleared.
**Open (FIX LATER):** a guard on the resubmit transition, or retire the old
route for itemised deficiencies.

**RESOLVED (Phase 13D, commit 7c7004e).** `POST /applications/:id/resubmit`
now hands an application with an open itemised deficiency to the deficiency
service (same partial recheck, item resolution and - only when every item is
cleared - the same resubmit transition); without open items it is the Phase
4 route unchanged. No workflow state, transition or role changed. Proven
live with two identical applicants, old route vs new route, at three steps
(before any upload, after another expired certificate, after a current one):
identical results each time; with only a plain (non-itemised) deficiency the
old route still returns its original response and moves DEFECTIVE ->
INO_VERIFIED.

### M40 - Manual (officer) items have no automatic check (Phase 13C)

An OFFICER item (e.g. "not attested") becomes RESUBMITTED when its
document is replaced and does not block resubmission; it never becomes
RESOLVED automatically. The reviewing officer's next decision on the
application is the resolution record. **ACCEPTED.**

### M41 - Notification language coverage (Phase 13C; RESOLVED in Phase 13D, translations pending review - M43)

Only the deficiency notice has Hindi text; every other notification
template (`api/src/notifications/templates.ts`) is English only, so a
Hindi applicant gets those in English (the fallback is recorded:
`requested_locale` = hi, `locale` = en). The language is set at
registration (`preferred_language`); there is no route to change it
afterwards, and existing applicants are `en`. **Open (FIX LATER).**

**RESOLVED (Phase 13D, commit 3e6b557).** `GET / PATCH
/api/v1/applicants/me` (own profile only; phone and preferred_language
editable; identifiers masked; each change recorded as field names in the
audited, owner-only `applicant_profile_changes`); `SUPPORTED_LANGUAGES`
(default `en,hi,sat`) checked at registration and on change. All 23
template keys, the rule / quality messages and the texts intents used to
insert in English now have Hindi; `templates.spec.ts` fails the build if a
key lacks either language. Proven: after switching to Hindi, five
notification types arrived in Hindi (retake, grievance registered / in
progress / resolved, deficiency notice); `sat` fell back to English with
`requested_locale = sat`; `fr` refused (400). The Hindi is not verified:
M43.

### M42 - Recheck scope notes (Phase 13C)

- The eligibility criteria a changed document feeds (`doc_refs`, e.g.
  income certificate -> `income_ceiling`) are reported from the pipeline's
  cross-check of the new document; a failure there is reported, not turned
  into an item.
- The name / date-of-birth items wait for the pipeline's consistency
  re-evaluation (PENDING until it is newer than the replaced document).
- "Missing document" items are not raised for checklist slots marked
  "(if applicable)" - a text match on the scheme's checklist wording.
- OVERDUE is computed when read (an OPEN / RESUBMITTED item past its
  deadline); nothing sweeps the table and no reminder is sent.
- The ml service calls the issue date `issued_date`, the api mock
  `issue_date`; the check reads both.

**ACCEPTED.**

### DEV-3 - Jest reports a worker that did not exit (tests; found in Phase 13C; cause found in Phase 13D; RESOLVED in Phase 13E)

`npm run test:e2e` prints "A worker process has failed to exit
gracefully" after `app.e2e-spec.ts` / `domain-events.e2e-spec.ts`; every
test passes. The same warning appears on the Phase 13B code (checked by
stashing the 13C changes), so it predates 13C. **Open (FIX LATER):** find
the open handle (`--detectOpenHandles`).

**RESOLVED (Phase 13E, commit efadfe1).** `RedisService.onModuleDestroy`:
an ended client is left alone; while ioredis is `reconnecting` (its socket
already closed) `disconnect()` still cancels the pending reconnect, and the
close is re-announced on the closed socket so ioredis clears the 2 s
destroy timer at once. Measured with Redis unreachable and `app.close()`:
process exit 2003 ms -> 4 ms after close; `npm run test:e2e` (728 tests)
no longer prints the worker warning. A unit test fails without the fix.
Remaining (a different cause): M46.

**Phase 13D - cause found; it is production code, so reported, not fixed.**
`--detectOpenHandles` reports nothing (the handle is a plain timer). Traced
with `async_hooks`: the e2e apps point Redis at 127.0.0.1:1, so after any
request the ioredis client is `reconnecting` with its old socket already
closed. `RedisService.onModuleDestroy` calls `disconnect(false)`: ioredis
5.11.1 clears the reconnect timer correctly, then calls
`connector.disconnect()` on the stale socket, which arms a 2 s
`disconnectTimeout` timer (not unref'd) waiting for a `close` event that
already fired - so it always runs its full 2 s and holds the Jest worker
("did not exit one second after the test run"). A bare boot + close with no
request exits cleanly. A test-side workaround (destroying the socket after
close) does not clear the timer, and it was reverted. Production effect:
shutdown delayed by up to 2 s only while Redis is down; harmless. **Open
(FIX LATER, needs a decision):** in `RedisService.onModuleDestroy`, skip
`disconnect()` when the client is `reconnecting` / `end` (nothing to close),
or set ioredis `disconnectTimeout` low.

## Added by Phase 13D (crop references, resubmit, applicant language)

### M43 - Hindi notification texts are machine-drafted and unverified (Phase 13D)

Every Hindi string (templates, message keys, `notice_templates` rows) was
written during development and has not been reviewed by a fluent speaker.
The build enforces that each exists with the right placeholders, not that
it is correct. **Open - before the demo:** review per
`docs/TRANSLATION_REVIEW.md` and record it there.

### M44 - Crop reference limits (Phase 13D)

- PDFs cannot be decoded by the ml service, so a PDF upload has no OCR and
  no boxes (page is always 1). **RESOLVED in Phase 13E (commit 9f42168):**
  page 1 of a PDF is rasterised at 200 dpi and goes through OCR; its boxes
  and crops use that raster (`pdf_page1_raster_200dpi`). Remaining PDF
  limits: M47.
- The mock engine (`ML_MODE=mock`, the default) returns no boxes: its
  fixtures have no layout. Crops appear only with the real ml service.
- A box is returned only when the value is read in exactly one place (a
  value printed twice gets none) and only on one line; multi-line values
  get none.
- Only validity items (the issue date) and field items carry a crop;
  missing-document, unreadable-scan and cross-document items have none.
- Crop views are not audited - document views are not audited anywhere
  (the audit chain records writes); the api logs ids and sizes only.

**ACCEPTED.**

### M45 - Applicant profile scope notes (Phase 13D)

- `applicants` has no row-level security (the notification and document
  workers read it without an actor); the profile routes scope every query
  to the caller's own account and have no `:id`. The new
  `applicant_profile_changes` table has owner-only RLS.
  **RESOLVED in Phase 17 (Part D):** `applicants` has RLS (migration
  20261003100000): owner all; officers read under the domicile
  jurisdiction; reviewer roles update (the verified correction path); the
  SYSTEM actor reads (document pipeline, fraud data, notification
  recipient lookup, which now runs as SYSTEM); no actor sees nothing.
  Login / refresh use `applicant_id_for_account()` (SECURITY DEFINER, id
  only). See M62, M63.
- Only phone and notification language are self-editable; everything that
  decides eligibility or identity stays behind registration / officer
  review.
- Officers have no language preference: officer notifications are English.
- `sat` (Santali) is accepted but has no texts yet: English, recorded.

**ACCEPTED.**

## Added by Phase 13E (DEV-3, PDF OCR, committee review / final list / fairness)

### Committee review, publication and the final list (plan Phase 13) - BUILT in Phase 13E

A committed selection run opens a DRAFT selection list whose entries keep
the allocator's result as computed (outcome and rank - the allocator is not
changed or re-run) with the committee's decision beside it. Lifecycle on the
generic workflow engine: DRAFT -> PROVISIONAL_PUBLISHED (objection window
open) -> OBJECTION_WINDOW_CLOSED -> FINAL_PUBLISHED (frozen by trigger).
COMMITTEE approves (`SELECTION_LIST_APPROVALS_REQUIRED`, default 1, counted
after the latest override), overrides rows with a reason (>= 10 trimmed
characters, API and DB CHECK), decides objections and may close the window
early with a reason; MINISTRY_OFFICER publishes and closes. Held
applications cannot be included and stay listed as held. Applicants hear
at provisional and final publication (English / Hindi) and see only their
own result. Commit c7eba26.

### Fairness data (plan Phase 13 / 16) - BUILT in Phase 13E

`GET /api/v1/analytics/fairness` (+ CSV): applied vs selected by category,
gender, PwD status, district and institution type with selection rates,
under the analytics rules (RLS, fixtures excluded by default, one scheme +
year, <5 and secondary suppression, aggregates only). Verified against
independently written SQL on a hand-built 16-application oracle: every
dimension matched, in JSON and CSV. Commit 88a79ab.

### M46 - Container shutdown waits on a DNS lookup while the Redis container is stopped (Phase 13E)

With the Redis **container stopped**, its hostname no longer resolves:
`getaddrinfo` for `redis` takes 3.8-3.95 s to fail inside the api
container, and a reconnect attempt in flight at shutdown holds the process
until it does (libuv thread pool; not cancellable from
`onModuleDestroy`). Measured `docker compose stop api`: 884 / 951 ms with
Redis up, 3979-4214 ms with the Redis container stopped - before and after
the DEV-3 fix (whose own 2 s timer is gone). Harmless (a slower stop only
during a Redis outage). **Open (FIX LATER):** exit explicitly after the
shutdown hooks in `main.ts`, or resolve Redis by IP / a longer-lived DNS
entry.

### M47 - PDF limits (Phase 13E)

- Page 1 only: later pages are not read (quality details report
  `page_count`).
- A password-protected PDF is refused (`pdf_encrypted`); there is no way
  to supply the password.
- A page side over A2 (1684 pt) or a raster over 20 MP is refused
  (`pdf_too_large`).
- Finding while testing: JPEG ringing around dark text on a grey page
  reads as glare to the quality gate (a Pillow-written PDF, which embeds
  JPEG, was rejected with `glare_detected`; the same page stored losslessly
  passed). Heavily JPEG-compressed scans may be rejected as glare. The
  threshold was not changed. **Open (FIX LATER):** calibrate the glare
  check on real compressed scans.

**ACCEPTED** (first three).

### M48 - Selection list scope notes (Phase 13E)

- Only runs made after Phase 13E have a list; older runs keep the Phase 9
  behaviour (confirm with an override during the window).
- NFST is ranked without a cap, so nobody is computed NOT_SELECTED (an
  applicant without scores is selected, unranked); objections there come
  only from applicants the committee excluded.
- Objections to a list-managed run: only while its window is open, from an
  applicant whose list outcome is NOT_SELECTED.
- List rows (scheme, year, status, times) have no row-level security - no
  personal data; the api gates by role. Entries and entry decisions are
  under jurisdiction RLS; list-level decisions (approval, early close) are
  visible to every active officer.
- An applicant can read the decision rows on their own entry at the
  database level; the api shows the committee decision but not its reason
  (an objection's reason reaches them as the grievance note - M35).
- A committee member approves the whole list but sees and overrides only
  rows in their jurisdiction; with several state committees, set
  `SELECTION_LIST_APPROVALS_REQUIRED` to their number.
- Early close of the objection window is the committee's list-level
  override; it needs every objection decided (counted across jurisdictions
  by `selection_list_pending_objections()`, a count-only function).

**ACCEPTED.**

### M49 - Fairness data notes (Phase 13E)

- Institution type is not recorded: it is derived from the institution
  code's family (AISHE `U-` / `C-` / `S-`, 11-digit U-DISE, else OTHER) -
  a heuristic, not a registry.
- With small cohorts almost every cell is suppressed (the 16-application
  oracle published two applied counts per dimension at most, and no
  rates); the view is meaningful only at district / state scale (M24).
- "Selected" is the final list's outcome where a final list is published,
  otherwise a live selection.
- COMMITTEE may read it (it reviews the lists); applicants may not.

**ACCEPTED.**

## Added by Phase 14 loose ends (plan Phases 4, 5, 6, 14 and 15)

### Scheme authoring (plan Phase 4) - BUILT in Phase 14 loose ends

`/api/v1/admin/schemes`: create a scheme, draft / edit / validate / preview /
publish / retire versions and diff configs, through the API only. Drafts are
validated against `schemas/scheme-config.schema.json` (Ajv, now a runtime
dependency; the schema ships in the api image), the rules grammar, the
`params.*` check and the workflow reference; every problem is a
VALIDATION_ERROR item with a message key (English and Hindi). Drafts are
hidden from the public routes. A published version is immutable in the API
(409) and in the database (trigger `scheme_version_publication_lock`, which
also refuses deleting it or returning it to draft). Author and publisher roles
come from `SCHEME_AUTHOR_ROLES` / `SCHEME_PUBLISHER_ROLES` (default
SUPER_ADMIN, MINISTRY_OFFICER); AUDITOR and every officer may read. schemes
is now audited (real changes only). `npm run validate:rules -- --db` also
checks every version in the database. Proved with TRIBAL_ARTS_P14: created,
published and used (form schema, eligibility, an application through the
gate) with zero code changes. Notes: M51.

### SLA breach sweep (plan Phase 5) - BUILT in Phase 14 loose ends

A BullMQ repeatable job (`SLA_SWEEP_ENABLED`, `SLA_SWEEP_INTERVAL_MS`, default
15 minutes) records one `sla_breaches` row per stage instance (application,
stage, stage_entered_at) whose `stage_due_at` has passed - the same rule as
`GET /applications/sla-breaches` and the analytics SLA view (proved equal on
the same data) - as the SYSTEM actor, audited, idempotent. Each new breach
emits `workflow.sla_breached`; the officer role acting at the stage is
notified (`officer.sla_breached`, English and Hindi). Notes: M50.

### Application drafts (plan Phase 6) - BUILT in Phase 14 loose ends

`/api/v1/application-drafts`: save, list, resume, edit and submit. Drafts are
their own owner-only table (`application_drafts`), not applications, so no
officer queue, analytics funnel (no draft bucket), fraud detector or selection
sees them. Submitting runs the unchanged `POST /applications` path in the
same transaction and freezes the draft (trigger). Notes: M52.

### Sanction orders reference their audit record (plan Phase 14) - BUILT in Phase 14 loose ends

The order is inserted before its PDF is drawn, so the PDF (printed text, QR
code and the PDF /Subject) carries the seq and record hash of the audit-chain
record of that INSERT. `POST /sanction-orders/verify` takes `audit_chain`
and checks the record exists, is this order's INSERT, carries the recomputed
content hash and passes the verifier's own row check (hash, content, link to
the predecessor). Notes: M54.

### Aadhaar authentication adapter (plan Phase 15) - BUILT (mock) in Phase 14 loose ends

`AadhaarAdapter` (`AADHAAR_MODE`, mock by default; real fails closed with
DEPENDENCY_UNAVAILABLE). `POST/GET /api/v1/applicants/me/aadhaar-authentication`.
The number is normalised the fraud-index way, checked (12 digits, Verhoeff)
and never stored, returned or logged: `aadhaar_authentications` keeps the
outcome, an HMAC of the number and its last four digits. Notes: M55.

### M50 - SLA figures are placeholders; officer notices are English (Phase 14 loose ends; officer language RESOLVED in Phase 16)

- The durations the sweep applies are `STAGE_SLA_DAYS` in
  `api/src/workflow/vidyasetu-workflow.ts` (INO 7, DNO 7, SNO 10,
  MINISTRY_APPROVED 15, DEFECTIVE 15 days). **No source is cited** in the
  code, the docs or the history: they are PLACEHOLDERS set in Phase 4, not
  figures from the scheme guidelines. Nothing in this phase invented or
  changed a value. **Open - question for Pratham:** the real per-stage
  timelines (by scheme, if they differ).
- Officers have no language preference (no column on `officers`), so SLA
  notices reach them in the default language, English. The Hindi template
  exists and is checked for parity. **Open (FIX LATER):** an officer
  language setting. **RESOLVED (Phase 16 C1, commit eeb42f1):** officers set
  a notice language (`officer_preferences`, audited without personal data;
  validated against SUPPORTED_LANGUAGES; the officer or SUPER_ADMIN sets it).
  Proved: INO Ranchi set to Hindi received the SLA notice in Hindi; DNO
  Ranchi set to Santali (no templates) received English with
  `requested_locale = sat` recorded; SNO with no setting, English.
- A DEFECTIVE breach (the applicant's resubmission window) is recorded but
  notifies nobody: no officer acts at that stage.
- The sweep only records and notifies; it does not escalate or reassign.
- The proof backdated fixture stage times with owner SQL (audited, tagged).

**ACCEPTED** (last three).

### M51 - Scheme authoring scope notes (Phase 14 loose ends; first bullet RESOLVED in Phase 16)

- **A new scheme's scoring rule is evaluated but cannot yet be used for
  selection.** `selection/selection-policies.ts` maps configs to the
  allocator by known operational rule ids (NOS slots, NFST criteria) and
  refuses unknown ones ("refusing to guess"). A new scheme with only
  eligibility rules is NO_COMPETITION; one with its own scoring rule is
  refused at run-selection. Not changed: selection policy is outside this
  phase's allowed files. **Open (FIX LATER):** a declared selection policy
  in the config (basis, merit rule, direction), validated like the rest.
  **RESOLVED (Phase 16 B, commit 5937b9a):** `config.selection_policy`
  declares the basis; it maps onto the existing policy shapes and allocator
  inputs (M59). Proved with FOREST_SCIENCE_P16 (QUOTA, own weights): six
  applicants to a published provisional list, dry runs byte-identical;
  every seeded version's policy and every seeded dry-run selection
  byte-identical before and after.
- The workflow reference is validated against the known definitions, but
  the platform has one (`vidyasetu-scrutiny/v1`) and every application uses
  it; a per-scheme workflow needs a second definition.
- `schemes` / `scheme_versions` have no row-level security (public data, as
  before): a draft is readable by any app_user connection; the api hides
  drafts from every public route.
- Stricter than the seed: authoring refuses an expression outside the rules
  grammar, so copying a PRE_MATRIC version (`pre_matric_class_tenure`) with
  `based_on_version` is refused until that rule is rewritten.
- If the seed file ever changes a published version's config, db-migrate
  now fails (the publication lock) instead of silently updating it - a
  change must become a new version.
- Dates are UTC calendar dates; retiring needs no reason (it is audited).
- The seed's `scheme_versions` updates of unreferenced versions still write
  audit rows on every db-migrate run (pre-existing, Phase 1 trigger); the
  new `schemes` trigger audits real changes only.

**ACCEPTED** (except the first bullet).

### M52 - Application draft notes (Phase 14 loose ends)

- Documents cannot be attached to a draft (uploads need an application);
  they are uploaded after submission, as before.
- At most 20 open drafts per applicant; no delete / discard route.
- Declared inputs refuse recorded fields and the sensitive list, so a draft
  holds nothing that needs encryption.

**ACCEPTED.**

### M53 - Renewal scheduling notes (Phase 14 loose ends)

- The renewal year's instalments are dated from the approval date, every
  three months (NFST), not from an academic calendar (none is in the scheme
  data).
- A renewal must be exactly the next year after the recorded one
  (`applications.course_year`, else the last approved renewal); a repeated or
  skipped year cannot be approved (discontinue it instead). An application
  with no recorded year records `year_advanced_from` NULL.
- Rates stay PENDING_CONFIRMATION (Phase 12 D1); HRA and the contingency
  grant remain unscheduled; FORWARDED_TO_STATE schemes schedule nothing.

**ACCEPTED.**

### M54 - What the sanction order's chain reference proves (Phase 14 loose ends)

Proves: the order data hashes to the stored content hash, and that hash was
written by an audited INSERT of this order at the referenced chain record,
which verifies and links to its predecessor. Does not prove: that the chain
after that record is intact (run `GET /api/v1/audit/verify`), that text
printed around these values was not altered, or anything outside this
database (the chain has no external anchor and the order no digital
signature). The 7 orders issued before this phase have no chain reference
(their audit rows predate the numbered chain) and verify by content hash
only.

**ACCEPTED.**

### M55 - Aadhaar adapter notes (Phase 14 loose ends)

- Mock only. Real mode needs AUA/KUA onboarding, a licence key and the UIDAI
  certificate; until then it refuses with DEPENDENCY_UNAVAILABLE and never
  falls back to the mock.
- The mock accepts only synthetic numbers (first digit 0 or 1, never issued
  by UIDAI) and refuses any number that could be real.
- The keyed hash uses FRAUD_MATCH_KEY with its own field prefix: rotating
  that key changes both indexes.
- The last four digits are stored (the UIDAI masked form).
- No uniqueness rule across accounts yet (M9): the keyed hash makes one
  number on two accounts detectable (proved: 1 hash for 2 rows); nothing
  enforces it.
- Only the applicant sees their authentication (owner-only RLS); officers
  cannot yet see whether an applicant is authenticated. **RESOLVED (Phase 16
  C2, commit eeb42f1):** in-jurisdiction reviewers (INO / DNO / SNO /
  MINISTRY_OFFICER) see the outcome (AUTHENTICATED, NOT_AUTHENTICATED,
  NOT_ATTEMPTED), the last four digits and the time in the officer
  application view, through `aadhaar_status_for_application()`; never the
  number or the hash. Out-of-jurisdiction officers, AUDITOR, COMMITTEE,
  SUPER_ADMIN, applicants and no actor get nothing.
- A timeout is a 503 and is not stored.
- Finding: Postgres logs the text of a failed statement. The leak search's
  only Aadhaar hit was the proof's own deliberate raw INSERT refused by a
  CHECK; the api uses bound parameters, so values never appear there.
  **Correction (Phase 16 C3):** the last clause is wrong for constraint
  violations - the `DETAIL: Failing row contains (...)` line logs the row's
  values even when they were bound parameters. See M60.

**ACCEPTED** (Open: the M9 uniqueness rule and officer visibility, FIX LATER).

## Added by Phase 16 (analytics completion, M51, officer language, M55)

### Officer workload and verification quality (plan Phase 16) - BUILT in Phase 16

`GET /api/v1/analytics/workload` (STATE_NODAL_OFFICER, MINISTRY_OFFICER,
AUDITOR, SUPER_ADMIN) and `GET /api/v1/analytics/verification-quality`
(the analytics readers), each with CSV, XLSX and PDF, under the analytics
rules (read-only transaction, RLS, fixtures excluded by default, window of at
most 366 days, suppression at 5 with secondary suppression, aggregates only).
Matched independently written SQL on a hand-built oracle (12 applications,
29 documents, 31 officer actions) in JSON, CSV, XLSX and PDF. Commit
c5494ed. Notes: M56, M57.

### XLSX and PDF exports (plan Phase 16) - BUILT in Phase 16

Every analytics view (funnel, SLA, schemes, disbursements, fraud,
jurisdiction, workload, verification quality) and fairness exports CSV,
XLSX and PDF from one table: exactly the CSV's rows and columns (so never
more than the JSON), generated on demand, never stored. XLSX carries a
metadata sheet; PDF a footer on every page (window, scope and caller role,
fixture setting, threshold, what "<5" and "suppressed" mean). The existing
CSVs are byte-identical to before. No dependency was added. Notes: M58.

### M56 - Officer workload notes (Phase 16)

- Officers are grouped by role and jurisdiction level (DISTRICT, STATE,
  NATIONAL); no officer id or name is shown. A row covering fewer than 5
  officers (or fewer than 5 timed decisions) shows no handling times, so one
  officer's speed cannot be read; its counts are still shown, subject to
  count suppression. At the current scale every row covers under 5
  officers: times are always "suppressed" until more officers work in a
  scope.
- Bulk actions are not recorded as such (each item is an ordinary action;
  the batch id is only logged), so `bulk_actions` is always null.
  **Open (FIX LATER):** record the batch id on the transitions it writes.
  **RESOLVED in Phase 17 (F4):** `decision_records.bulk_batch_id`
  (additive, nullable) is set for every decision a bulk action writes, and
  `bulk_actions` counts them. See M76.
- Handling time is the time the application spent in the stage before the
  decision, not officer effort (no "opened" / "claimed" time exists).
- Overrides are: eligibility-review confirmations, document confirmations
  with corrected values or a different document type, fraud flags marked
  FALSE_POSITIVE, selections confirmed inside the objection window, and
  committee row overrides.
- Queues are a snapshot of current stages (not windowed); breaches are
  sla_breaches detected in the window.

**ACCEPTED** (except the bulk bullet).

### M57 - Verification quality is routing, not accuracy (Phase 16)

The view reports how often the machine routed a document past officers
(auto_accept_rate) and how often an officer who reviewed a document changed
the machine result (override_rate). It does not measure whether the machine
was right: an auto-accepted document was never checked by a person, and an
unchanged confirmation does not prove correctness. Officers cannot reject a
document (only confirm, with or without corrections); `rejected_unreadable`
is the automatic quality gate. Slots without a canonical type are
"UNMAPPED"; DigiLocker documents are issuer data (no auto-accept rate).
Only routing columns are read, never extracted values.

**ACCEPTED.**

### M58 - Export format notes (Phase 16)

- XLSX is written by a small in-house writer (stored ZIP, inline strings,
  no styles): text cells are never formulas; numbers are numeric cells.
  Spreadsheet programs open it; it has no formatting.
- PDF uses pdfkit's built-in Helvetica (WinAnsi): text outside Latin-1 (for
  example Devanagari) cannot be drawn in a PDF export. All current export
  data is ASCII (codes, counts, district names). **Open (FIX LATER):**
  embed a Unicode font if exports ever carry non-Latin text.
- One table per view: views whose JSON has several parts (workload,
  jurisdiction, fraud) put them in one table with a section / level /
  subject column, exactly like their CSV.

**ACCEPTED** (except the PDF font bullet).

### M59 - Declared selection basis notes (Phase 16)

- `selection_policy.basis`: NO_COMPETITION, RANKED_NO_CAP or QUOTA. The merit
  value is the declared operational rule's computed result (the NFST
  reading); QUOTA pools are ST_OTHERS / PVTG (the selections table's CHECK)
  with an optional female earmark (the NOS shape). No PwD reservation, no
  other pool keys and no reading of a trace operand (the NOS QS-rank
  reading) - these would need policy data or allocator inputs this phase
  may not add.
- A declaration takes precedence over the rule-id mapping for that version.
  No seeded version declares one.
- Validated twice: the JSON Schema (shape) and the same mapping
  run-selection uses (a merit rule that is not an operational rule of the
  version, duplicate pools) - message key
  `scheme_config.selection_policy_invalid` (English and Hindi).

**ACCEPTED.**

### M60 - Postgres logs values of failed statements (Phase 16 C3; for Phase 17)

Current settings (unchanged in this phase): `log_min_error_statement=error`,
`log_statement=none`, `log_error_verbosity=default`,
`log_parameter_max_length_on_error=0`, logs to stderr (`docker compose logs
postgres`). What a failed INSERT logs (proved with a non-personal marker):
- a value written as a SQL literal appears in the `STATEMENT:` line;
- a value sent as a bound parameter (as the api's Prisma client sends every
  value) does not appear in `STATEMENT:` (`$1, $2 ...`), BUT a constraint
  violation (CHECK, NOT NULL) logs `DETAIL: Failing row contains (...)`
  with every column of the row - bound values included.
With real data, a failed write of a row holding personal data (a plaintext
name, a date of birth) would put that data in the Postgres log. Encrypted
columns would appear only as ciphertext. **Open (Phase 17):** decide the
database logging policy (e.g. `log_error_verbosity=terse`, which drops
DETAIL, and log retention / access), then prove it with the leak search.
Not changed in Phase 16, as instructed.

**RESOLVED in Phase 17 (Part A3):** the postgres service now runs with
`log_min_messages=log`, `log_error_verbosity=terse`,
`log_min_error_statement=panic`, `log_statement=none`,
`log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`
(docker-compose.yml `command`), and every service's container log is
rotated (json-file, 3 x 10 MB). Proved with four markers (SQL literal,
bound value, duplicate key, invalid UUID): none appears in the Postgres
log; no STATEMENT or DETAIL lines. The debugging cost is M66.

### Other Phase 16 notes

- AUDITOR (read-only) cannot change its own notice language; a SUPER_ADMIN
  can set it.
- `officer_preferences` needed a follow-up migration (20261002091000) adding
  the row id the audit trigger reads; the first write failed inside the
  trigger before any row existed.
- The Aadhaar status is not shown to SUPER_ADMIN, AUDITOR or COMMITTEE (not
  reviewers of the application).

**ACCEPTED.**

## Added by Phase 17 (security and privacy hardening)

Resolved in this phase:
- M32 (AUDITOR read-only now in the database);
- M45 (applicants RLS);
- M60 (Postgres logging);
- the Phase 16 bulk-actions bullet.

The entries above are marked in place. Proof scripts are in `scripts/proofs/p11/p17/`.

### M61 - Free text can carry the value it is about (Phase 17 B4)

- A correction request's new value is stored encrypted, but its reason is plain text.
- If the applicant writes the value into the reason (for example "the certificate reads Rinky"), it is stored in `correction_requests.reason` and in that row's audit record.
- The proof found exactly this: the value appeared in audit rows only through the applicant's own reason text.
- The same holds for every officer reason and remark in the system. They are never logged (Part A redaction), but they are stored and audited.
- **ACCEPTED.** Reasons must be free text. Guidance belongs in the notice text and in officer training.

### M62 - An assigned officer outside the domicile jurisdiction cannot read the applicant row (Phase 17 D)

- The applicants RLS policy follows the applicant's domicile. It never consults `applications`: the applications policy reads applicants, so a reverse reference would recurse.
- An application's jurisdiction is copied from the domicile at submission, and the domicile cannot be edited, so both scopes agree.
- The exception is `applications.assigned_officer_id`. An officer assigned to an application outside their own jurisdiction sees the application but not the applicant's row, so pages that read the applicant are empty or 404 for them.
- No flow assigns across jurisdictions today. **ACCEPTED.**

### M63 - Registration attribution; accounts and applicants are not audited (Phase 17 D)

- Registration now inserts the applicant row with the new account as the transaction's actor (RLS requires the owner).
- `accounts` and `applicants` have **no audit trigger**, and never had one: registration and profile rows are not in the audit chain.
  - Profile changes are, through `applicant_profile_changes`.
  - Corrections are, through `correction_requests` and `correction_decisions`.
- Adding an audit trigger to `applicants` would copy names and encrypted identifier blobs into every audit row. That is left for a DPO decision.
- **Open.**

### M64 - Database privilege gaps (Phase 17 F1 review; pre-existing)

- **DELETE grants.** app_user can DELETE under RLS from:
  - `decision_records`, `sanction_orders`, `disbursements`, `workflow_transitions`, `selections`, `applications`, `documents`, `deficiencies`, `grievances`, `renewals`, `scores`.
  - No code path deletes them. A delete would appear in the audit chain, but it is not prevented.
- **Tables with no RLS:**
  - `accounts`, `officers`, `roles`, `notifications`, `notice_templates`, `document_extractions`, `rule_evaluations`, `schemes`, `scheme_versions`, `workflow_transitions`, `selection_lists`, `refresh_tokens`.
- **Default privileges** grant app_user all four DML privileges on every new table.
  - `retention_runs` was writable until 20261003111000 revoked the grants.
- **Open.** The fix is revoking DELETE / TRUNCATE table by table, and RLS for the listed tables. It touches the disbursement tables, which Phase 17 was not allowed to change. See docs/SECURITY_REVIEW.md section 4.

### M65 - A write the database refuses for an AUDITOR is a 500 (Phase 17 D)

- The API refuses every AUDITOR write first, with 403 (RBAC). The database trigger is the second line.
- If it ever fires, the caller gets 500 INTERNAL_ERROR (generic body), not 403. The refusal is recorded as an `AUDITOR_READ_ONLY` denial.
- A new table without the trigger is not covered (checklist in docs/SECURITY_REVIEW.md).
- **ACCEPTED.**

### M66 - Postgres no longer logs failed statements (Phase 17 A3)

- With `log_min_messages=log` and `log_min_error_statement=panic`, an ERROR is not written to the Postgres log at all, e.g. a constraint violation or a bad cast. The application still logs the failure, redacted: code, table, and Prisma's first line.
- Debugging a database error from the Postgres log alone is no longer possible.
- **Local override:** run postgres with `-c log_min_messages=warning -c log_min_error_statement=error -c log_error_verbosity=default`, for example in a `docker-compose.override.yml`. Only against data you may log.
- **ACCEPTED.**

### M67 - Consent: what it does not do yet (Phase 17 B2)

- The gate is at submission. Withdrawing a required purpose does not stop an application already submitted.
- Withdrawing `notifications` is recorded, but e-mail and SMS delivery do not consult it.
- The Hindi notices are machine-drafted and are legal wording: they need language and legal review (docs/TRANSLATION_REVIEW.md).
- **Open.**

### M68 - Data export is JSON only (Phase 17 B3)

- No PDF of the export. PDFs can now draw Hindi (F4), so a PDF would be a small addition.
- Identifiers are masked; there is no unmasked export.
- The export is built synchronously per request (rate-limited to 5 per minute).
- **ACCEPTED.**

### M69 - Corrections: scope (Phase 17 B4)

- Only `first_name`, `last_name`, `dob` and `gender` are correctable.
- Other identity fields stay registration-only: category, domicile, identifiers.
- A request is decided once; a new request is needed after a rejection.
- An approved correction does not re-run eligibility or fraud checks on existing applications.
- **Open.**

### M70 - Erasure is recorded, not performed (Phase 17 B5)

- Nothing is deleted on request. The applicant is told what must be kept.
- Person-level erasure of an applicant with nothing decided is not built. It needs a DPO decision, because the audit log keeps row images and is never edited.
- Policy: docs/PRIVACY.md.
- **Open.**

### M71 - Retention: limits (Phase 17 C)

- **Three data classes only:** delivered or failed notifications, expired or revoked refresh tokens, abandoned drafts.
  - Documents, OCR text and decided applications are not purged: they fall under the scheme's and the law's retention, which is not yet specified.
- **A deleted draft's content stays in the audit log**, which is append-only and never pruned.
- **Notification and refresh-token deletions** are counted in `retention_runs` only; there is no per-row audit.
- **Off by default.** When enabled, it is a dry run unless configured otherwise.
- **The BullMQ schedule persists in Redis** after `RETENTION_ENABLED` is turned back off. There is then no worker, so nothing runs, but the scheduler entry stays until removed (as for the SLA sweep).
- **Open.**

### M72 - Document access log: scope (Phase 17 E)

- **What is logged:** successful views of the five document routes (list, view, crop, sanction order, sanction PDF).
  - Refusals are denials, not log rows.
  - A 404 on those routes is now recorded as a `DOCUMENT_NOT_ACCESSIBLE` denial, so probing is visible. The caller still sees only 404.
- **Not logged:** views of application details (not documents), and the applicant's own data export (only a count line in the app log).
- **Retention:** the log is not pruned by the retention job.
- **ACCEPTED.**

### M73 - Rate limits are per instance (Phase 17 F1)

- The limit counters are in memory, like the login limit: a second API instance doubles every limit.
- The limits are constants (`RATE_LIMITS`), not configuration.
- **ACCEPTED** for the single-container deployment. **Fix:** a Redis throttler store.

### M74 - Dependency findings (Phase 17 F3)

- **npm audit** at build time: 3 high (`deepmerge-ts` via the Prisma CLI config) and 4 moderate (`minio` via `query-string` / `decode-uri-component` / `stream-json`).
  - Their fixes are semver-major downgrades. Neither path receives request data.
- **pip-audit:** 0.
- **Licences:**
  - `certifi` is MPL-2.0 (weak copyleft, used unmodified).
  - `png-js` has no licence field; its LICENSE file is MIT.
- Details: docs/SECURITY_REVIEW.md section 3.
- **Open** (upgrade when patched releases exist).

### M75 - Hindi in PDFs: limits (Phase 17 F4)

- **Font weight.** Lohit Devanagari has one weight: Devanagari text in a bold position is drawn regular.
- **Scope.** Only the analytics PDFs and the sanction order use it.
- **Existing orders.** Sanction order PDFs are stored when issued. An order issued before Phase 17 with Devanagari in a name keeps its old (unreadable) rendering; the canonical content and its hash are unaffected.
- **Shaping.** pdfkit's shaping of conjuncts looked right in the proof, but has not been reviewed by a Hindi reader.
- **ACCEPTED.**

### M76 - Bulk batch id: scope (Phase 17 F4)

- **What carries the id:** only decision records.
  - Covered: verify / reject / mark defective, and issue deficiency, which writes a DEFECT decision.
  - `RESOLVE_DEFICIENCY` bulk runs write no decision record, so they are not counted.
- **Before Phase 17:** decisions from bulk actions are unmarked and count as individual.
- **ACCEPTED.**

### M77 - Pre-existing defects found during Phase 17 (not fixed here)

- `GET /authorization-denials` returns 500 for every role once a denial exists: the BigInt `seq` column (Phase 13B D1) cannot be serialised to JSON.
  **RESOLVED (branch `fix-denials-bigint`):** `seq` is returned as a decimal string, as the audit verifier returns it; verified live for SNO, MINISTRY, AUDITOR, DNO and SUPER_ADMIN (200).
- Routes with a `:version` path parameter return 500 for a value beyond int32: `ParseIntPipe` accepts it and Prisma fails.
- Both return a generic body and leak nothing.
- **Open (FIX NEXT).**
- **Phase 17.2:** `fix-denials-bigint` is merged into `phase-17-2-portal-routes` after its tests passed. Live: `GET /authorization-denials` returns 200 with rows for MINISTRY, SUPER_ADMIN, SNO, DNO and AUDITOR (`seq` a string), 403 for INO and COMMITTEE, 401 without a token. The `:version` item is unchanged.

### M78 - Leak search: by-design hits (Phase 17 A4)

- The leak search fails on saved responses that legitimately contain a person's data:
  - the applicant's own data export;
  - sanction orders, which name the scholar.
- Scan response directories without them, or read such hits as by-design, as the final Phase 17 run did (both results kept).
- **ACCEPTED.**
- **Phase 17.2 additions:**
  - `--exclude <file name>` skips a by-design file by name and prints every skipped file. The Phase 17.2 run excludes exactly `b-data-export.json` (the applicant's own data export) and the fixture sanction order, `d-sanction-order.json` / `d-sanction-order.pdf` (one order saved in two formats).
  - Older harness captures (Phase 11-13 sanction responses and one applicant's own `/auth/me`) hold the same by-design data. They are not in the routine scan set.
  - **Fixed in the script:** the analytics views were requested with a two-year window, which the API refuses (at most 366 days, 400), so the view scans had read error bodies since the script was written. Throttled calls (429) and a throttled login were also scanned as "0 hits". The script now uses one window per calendar year with submitted applications, waits out 429s and fails on any other non-2xx.

### M79 - Document file route: least privilege is in the API only (Phase 17.2 A)

- `GET /documents/:id/file` admits APPLICANT (own documents) and the reviewer roles in jurisdiction. SUPER_ADMIN, COMMITTEE and AUDITOR get 403 by role.
- **Database:** the `documents` RLS still lets a COMMITTEE member or an AUDITOR in scope read the document row (proved as `app_user`). The refusal for them is the RBAC gate, not the database. With no actor set, the row is invisible.
- **Stored type:** the allow-list (JPEG / PNG / WebP / PDF, else 415) checks the stored `mime_type`, the type recorded at upload. It does not re-sniff the bytes when serving.
- **Logging:** the access row is written in the request's transaction before the bytes are streamed. A client that aborts mid-download still has a row, and the row records an access, not a completed download.
- **ACCEPTED.**

### M80 - Application history: scope (Phase 17.2 B)

- The route reads the `application_history` view (`security_invoker`, `security_barrier`). The view exposes only from / to stage, trigger action and time, and inherits the `applications` RLS of the caller.
- The base table `workflow_transitions` still has no RLS (M64). The route never reads it directly, and `app_user` can still read it with no actor set.
- **What it reveals:** stage names and trigger actions show that, for example, an application was returned or rejected; the reasons, remarks and officer identities are not returned. Labels are keys (`history.action.*`), not text from the database.
- **ACCEPTED.**

### M81 - Objections list and selection result (Phase 17.2 C, D)

- `GET /selection-lists/:id/objections` returns objections of the list's selection run whose grievance and application are both visible to the caller under RLS. A reader outside the district sees an empty list, not 404, when the list itself is visible.
- `decided` is true for RESOLVED and REJECTED.
- **C:** the selection result now carries `list.selection_run_id`. `POST /grievances` is unchanged and still needs `application_id`, `subject_type`, `description` and `selection_run_id` for a SELECTION_OBJECTION.
- **ACCEPTED.**

### M82 - Public scheme catalogue (Phase 17.2 F)

- `GET /schemes` is public. It lists active versions only (code, name, version number, version id, effective dates) and is throttled at 60 / minute per client IP (per instance, M73).
- **Fixture schemes** are excluded by their `test_fixtures` tag. An untagged test scheme with an active version would be listed.
- **ACCEPTED.**

### M83 - PRE_MATRIC rule `pre_matric_class_tenure` cannot be evaluated (versions 1-4; found in Phase 17.2)

- **Symptom:** evaluating the rule fails with `Unexpected character "[" at position 0`.
- **Cause:** the expression `['IX', 'X'].includes(applicant.class_level) && applicant.academic_year_number <= 2` uses an array literal and a method call. The rule grammar has neither; it has `in`, `matches`, `&&`, `||`, comparisons and arithmetic.
- **Fix:** a new version (v5) through the authoring routes. Its expression would be `applicant.class_level in params.eligible_classes && applicant.academic_year_number <= params.max_academic_years`, with the two params and `class_level` as a declared input.
  - Applications already on v1-v4 stay frozen on the broken rule.
  - The rule remains PENDING_AUDIT.
- **Open** (report only in Phase 17.2; no version was published).

### M84 - Phase 17.2 test data and translations

- **Tagged rows:** three portal test applications, and the rows around them, were found untagged in the demo data. 109 rows are tagged `portal-test-2026-09-29` in `test_fixtures`:
  - account 3, applicant 3, application 3, draft 2, consent 9, document 2;
  - document access 76, notification 6, refresh token 5.
- **Test fixture:** the 415 proof used one text/html document row tagged `p17_2-fixture`. It is removed with the snapshot restore.
- **Hindi:** the 13 Hindi keys of `PORTAL_MESSAGES` are machine-drafted and unreviewed (docs/TRANSLATION_REVIEW.md).
- **ACCEPTED.**
