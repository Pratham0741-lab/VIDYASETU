-- Phase 11.6 (Part C): documents uploaded by proof harnesses must be tagged
-- too. Widens test_fixtures' entity_type list by one value; nothing else
-- about the table (columns, grants, owner-only writes) changes.
ALTER TABLE "test_fixtures" DROP CONSTRAINT "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order',
  'disbursement', 'fraud_flag', 'officer', 'document'
));
