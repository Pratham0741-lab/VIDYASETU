-- Phase 13D (Part A, KNOWN_LIMITATIONS M38): where each extracted field was
-- read on the page.
--
--   document_extractions.field_boxes: per field, {page, x, y, width, height,
--     coordinate_space} in the stored image's own pixel grid, or null when the
--     ml service could not tie the value to exactly one place. NULL for rows
--     written before Phase 13D, for the mock engine and for DigiLocker.
--   deficiency_items.crop_ref (Phase 13C, always NULL until now) is filled
--     from these boxes: {document_id, field, page, x, y, width, height,
--     coordinate_space}.
--   The deficiency notice links to the crop (never embeds it): one more
--     notice line template, English and Hindi.
-- Additive only; existing rows stay NULL.

ALTER TABLE "document_extractions" ADD COLUMN "field_boxes" JSONB;

INSERT INTO "notice_templates" ("id", "code", "title", "channel", "locale", "subject_template", "body_template", "variables", "updated_at") VALUES
  (gen_random_uuid(), 'DEFICIENCY_NOTICE_CROP', 'Deficiency notice - marked area link', 'PORTAL', 'en', NULL,
   '   See the marked area: {crop_url}', '["crop_url"]', now()),
  (gen_random_uuid(), 'DEFICIENCY_NOTICE_CROP', 'कमी की सूचना - चिह्नित भाग का लिंक', 'PORTAL', 'hi', NULL,
   '   चिह्नित भाग देखें: {crop_url}', '["crop_url"]', now());
