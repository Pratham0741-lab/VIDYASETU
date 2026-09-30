-- Phase 13C: deficiency items are never deleted by the api.
--
-- Migration 20260929110000 granted app_user SELECT, INSERT, UPDATE only, but
-- the database's default privileges (ALTER DEFAULT PRIVILEGES ... TO
-- app_user) had already given it DELETE when the table was created, and
-- REVOKE ... FROM PUBLIC does not remove a grant made to app_user itself.
-- Items are resolved, never removed; the audit chain keeps every change.
REVOKE DELETE, TRUNCATE ON "deficiency_items" FROM app_user;
