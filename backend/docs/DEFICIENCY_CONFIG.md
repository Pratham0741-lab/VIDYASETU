# Deficiency rules: certificate validity and deadlines

How long a certificate stays valid, and how long an applicant has to fix a
deficiency item, are configuration - never numbers in the code.

## Certificate validity (months, per canonical document type)

1. **Default for every scheme:** `DOCUMENT_VALIDITY_MONTHS` in `.env`
   (docker-compose passes it to the api). Default
   `{"INCOME_CERTIFICATE":12}`. The 12 months is an assumption awaiting
   confirmation (KNOWN_LIMITATIONS M37).
2. **Per scheme:** a scheme version's config may carry

   ```json
   "deficiency_policy": {
     "document_validity_months": { "INCOME_CERTIFICATE": 6, "CASTE_CERTIFICATE": 60 }
   }
   ```

   Laid over the default for applications on that version
   (`validityMonthsFor`, `api/src/deficiencies/deficiency-checks.ts`): a type
   listed here uses these months, `null` removes the default rule for that
   scheme, invalid values (not a whole number 1-240) are ignored.
3. **No rule, no expiry:** a document type with no rule in either place is
   never reported as expired (the validity check is NOT_APPLICABLE).

Canonical types: INCOME_CERTIFICATE, CASTE_CERTIFICATE, MARKSHEET,
FEE_RECEIPT, BANK_PASSBOOK, BONAFIDE, DISABILITY_CERT, OFFER_LETTER
(`api/src/documents/document-types.ts`). The check reads the certificate's
issue date (ml `issued_date`, mock `issue_date`).

### Setting it for a scheme

A scheme version's config cannot change once applications use it (the
`trigger_prevent_locked_scheme_version_update` trigger refuses). So:

- add `deficiency_policy` to the scheme's entry in
  `api/prisma/scheme_versions_seed_v2.json` as a **new version** (next
  `version_no`, `effective_from` in the future), and run
  `docker compose run --rm db-migrate` (the seed inserts new versions and
  updates versions no application uses yet);
- applications created on the new version get its rules; existing
  applications keep their version's rules (they do not change under them).

## Deadline to fix an item (days)

`deficiency_policy.deadline_days` in the scheme version's config, else
`DEFICIENCY_DEADLINE_DAYS` (default 15). Same rule for setting it per scheme.

## Languages

`SUPPORTED_LANGUAGES` (default `en,hi,sat`): the languages an applicant may
choose at registration or with `PATCH /api/v1/applicants/me`. English and
Hindi have notification texts; any other language falls back to English,
recorded in `notifications.requested_locale` (docs/TRANSLATION_REVIEW.md).
