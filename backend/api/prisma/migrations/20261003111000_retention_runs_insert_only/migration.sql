-- Phase 17 Part C follow-up: retention_runs is written only by retention_apply()
-- (SECURITY DEFINER). 20261003110000 granted SELECT but did not revoke the
-- write privileges app_user receives by default on new tables, so app_user
-- could insert, update or delete a run record directly. Revoke them, as
-- sla_breaches does.
REVOKE ALL ON "retention_runs" FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "retention_runs" FROM app_user;
GRANT SELECT ON "retention_runs" TO app_user;
