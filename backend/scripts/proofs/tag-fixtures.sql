-- Usage (database owner): docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/proofs/tag-fixtures.sql
-- Phase 11.5 B5: register every row created by the .p11 proof harness as a
-- test fixture. Run as the database owner (test_fixtures is read-only to
-- app_user). Idempotent. Labels:
--   p11-harness        accounts / officers / applicants / flags made by the harness
--   p11-scenario       Phase 11 detector scenario applications (B1..G2 etc.)
--   p11-surge-fixture  institution-surge fixture (U-SURGE-01 / U-NORMAL-02);
--                      baseline rows have a backdated submitted_at
--   p11.5-fixture      Phase 11.5 A2 / B2 fixtures (selections, sanction
--                      orders, disbursements included)
--   p11.6-fixture      Phase 11.6 M11 proof applicants (m11*) and their documents
--   p12-fixture        Phase 12 Part A proof applicants (p12*)
--   dev-seed           development-only users (*.dev@example.org, Phase 13B)
--   p13c-fixture       Phase 13C deficiency-loop applicants (h1/h2/e1/s1/ba1-3/b13c) and
--                      the deficiencies / deficiency items raised on harness applications
--   p13d-fixture       Phase 13D applicants (cr1-3, rs1-3, lg1-2) and applicant profile changes
--   p13e-fixture       Phase 13E applicants (pd1-2, sl1-6, sm1-4, fa01-16 fairness oracle, zz.nfsttry)
--                      and the selection lists / entries / committee decisions of their runs
--   p14-fixture        Phase 14 loose-ends applicants (ta1 scheme authoring, sw1-6 SLA sweep,
--                      dr1-2 drafts, rn1 renewal, aa1-2 Aadhaar), the API-authored scheme
--                      TRIBAL_ARTS_P14 and its versions, SLA breaches, application drafts,
--                      Aadhaar authentications and renewals on harness applications
--   p16-fixture        Phase 16 applicants (w01-w12 workload / verification oracle, fs1-fs6 declared
--                      selection basis), the API-authored schemes WQ_ORACLE_P16 and FOREST_SCIENCE_P16
--                      and their versions, officer language preferences of harness officers
--   p17-fixture        Phase 17 applicants (pv1-pv5 privacy / RLS / retention, bk1-bk6 bulk batch),
--                      consent records, correction requests / decisions, erasure requests,
--                      document access log rows, retention runs, and the retention fixtures
--                      (notifications, refresh tokens)
--   p11-harness        (also) every other notification and refresh token of a harness or
--                      development account (taggable since Phase 17)
BEGIN;
CREATE TEMP TABLE fx_accounts ON COMMIT DROP AS
  SELECT id FROM accounts WHERE email LIKE '%.p11@example.org';
CREATE TEMP TABLE fx_apps ON COMMIT DROP AS
  SELECT a.id, a.institution_code, a.submitted_at < a.created_at - interval '1 hour' AS backdated,
         acc.email
    FROM applications a
    JOIN applicants p ON p.id = a.applicant_id
    JOIN accounts acc ON acc.id = p.user_id
   WHERE acc.id IN (SELECT id FROM fx_accounts);

INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'account', id, 'p11-harness', 'created by .p11 proof scripts' FROM fx_accounts
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'officer', o.id, 'p11-harness', 'officer profile of a harness account'
  FROM officers o WHERE o.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'applicant', p.id, 'p11-harness', 'applicant profile of a harness account'
  FROM applicants p WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'application', id,
       CASE WHEN institution_code IN ('U-SURGE-01', 'U-NORMAL-02') THEN 'p11-surge-fixture'
            WHEN email ~ '^p12[a-z0-9]*[.]' THEN 'p12-fixture'
            WHEN email ~ '^m11[a-z]+[.]' THEN 'p11.6-fixture'
            WHEN email ~ '^(a2|b2)[a-z0-9]+[.]' THEN 'p11.5-fixture'
            WHEN email ~ '^(h1|h2|e1|s1|ba1|ba2|ba3|b13c)[.]' THEN 'p13c-fixture'
            WHEN email ~ '^(cr[0-9]|rs[0-9]|lg[0-9])[.]' THEN 'p13d-fixture'
            WHEN email ~ '^(pd[0-9]|sl[0-9]|sm[0-9]|fa[0-9]+|zz)[.]' THEN 'p13e-fixture'
            WHEN email ~ '^(ta[0-9]|sw[0-9]|dr[0-9]|rn[0-9]|aa[0-9])[.]' THEN 'p14-fixture'
            WHEN email ~ '^(w[0-9]{2}[.]oracle|fs[0-9])[.]' THEN 'p16-fixture'
            WHEN email ~ '^(pv[0-9]|bk[0-9])[.]' THEN 'p17-fixture'
            ELSE 'p11-scenario' END,
       CASE WHEN backdated THEN 'submitted_at backdated by the surge fixture (baseline history)' END
  FROM fx_apps
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'selection', s.id, 'p11.5-fixture', 'selection of a harness application'
  FROM selections s WHERE s.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'sanction_order', so.id, 'p11.5-fixture', 'sanction order of a harness application'
  FROM sanction_orders so WHERE so.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'disbursement', d.id, 'p11.5-fixture', 'disbursement of a harness application (mock PFMS only)'
  FROM disbursements d WHERE d.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'document', d.id,
       CASE WHEN x.email ~ '^m11[a-z]+[.]' THEN 'p11.6-fixture' ELSE 'p11-harness' END,
       'document uploaded to a harness application'
  FROM documents d JOIN fx_apps x ON x.id = d.application_id
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'fraud_flag', f.id, 'p11-harness', 'flag raised on harness data'
  FROM fraud_flags f
 WHERE f.application_id IN (SELECT id FROM fx_apps)
    OR f.institution_code IN ('U-SURGE-01', 'U-NORMAL-02')
    -- Phase 13E: an institution flag raised only by harness applications
    -- (e.g. the fairness oracle's U-1001 / C-2002).
    OR (f.subject_type = 'INSTITUTION' AND f.institution_code IS NOT NULL
        AND EXISTS (SELECT 1 FROM applications a WHERE a.institution_code = f.institution_code)
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.institution_code = f.institution_code
                         AND a.id NOT IN (SELECT id FROM fx_apps)))
ON CONFLICT DO NOTHING;
-- Phase 13B: development seed users (scripts/seed-dev-role-users.ts).
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'account', id, 'dev-seed', 'development-only user (seed-dev-role-users.ts)'
  FROM accounts WHERE email LIKE '%.dev@example.org'
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'officer', o.id, 'dev-seed', 'officer profile of a development-only user'
  FROM officers o JOIN accounts a ON a.id = o.user_id WHERE a.email LIKE '%.dev@example.org'
ON CONFLICT DO NOTHING;
-- Phase 13C: deficiencies and their items on harness applications.
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'deficiency', d.id, 'p13c-fixture', 'deficiency raised on a harness application'
  FROM deficiencies d WHERE d.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'deficiency_item', i.id, 'p13c-fixture', 'deficiency item on a harness application'
  FROM deficiency_items i WHERE i.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
-- Phase 13D: applicant profile changes on harness accounts.
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'applicant_profile_change', c.id, 'p13d-fixture', 'profile change by a harness applicant'
  FROM applicant_profile_changes c JOIN applicants p ON p.id = c.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
-- Phase 13E: selection lists of runs over harness applications, their entries and decisions.
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT DISTINCT 'selection_list', e.selection_list_id, 'p13e-fixture', 'selection list of a harness run'
  FROM selection_list_entries e WHERE e.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'selection_list_entry', e.id, 'p13e-fixture', 'selection list entry of a harness application'
  FROM selection_list_entries e WHERE e.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'selection_committee_decision', d.id, 'p13e-fixture', 'committee decision on a harness list'
  FROM selection_committee_decisions d
 WHERE d.selection_list_id IN (SELECT entity_id FROM test_fixtures WHERE entity_type = 'selection_list')
ON CONFLICT DO NOTHING;
-- Phase 14 loose ends: the API-authored proof scheme and its versions (seeded schemes are real data).
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'scheme', id, 'p14-fixture', 'scheme authored through the API by the Phase 14 proof'
  FROM schemes WHERE code = 'TRIBAL_ARTS_P14'
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'scheme', id, 'p16-fixture', 'scheme authored through the API by the Phase 16 proofs'
  FROM schemes WHERE code IN ('WQ_ORACLE_P16', 'FOREST_SCIENCE_P16')
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'scheme_version', v.id, 'p14-fixture', 'version of the Phase 14 proof scheme'
  FROM scheme_versions v JOIN schemes s ON s.id = v.scheme_id WHERE s.code = 'TRIBAL_ARTS_P14'
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'scheme_version', v.id, 'p16-fixture', 'version of a Phase 16 proof scheme'
  FROM scheme_versions v JOIN schemes s ON s.id = v.scheme_id
 WHERE s.code IN ('WQ_ORACLE_P16', 'FOREST_SCIENCE_P16')
ON CONFLICT DO NOTHING;
-- Phase 14: SLA breaches, drafts, Aadhaar authentications and renewals of harness data.
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'sla_breach', b.id, 'p14-fixture', 'SLA breach recorded on a harness application'
  FROM sla_breaches b WHERE b.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'application_draft', d.id, 'p14-fixture', 'application draft of a harness applicant'
  FROM application_drafts d JOIN applicants p ON p.id = d.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'aadhaar_authentication', x.id, 'p14-fixture', 'Aadhaar authentication (mock, synthetic number) of a harness applicant'
  FROM aadhaar_authentications x JOIN applicants p ON p.id = x.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'renewal', r.id,
       CASE WHEN x.email ~ '^(ta[0-9]|sw[0-9]|dr[0-9]|rn[0-9]|aa[0-9])[.]' THEN 'p14-fixture' ELSE 'p11-harness' END,
       'renewal of a harness application'
  FROM renewals r JOIN fx_apps x ON x.id = r.parent_application_id
ON CONFLICT DO NOTHING;
-- Phase 16: notice-language preferences of harness officers (keyed by the row id).
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'officer_preference', p.id, 'p16-fixture', 'notice language of a harness officer'
  FROM officer_preferences p JOIN officers o ON o.id = p.officer_id
 WHERE o.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
-- Phase 17: privacy records, access log, retention runs and the retention fixtures.
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'consent_record', c.id, 'p17-fixture', 'consent record of a harness applicant'
  FROM consent_records c JOIN applicants p ON p.id = c.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'correction_request', c.id, 'p17-fixture', 'correction request of a harness applicant'
  FROM correction_requests c JOIN applicants p ON p.id = c.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'correction_decision', d.id, 'p17-fixture', 'decision on a harness correction request'
  FROM correction_decisions d
 WHERE d.request_id IN (SELECT entity_id FROM test_fixtures WHERE entity_type = 'correction_request')
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'erasure_request', e.id, 'p17-fixture', 'erasure request (recorded only) of a harness applicant'
  FROM erasure_requests e JOIN applicants p ON p.id = e.applicant_id
 WHERE p.user_id IN (SELECT id FROM fx_accounts)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'document_access', l.id, 'p17-fixture', 'document access by a harness account'
  FROM document_access_log l
 WHERE l.actor_account_id IN (SELECT id FROM fx_accounts) OR l.application_id IN (SELECT id FROM fx_apps)
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'retention_run', r.id, 'p17-fixture', 'retention run of the Phase 17 proofs (counts only)'
  FROM retention_runs r
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'notification', n.id,
       CASE WHEN a.email ~ '^(pv[0-9]|bk[0-9])[.]' OR n.event_type = 'RETENTION_FIXTURE' THEN 'p17-fixture' ELSE 'p11-harness' END,
       CASE WHEN n.event_type = 'RETENTION_FIXTURE' THEN 'retention fixture (inserted and backdated by the Phase 17 proof)'
            ELSE 'notification to a harness or development account' END
  FROM notifications n JOIN accounts a ON a.id = n.recipient_account_id
 WHERE a.id IN (SELECT id FROM fx_accounts) OR a.email LIKE '%.dev@example.org'
ON CONFLICT DO NOTHING;
INSERT INTO test_fixtures (entity_type, entity_id, label, note)
SELECT 'refresh_token', t.id,
       CASE WHEN a.email ~ '^(pv[0-9]|bk[0-9])[.]' THEN 'p17-fixture' ELSE 'p11-harness' END,
       'refresh token of a harness or development account'
  FROM refresh_tokens t JOIN accounts a ON a.id = t.account_id
 WHERE a.id IN (SELECT id FROM fx_accounts) OR a.email LIKE '%.dev@example.org'
ON CONFLICT DO NOTHING;
COMMIT;
