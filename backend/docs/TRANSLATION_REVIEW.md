# Hindi notification texts - awaiting human review

**Status: MACHINE-DRAFTED, NOT VERIFIED.** Every Hindi string below was
written during development (Phase 13C / 13D) and has not been checked by a
fluent Hindi speaker. They must be reviewed before the demo, for accuracy,
plain wording and the official terms used by the Jharkhand welfare
department. Do not describe them as verified until that review is recorded
here.

## Where the Hindi texts are

| File | What | Count |
|---|---|---|
| `api/src/notifications/templates.hi.ts` - `TEMPLATES_HI` | subject and body of every notification template key | 23 keys |
| `api/src/notifications/templates.hi.ts` - `RULE_MESSAGES_HI` | eligibility rule messages (err.* / info.*) | 14 |
| `api/src/notifications/templates.hi.ts` - `QUALITY_ISSUE_MESSAGES_HI` | image-quality issues | 8 |
| `api/src/notifications/param-messages.ts` - `hi` | stage names, selection reasons and seats, grievance subjects, document names | 28 |
| `api/prisma/migrations/20260929110000_deficiency_items/migration.sql` | deficiency notice frame, item line, problems, fixes, document names (`notice_templates`, locale `hi`) | 28 rows |
| `api/prisma/migrations/20260930090000_field_boxes/migration.sql` | deficiency notice "see the marked area" line | 1 row |
| `api/src/privacy/privacy-messages.ts` - `PRIVACY_MESSAGES.hi` | Phase 17: consent notices (purpose titles and texts), the consent-required refusal, the data-export, correction and erasure messages | 9 keys |
| `api/src/notifications/templates.hi.ts` - `privacy.correction_decided` | Phase 17: correction decision notice | 1 key |
| `api/src/notifications/param-messages.ts` - `hi` `privacy.field.*`, `privacy.decision.*` | Phase 17: correctable field names and decision words | 6 |
| `api/src/common/i18n/portal-messages.ts` - `PORTAL_MESSAGES.hi` | Phase 17.2: the unsupported-file-type refusal, history action labels, objection status labels | 13 keys |

The Phase 17 consent notices are legal wording (what the applicant agrees
to under the DPDP Act): they need review by the department's legal / DPO
side as well as for language, before any real applicant sees them.

A migration is never edited: corrected `notice_templates` texts go in a new
migration (`UPDATE notice_templates SET body_template = ... WHERE code = ...
AND locale = 'hi'`), and corrected code texts are an ordinary code change.

## Terms to check first

- नोडल अधिकारी (nodal officer), कमी (deficiency), अतिदेय (overdue),
  वास्तविक छात्र प्रमाणपत्र (bona fide certificate), दिव्यांग / दिव्यांगता
  (disability), मेरिट रैंक, आरक्षण.
- Placeholders (`{application_no}` etc.) must stay exactly as they are;
  `api/src/notifications/templates.spec.ts` fails if one is missing.

## What is enforced automatically

`templates.spec.ts` fails the build if any template key, message key or
seeded `notice_templates` code lacks an English or a Hindi text, or if the
Hindi text's placeholders differ from the English. It checks presence, not
quality.

## Review log

| Date | Reviewer | Scope | Result |
|---|---|---|---|
| - | - | - | not yet reviewed |
