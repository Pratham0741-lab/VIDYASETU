# Backend requests from the student portal

The frontend does not change the backend. Each item below is a change the
portal needs, why, and the fallback the portal uses until it exists.

## R1. Document response bodies in OpenAPI

**Status: partly resolved (F1-B, 2026-09-30).** 8 of 148 operations now have a 2xx response schema. The portal generates its types for `GET /auth/me`, `GET /schemes`, `GET /applications/{id}/history` and `GET /applications/{id}/selection-result`. Every other response the portal reads (profile, consents, applications, drafts, documents, deficiencies, notifications, eligibility, form schema, grievances) is still undocumented and stays hand-kept in `src/api/responses.ts`.

- **Route:** all routes (`@ApiOkResponse` / `@ApiCreatedResponse` with DTO classes).
- **Reason:** `openapi.json` has no response schemas (every 2xx is
  `{"description": ""}`). The frontend must generate its API types from the
  OpenAPI file, but can only do so for request bodies.
- **Suggested behaviour:** add response DTOs for at least the routes in
  `src/api/endpoints.ts`.
- **Fallback:** `src/api/responses.ts` holds narrow, hand-kept response
  view types, clearly marked "not in OpenAPI".

## R2. Public list of active schemes

**Status: resolved (F1-B).** `GET /schemes` is used for the landing list and the scheme picker; the empty-profile workaround is removed. See R9 for a remaining inconsistency.

- **Route:** `GET /api/v1/schemes` (public, throttled), returning
  `{scheme_code, scheme_name, version_no, scheme_version_id, effective_from, effective_to}` for active versions.
- **Reason:** the landing page and the application form need the list of
  schemes an applicant can apply to. Only `/admin/schemes` lists them, and
  it needs an authoring role.
- **Fallback:** the portal calls `POST /schemes/check-eligibility` with an
  empty profile and uses the evaluated scheme versions as the list.

## R3. Stage history for the applicant

**Status: resolved (F1-B).** The dashboard timeline is built from `GET /applications/{id}/history`, with a date on every past stage.

- **Route:** `GET /api/v1/applications/{id}/history` (APPLICANT: own
  application; reviewers: in scope), returning the workflow transitions
  `{from_stage, to_stage, trigger_action, at}` without officer identities
  or internal remarks.
- **Reason:** the dashboard timeline should show when each stage was
  reached. Today only `submitted_at`, `stage_entered_at` and
  `stage_due_at` of the current stage are visible to the applicant.
- **Fallback:** the timeline shows the workflow's stage order with the
  current stage marked, the submission date, the date the current stage
  was entered and its due date. Past stages show no date.

## R4. Selection run id in the selection result

**Status: resolved (F1-B).** The objection uses `list.selection_run_id`; the notification-text pre-fill remains only as a fallback when it is null.

- **Route:** `GET /api/v1/applications/{id}/selection-result`: add
  `list.selection_run_id` (or accept `selection_list_id` in
  `POST /grievances` for `SELECTION_OBJECTION`).
- **Reason:** an objection needs `selection_run_id`, which the applicant
  can only find in the text of the non-selection notification.
- **Fallback:** the objection form takes the reference from that
  notification (pre-filled when the portal finds it in the notification
  text) and lets the applicant paste it.

## R5. Localised scheme texts

- **Route:** check-eligibility, form-schema.
- **Reason:** scheme names, rule explanations and document checklist
  labels are English only; the Hindi UI shows them in English.
- **Suggested behaviour:** message keys or `{en, hi}` pairs in the scheme
  configuration, served in the requested language.
- **Fallback:** shown in English (docs/TRANSLATION_NOTES.md).

## R6. PRE_MATRIC rule `pre_matric_class_tenure` cannot be evaluated

- **Route:** `POST /schemes/check-eligibility`.
- **Reason:** for an empty profile the rule returns ERROR
  `Unexpected character "[" at position 0`, which looks like a rule
  expression problem rather than a missing input.
- **Fallback:** none needed in the portal: the scheme's outcome is
  INDETERMINATE, which the landing checker shows as "Needs details".

## R7. Message keys for every error

- **Route:** all error responses.
- **Reason:** `message` is English text from one catalogue (marked
  "TODO(i18n)"), and even the 409 `consent_required` message is rendered
  in English regardless of `preferred_language`. Only a few errors carry
  `details.message_key` or a `details.reason`.
- **Suggested behaviour:** a stable `details.reason` or `message_key` on
  every 4xx the applicant can meet.
- **Fallback:** the portal maps `code`, `details.reason` and
  `details.message_key` to its own en/hi text and shows the raw message
  only for unknown ones.

## R8. Two response fields declared as `type: object`

- **Route:** `GET /applications/{id}/history` (`HistoryEntryDto.from_stage`)
  and `GET /applications/{id}/selection-result`
  (`SelectionResultListDto.window_closes_at`).
- **Reason:** both are declared `{"type": "object", "nullable": true}`, so
  the generated TypeScript type is `Record<string, never> | null`. The live
  values are a stage string (or null) and an ISO date-time string (or null).
- **Suggested behaviour:** `type: string` (with `format: date-time` for
  `window_closes_at`), e.g. `@ApiProperty({ type: String, nullable: true })`.
- **Fallback:** `src/api/responses.ts` narrows exactly these two fields on
  top of the generated types.

## R9. check-eligibility evaluates schemes that GET /schemes does not list

- **Route:** `POST /schemes/check-eligibility` vs `GET /schemes`.
- **Reason:** `GET /schemes` lists 5 active versions; check-eligibility
  evaluates 7, including the synthetic test schemes FOREST_SCIENCE_P16 and
  WQ_ORACLE_P16 (both "eligible" for category ST). A visitor is told they
  match schemes that the published list does not contain.
- **Suggested behaviour:** evaluate the same set of versions that
  `GET /schemes` lists (or tag test fixtures out of both).
- **Fallback:** the portal hides nothing; such schemes get their own row
  after a check, marked "Evaluated by the check, not in the published scheme
  list".

## Validate the bank_account format on registration (2026-10-01)

The student form now collects IFSC and account number separately and sends
`bank_account` as `IFSC:account` (the format of the seeded applicants and of
`fraud-match.ts`). `RegisterDto.bank_account` only checks `@Length(1, 64)`.
Request: validate `^[A-Z]{4}0[A-Z0-9]{6}:\d{9,18}$` server-side (400 with a
message key, e.g. `api.bank_account.invalid`). No data change or migration:
existing values already use this format.

## Classify an uploaded file without naming its slot (2026-10-01)

The student portal now takes several files at once and places each in the
matching checklist row. POST /applications/:id/documents requires
`document_type`, so the portal guesses the row from the file name (else the
first waiting row), then moves the file when the scan reports `wrong_type`
with a `detected` type, mirroring SLOT_DOCUMENT_TYPE by keyword in the
client. A wrong first guess leaves that file in the guessed row (shown as
needs attention) until another file replaces it, because a document cannot
be removed. Request: either make `document_type` optional (the backend
classifies and picks the row), or add POST /applications/:id/documents/classify
returning the canonical type and target slot, plus the slot -> type map in
GET /applications/:id/documents.

Update (same day): withdrawn. The portal is back to one upload per row.

## Duplicate checklist slots (2026-10-01)

Scheme checklists list the same document twice: a worded slot (e.g.
"Family Income Certificate") and a generic key (`income_certificate`,
`caste_certificate`, `marksheet`, `bonafide_certificate`,
`admission_offer_letter`). Both are required for readiness. The student
portal now hides the generic row when a worded row of the same document
type exists, and files the applicant's one upload under both slots.
Request: derive the checklist without the generic duplicates (or mark them
as aliases) so one document satisfies both.

## Let applicants remove an uploaded document (2026-10-01)

The student portal should offer "Remove" on an uploaded document row. The
API has no delete route (checked docs/openapi.json and the live
/docs/openapi.json). Request: DELETE /api/v1/documents/{id} for the owning
applicant while the application is in DRAFT/SUBMITTED (documents not yet
scanned into a decision) or DEFECTIVE for slots named in an open
deficiency; 409 otherwise. Soft delete (keep the audit trail and file for
officers), return the updated slot view, and recompute readiness. For the
duplicate generic slots (see "Duplicate checklist slots"), removing the
worded row's document should also clear its generic twin, or the portal
will call it for both.
