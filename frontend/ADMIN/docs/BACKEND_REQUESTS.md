# Backend requests (from the officer portal)

The frontend does not edit the backend. Each request lists the route, the
roles, why the portal needs it and the suggested behaviour, plus the
fallback the portal uses meanwhile.

## R1. Response schemas in OpenAPI

- **Routes:** every route used by the portal.
- **Why:** the OpenAPI file documents no 2xx body, so response types cannot
  be generated (`src/api/responses.ts` is hand-written from the source).
- **Suggested:** `@ApiOkResponse({ type })` DTOs for the views.
- **Fallback:** narrow view types marked "NOT IN OPENAPI".

## R2. The signed-in officer's name (RESOLVED, wired in F2-B)

- **Route:** `GET /auth/me` (or a new `GET /officers/me`), all officer roles.
- **Why:** the sidebar officer card should show who is signed in. The Actor
  has only ids, role and jurisdiction, although `officers.name` exists in
  the schema.
- **Suggested:** add `name` (and `institution_code`) for officer actors.
- **Fallback:** role label and jurisdiction only.

## R3. Serve the original uploaded document to officers (RESOLVED, wired in F2-B)

- **Route:** `GET /documents/:id/file` (new).
- **Roles:** APPLICANT (own) and REVIEWER_ROLES in jurisdiction (RLS), like
  `GET /documents/:id`.
- **Why:** scrutiny compares extracted values with the scan. Today no route
  returns the stored bytes, only the JSON view and deficiency crops.
- **Suggested:** stream the stored object with its `mime_type`,
  `Content-Disposition: inline` and `Cache-Control: no-store`, logged by
  `@LogDocumentAccess('VIEW', 'document_file')`.
- **Fallback:** the viewer shows the extracted fields only, with the note
  "original scan viewer not available".

## R4. Return the routing reasons of a document

- **Routes:** `GET /documents/:id`, `GET /applications/:id/documents`.
- **Why:** `routeByConfidence()` computes `reasons[]`, but they are neither
  stored nor returned. Officers need to see why a document was routed to them.
- **Suggested:** store the reasons on the extraction and return
  `extraction.review_reasons[]` (as message keys).
- **Fallback:** the portal recomputes the reasons from `fields[].confidence`,
  `review_threshold` and `classification` with the same rule.

## R5. List selection objections for the committee (RESOLVED, wired in F2-B)

- **Route:** `GET /selection-lists/:id/objections` (new), COMMITTEE plus the
  list readers.
- **Why:** the committee decides objections by grievance id but may not call
  `GET /grievances` (APPLICANT + reviewer roles only), so it cannot find the
  pending ones.
- **Suggested:** return the run's SELECTION_OBJECTION grievances (id,
  application_no, status, created_at, decided) in the caller's scope.
- **Fallback:** reviewer roles see the list from `GET /grievances`; the
  committee enters a grievance id.

## R6. Applicant name in officer case views (for discussion)

- **Routes:** `GET /applications/queue`, `GET /applications/:id`.
- **Why:** the design identifies cases by applicant name; the API returns
  only ids and the application number (privacy by default).
- **Suggested:** decide deliberately. If added, return a display name to
  in-jurisdiction reviewers only and log the access.
- **Fallback:** application number only.

## R7. BigInt `seq` in `GET /authorization-denials` (RESOLVED: fixed in the backend)

- **Live pass 2026-09-29:** the backend now serialises `seq` as a decimal
  string (backend commit "Fix 500 on GET /authorization-denials: serialise
  the BigInt seq as a string"); the route answers 200 for SNO and AUDITOR.

- **Route:** `GET /authorization-denials`.
- **Why:** rows carry `seq` (a Prisma BigInt). No BigInt JSON handling was
  found, so chained rows may make the route answer 500.
- **Suggested:** map `seq` to a string in the service, as the audit
  verifier does.
- **Fallback:** the portal shows the error with its request id.

## R8. Fraud-held applications across all stages

- **Route:** `GET /applications/queue?fraud=HIGH` (or a new
  `GET /fraud/held`), reviewer roles and AUDITOR.
- **Why:** the queue lists only the stages the caller acts on, so a state
  officer sees none of the applications held at the institute stage, while
  `/analytics/fraud` counts them (live pass M16).
- **Suggested:** an option such as `all_stages=true`, or a held-list route
  returning `{id, application_no, current_stage, held, flags[{id,
  flag_type, severity, status}]}` in the caller's jurisdiction.
- **Fallback:** the fraud screen scans `GET /applications` (at most 100)
  and calls `GET /applications/:id/fraud-flags` for each (6 at a time).
- **Live result:** `GET /applications` returns only the newest 100 rows (no
  paging) and includes test-fixture applications, so the scan found 8 held
  test applications and none of the 4 demo held applications that
  `/analytics/fraud` counts. The screen now says so when the cap is hit.
  This request is needed to list the demo holds.

## Status update (Stage F3-A, 2026-09-30)

The refreshed OpenAPI file lists `GET /documents/{id}/file` (answers R3),
`GET /selection-lists/{id}/objections` (answers R5),
`GET /applications/{id}/history` and a public `GET /schemes`. The portal does
not use the first three yet (a later stage); R3 and R5 stay open on the
portal side until they are wired.

## R9. Delete (or hide) test schemes and unpublished drafts

- **Routes:** `DELETE /admin/schemes/:code` (a scheme without published
  versions) and `DELETE /admin/schemes/:code/versions/:v` (a draft), author
  roles.
- **Why:** every demo or test run leaves schemes and drafts behind
  (`CLOSER_TEST_*`, `STUDIO_UI_*`); they appear in the Studio list forever.
- **Suggested:** allow deleting a draft and a scheme that never had an
  active version, audited; or a `test_fixtures` tag the Studio list can
  filter, as the public list already does.
- **Fallback:** test codes are clearly named (synthetic) and retired.

## R10. Edit scheme details after creation

- **Route:** `PATCH /admin/schemes/:code` (name, department, description,
  portal_url), author roles.
- **Why:** the Studio shows the scheme name and department but cannot fix a
  typo in them; only versions can be edited.
- **Fallback:** name and code are read-only in the editor.

## R11. Public scheme list vs. eligibility check

- **Routes:** `GET /schemes` and `POST /schemes/check-eligibility` (public).
- **Why:** `GET /schemes` excludes schemes tagged in `test_fixtures`
  (5-6 active versions live), while `check-eligibility` evaluates every
  active version (7-8 live, including the synthetic P16 schemes). The
  student landing page and apply form can therefore disagree.
- **Suggested:** apply the same fixture filter to `check-eligibility`, or
  document the difference.

## Status update (F2-B, 2026-09-30)

Resolved and wired in the portal:
- **R2:** `GET /auth/me` returns `name` and `institution_code` for officers
  (`MeDto`); the sidebar officer card shows them, with role and jurisdiction.
- **R3:** `GET /documents/:id/file` (reviewer roles in jurisdiction;
  `Cache-Control: no-store`, `nosniff`, `sandbox`); the Scrutiny scan
  viewer shows it (images with zoom, PDFs in a sandboxed iframe).
- **R5:** `GET /selection-lists/:id/objections` (list readers; ids, status,
  dates); the committee selects an objection to decide it. The grievance-id
  field remains only as a fallback when the route answers 404.
- **R7:** fixed in the backend (see above).

Also wired: `GET /applications/:id/history` (Scrutiny stage timeline).
Still open: R1 (most responses undocumented), R4, R6, R8, R9, R10, R11.

## R12. Nullable strings without a type in the OpenAPI file

- **Where:** `HistoryEntryDto.from_stage`, `SelectionResultListDto.window_closes_at`.
- **Why:** they are declared `nullable` without a type, so `openapi-typescript`
  generates `Record<string, never> | null` instead of `string | null`.
- **Suggested:** `@ApiProperty({ type: String, nullable: true })` with the
  type emitted in the schema (or `oneOf: [{type: string}, {type: 'null'}]`).
- **Fallback:** `src/api/responses.ts` overrides `from_stage` as
  `string | null`.
