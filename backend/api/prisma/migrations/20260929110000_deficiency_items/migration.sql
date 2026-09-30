-- Phase 13C (Part C, plan Phase 10): the deficiency loop.
--
--   1. deficiency_items: a deficiency (the existing deficiencies row, created
--      by mark_defective) now has one or more items - document, problem and
--      fix (message keys), deadline, status, crop reference.
--   2. applicants.preferred_language: the language notices are sent in.
--   3. notice_templates gets a locale (templates per language); seeded with
--      the English and Hindi deficiency notice texts.
--   4. notifications.requested_locale: the language asked for, so a fallback
--      to English is recorded (locale <> requested_locale).
--   5. test_fixtures may tag deficiencies and their items.
-- Additive only; nothing existing is changed except relaxing two
-- constraints: notice_templates' UNIQUE(code) becomes UNIQUE(code, locale,
-- channel) (0 rows at the time), and test_fixtures' entity-type list grows.

-- ---------------------------------------------------------------------------
-- 1. deficiency_items
-- ---------------------------------------------------------------------------
CREATE TABLE "deficiency_items" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "deficiency_id"           UUID NOT NULL REFERENCES "deficiencies"("id") ON DELETE RESTRICT,
  "application_id"          UUID NOT NULL REFERENCES "applications"("id") ON DELETE RESTRICT,
  -- The checklist slot the item is about (NULL = across documents, e.g. a
  -- name that differs between documents) and its canonical document type.
  "document_slot"           TEXT,
  "document_type"           TEXT,
  -- A field the officer marked unreadable (FIELD_CONFIDENCE items only).
  "field"                   TEXT,
  -- Which check the item comes from; the recheck re-runs exactly this check.
  "check_code"              TEXT NOT NULL,
  -- CHECK: generated from a failed check. OFFICER: added by an officer.
  "source"                  TEXT NOT NULL,
  "problem_code"            TEXT NOT NULL,
  "fix_code"                TEXT NOT NULL,
  "previous_problem_code"   TEXT,
  -- Required for an officer-added item (the officer's stated reason).
  "officer_reason"          TEXT,
  "deadline_at"             TIMESTAMPTZ(6) NOT NULL,
  -- OPEN -> RESUBMITTED (a replacement was uploaded) -> RESOLVED, or back to
  -- OPEN if the recheck still fails. OVERDUE is computed when read (an OPEN
  -- or RESUBMITTED item past its deadline); nothing sweeps the table.
  "status"                  TEXT NOT NULL DEFAULT 'OPEN',
  -- Page and box of the problem on the stored document. Always NULL today:
  -- the OCR service returns no bounding boxes (Phase 13C C1).
  "crop_ref"                JSONB,
  "resubmitted_document_id" UUID REFERENCES "documents"("id") ON DELETE RESTRICT,
  -- The last recheck: which check ran, pass / fail, the codes - no values.
  "last_check"              JSONB,
  "last_checked_at"         TIMESTAMPTZ(6),
  "created_by_officer_id"   UUID NOT NULL REFERENCES "officers"("id") ON DELETE RESTRICT,
  "resolved_at"             TIMESTAMPTZ(6),
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "deficiency_items_status_check"
    CHECK ("status" IN ('OPEN', 'RESUBMITTED', 'RESOLVED', 'OVERDUE')),
  CONSTRAINT "deficiency_items_source_check" CHECK ("source" IN ('CHECK', 'OFFICER')),
  CONSTRAINT "deficiency_items_check_code_check" CHECK ("check_code" IN (
    'DOCUMENT_PRESENT', 'QUALITY_GATE', 'DOCUMENT_VALIDITY', 'NAME_CONSISTENCY',
    'DOB_CONSISTENCY', 'FIELD_CONFIDENCE', 'OFFICER')),
  CONSTRAINT "deficiency_items_codes_check" CHECK (
    "problem_code" ~ '^deficiency\.problem\.[a-z_]+$'
    AND "fix_code" ~ '^deficiency\.fix\.[a-z_]+$'
    AND ("previous_problem_code" IS NULL OR "previous_problem_code" ~ '^deficiency\.problem\.[a-z_]+$')),
  CONSTRAINT "deficiency_items_officer_reason_check" CHECK (
    "source" <> 'OFFICER' OR length(btrim(coalesce("officer_reason", ''))) >= 10),
  CONSTRAINT "deficiency_items_field_check" CHECK (
    ("check_code" = 'FIELD_CONFIDENCE') = ("field" IS NOT NULL)),
  CONSTRAINT "deficiency_items_resolved_check" CHECK (
    ("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL))
);
CREATE INDEX "deficiency_items_deficiency_idx" ON "deficiency_items" ("deficiency_id");
CREATE INDEX "deficiency_items_application_status_idx" ON "deficiency_items" ("application_id", "status");

-- Row-level security: the same rule as deficiencies (officers by
-- jurisdiction or assignment; the applicant who owns the application).
ALTER TABLE "deficiency_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "officer_jurisdiction_deficiency_items_policy" ON "deficiency_items"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "officers" o
          ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       WHERE app.id = "deficiency_items".application_id
         AND (o.jurisdiction_state IS NULL
              OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
              OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
              OR app.assigned_officer_id = o.id))
    OR EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
       WHERE app.id = "deficiency_items".application_id AND app.applicant_id = a.id)
  );
REVOKE ALL ON "deficiency_items" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "deficiency_items" TO app_user;

-- Every change is audited in the chain (the existing audit trigger function).
CREATE TRIGGER "trigger_audit_deficiency_items"
  AFTER INSERT OR UPDATE OR DELETE ON "deficiency_items"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- ---------------------------------------------------------------------------
-- 2. The applicant's language (ISO 639 code; 'en' for everyone so far).
-- ---------------------------------------------------------------------------
ALTER TABLE "applicants"
  ADD COLUMN "preferred_language" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "applicants_preferred_language_check" CHECK ("preferred_language" ~ '^[a-z]{2,3}$');

-- ---------------------------------------------------------------------------
-- 3. Notice templates per language, and the deficiency notice texts.
-- ---------------------------------------------------------------------------
ALTER TABLE "notice_templates" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "notice_templates" DROP CONSTRAINT IF EXISTS "notice_templates_code_key";
DROP INDEX IF EXISTS "notice_templates_code_key";
CREATE UNIQUE INDEX "notice_templates_code_locale_channel_key"
  ON "notice_templates" ("code", "locale", "channel");

-- Placeholders are {name}. Message-key rows (deficiency.*, document.*) hold
-- one sentence or name in body_template.
INSERT INTO "notice_templates" ("id", "code", "title", "channel", "locale", "subject_template", "body_template", "variables", "updated_at") VALUES
  (gen_random_uuid(), 'DEFICIENCY_NOTICE', 'Deficiency notice', 'PORTAL', 'en',
   'Application {application_no}: {item_count} item(s) to correct by {deadline}',
   E'Your application {application_no} needs corrections before it can continue.\nPlease fix each item below and resubmit only the documents named:\n\n{items}\n\nAfter uploading, resubmit from your application page. Items not corrected by their deadline are overdue.',
   '["application_no", "item_count", "deadline", "items"]', now()),
  (gen_random_uuid(), 'DEFICIENCY_NOTICE', 'कमी की सूचना', 'PORTAL', 'hi',
   'आवेदन {application_no}: {deadline} तक {item_count} बिंदु सुधारें',
   E'आपके आवेदन {application_no} में आगे बढ़ने से पहले सुधार आवश्यक हैं।\nकृपया नीचे दिए गए प्रत्येक बिंदु को ठीक करें और केवल बताए गए दस्तावेज़ दोबारा जमा करें:\n\n{items}\n\nअपलोड करने के बाद अपने आवेदन पृष्ठ से दोबारा जमा करें। समय-सीमा तक न सुधारे गए बिंदु अतिदेय माने जाएँगे।',
   '["application_no", "item_count", "deadline", "items"]', now()),
  (gen_random_uuid(), 'DEFICIENCY_NOTICE_ITEM', 'Deficiency notice item', 'PORTAL', 'en', NULL,
   '{n}. {document}: {problem} {fix} (by {deadline})', '["n", "document", "problem", "fix", "deadline"]', now()),
  (gen_random_uuid(), 'DEFICIENCY_NOTICE_ITEM', 'कमी की सूचना - बिंदु', 'PORTAL', 'hi', NULL,
   '{n}. {document}: {problem} {fix} ({deadline} तक)', '["n", "document", "problem", "fix", "deadline"]', now()),

  (gen_random_uuid(), 'deficiency.problem.document_missing', 'problem', 'PORTAL', 'en', NULL, 'This document has not been uploaded.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.document_missing', 'problem', 'PORTAL', 'hi', NULL, 'यह दस्तावेज़ अपलोड नहीं किया गया है।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.image_unreadable', 'problem', 'PORTAL', 'en', NULL, 'The scan cannot be read (blurred, too dark, cut off or too small).', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.image_unreadable', 'problem', 'PORTAL', 'hi', NULL, 'स्कैन पढ़ा नहीं जा सकता (धुंधला, बहुत गहरा, कटा हुआ या बहुत छोटा)।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.document_expired', 'problem', 'PORTAL', 'en', NULL, 'The certificate is older than the scheme allows.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.document_expired', 'problem', 'PORTAL', 'hi', NULL, 'प्रमाणपत्र योजना द्वारा अनुमत अवधि से पुराना है।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.issue_date_unreadable', 'problem', 'PORTAL', 'en', NULL, 'The date of issue cannot be read on the certificate.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.issue_date_unreadable', 'problem', 'PORTAL', 'hi', NULL, 'प्रमाणपत्र पर जारी करने की तारीख पढ़ी नहीं जा सकती।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.name_mismatch', 'problem', 'PORTAL', 'en', NULL, 'Your name is not the same on all documents.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.name_mismatch', 'problem', 'PORTAL', 'hi', NULL, 'सभी दस्तावेज़ों पर आपका नाम एक जैसा नहीं है।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.dob_mismatch', 'problem', 'PORTAL', 'en', NULL, 'Your date of birth is not the same on all documents.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.dob_mismatch', 'problem', 'PORTAL', 'hi', NULL, 'सभी दस्तावेज़ों पर आपकी जन्म तिथि एक जैसी नहीं है।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.field_unreadable', 'problem', 'PORTAL', 'en', NULL, 'A required detail on this document cannot be read reliably.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.field_unreadable', 'problem', 'PORTAL', 'hi', NULL, 'इस दस्तावेज़ पर एक आवश्यक विवरण ठीक से पढ़ा नहीं जा सकता।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.wrong_document', 'problem', 'PORTAL', 'en', NULL, 'The uploaded file is not the document asked for.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.wrong_document', 'problem', 'PORTAL', 'hi', NULL, 'अपलोड की गई फ़ाइल माँगा गया दस्तावेज़ नहीं है।', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.not_attested', 'problem', 'PORTAL', 'en', NULL, 'The document is not signed or stamped by the issuing authority.', NULL, now()),
  (gen_random_uuid(), 'deficiency.problem.not_attested', 'problem', 'PORTAL', 'hi', NULL, 'दस्तावेज़ पर जारी करने वाले अधिकारी के हस्ताक्षर या मुहर नहीं है।', NULL, now()),

  (gen_random_uuid(), 'deficiency.fix.upload_document', 'fix', 'PORTAL', 'en', NULL, 'Upload this document.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.upload_document', 'fix', 'PORTAL', 'hi', NULL, 'यह दस्तावेज़ अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.rescan_clearly', 'fix', 'PORTAL', 'en', NULL, 'Scan or photograph the whole page again in good light and upload it.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.rescan_clearly', 'fix', 'PORTAL', 'hi', NULL, 'पूरे पृष्ठ को अच्छी रोशनी में फिर से स्कैन या फ़ोटो करके अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.upload_current_certificate', 'fix', 'PORTAL', 'en', NULL, 'Obtain a current certificate from the issuing office and upload it.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.upload_current_certificate', 'fix', 'PORTAL', 'hi', NULL, 'जारी करने वाले कार्यालय से नया प्रमाणपत्र लेकर अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.show_issue_date', 'fix', 'PORTAL', 'en', NULL, 'Upload a scan in which the date of issue is clearly visible.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.show_issue_date', 'fix', 'PORTAL', 'hi', NULL, 'ऐसा स्कैन अपलोड करें जिसमें जारी करने की तारीख साफ़ दिखे।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.same_name_everywhere', 'fix', 'PORTAL', 'en', NULL, 'Upload documents that show your name exactly as on your application, or a correction certificate.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.same_name_everywhere', 'fix', 'PORTAL', 'hi', NULL, 'ऐसे दस्तावेज़ अपलोड करें जिन पर आपका नाम आवेदन के अनुसार ही हो, या सुधार प्रमाणपत्र अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.same_dob_everywhere', 'fix', 'PORTAL', 'en', NULL, 'Upload documents that show the same date of birth, or a correction certificate.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.same_dob_everywhere', 'fix', 'PORTAL', 'hi', NULL, 'एक जैसी जन्म तिथि वाले दस्तावेज़ या सुधार प्रमाणपत्र अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.upload_correct_document', 'fix', 'PORTAL', 'en', NULL, 'Upload the document that was asked for.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.upload_correct_document', 'fix', 'PORTAL', 'hi', NULL, 'माँगा गया दस्तावेज़ ही अपलोड करें।', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.get_attested', 'fix', 'PORTAL', 'en', NULL, 'Have the document signed and stamped by the issuing authority and upload it again.', NULL, now()),
  (gen_random_uuid(), 'deficiency.fix.get_attested', 'fix', 'PORTAL', 'hi', NULL, 'दस्तावेज़ पर जारी करने वाले अधिकारी के हस्ताक्षर और मुहर लगवाकर फिर से अपलोड करें।', NULL, now()),

  (gen_random_uuid(), 'document.INCOME_CERTIFICATE', 'document name', 'PORTAL', 'en', NULL, 'Income certificate', NULL, now()),
  (gen_random_uuid(), 'document.INCOME_CERTIFICATE', 'document name', 'PORTAL', 'hi', NULL, 'आय प्रमाणपत्र', NULL, now()),
  (gen_random_uuid(), 'document.CASTE_CERTIFICATE', 'document name', 'PORTAL', 'en', NULL, 'Caste / tribe certificate', NULL, now()),
  (gen_random_uuid(), 'document.CASTE_CERTIFICATE', 'document name', 'PORTAL', 'hi', NULL, 'जाति / जनजाति प्रमाणपत्र', NULL, now()),
  (gen_random_uuid(), 'document.MARKSHEET', 'document name', 'PORTAL', 'en', NULL, 'Marksheet', NULL, now()),
  (gen_random_uuid(), 'document.MARKSHEET', 'document name', 'PORTAL', 'hi', NULL, 'अंकपत्र', NULL, now()),
  (gen_random_uuid(), 'document.FEE_RECEIPT', 'document name', 'PORTAL', 'en', NULL, 'Fee receipt', NULL, now()),
  (gen_random_uuid(), 'document.FEE_RECEIPT', 'document name', 'PORTAL', 'hi', NULL, 'शुल्क रसीद', NULL, now()),
  (gen_random_uuid(), 'document.BANK_PASSBOOK', 'document name', 'PORTAL', 'en', NULL, 'Bank passbook', NULL, now()),
  (gen_random_uuid(), 'document.BANK_PASSBOOK', 'document name', 'PORTAL', 'hi', NULL, 'बैंक पासबुक', NULL, now()),
  (gen_random_uuid(), 'document.BONAFIDE', 'document name', 'PORTAL', 'en', NULL, 'Bona fide certificate', NULL, now()),
  (gen_random_uuid(), 'document.BONAFIDE', 'document name', 'PORTAL', 'hi', NULL, 'वास्तविक छात्र प्रमाणपत्र', NULL, now()),
  (gen_random_uuid(), 'document.DISABILITY_CERT', 'document name', 'PORTAL', 'en', NULL, 'Disability certificate', NULL, now()),
  (gen_random_uuid(), 'document.DISABILITY_CERT', 'document name', 'PORTAL', 'hi', NULL, 'दिव्यांगता प्रमाणपत्र', NULL, now()),
  (gen_random_uuid(), 'document.OFFER_LETTER', 'document name', 'PORTAL', 'en', NULL, 'Offer of admission', NULL, now()),
  (gen_random_uuid(), 'document.OFFER_LETTER', 'document name', 'PORTAL', 'hi', NULL, 'प्रवेश प्रस्ताव पत्र', NULL, now()),
  (gen_random_uuid(), 'document.ALL', 'document name', 'PORTAL', 'en', NULL, 'All documents', NULL, now()),
  (gen_random_uuid(), 'document.ALL', 'document name', 'PORTAL', 'hi', NULL, 'सभी दस्तावेज़', NULL, now());

-- ---------------------------------------------------------------------------
-- 4. The language a notification was asked for (NULL before Phase 13C).
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications" ADD COLUMN "requested_locale" TEXT;

-- ---------------------------------------------------------------------------
-- 5. test_fixtures: deficiencies and their items can be tagged.
-- ---------------------------------------------------------------------------
ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item'));
