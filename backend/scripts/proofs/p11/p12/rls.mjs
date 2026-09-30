// Phase 12 proof 4: the analytics SQL itself, run as app_user, scoped by RLS alone.
import { psql } from '../psql.mjs';

const cohort = `SELECT a.id, a.current_stage, a.status, a.jurisdiction_state, a.jurisdiction_district, a.stage_due_at,
                       s.code AS scheme_code, s.disbursement_mode
                  FROM applications a JOIN schemes s ON s.id = a.scheme_id
                 WHERE a.submitted_at >= '2026-06-01' AND a.submitted_at < '2027-06-01'`;
const held = `EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.application_id = c.id AND ff.severity = 'HIGH'
              AND ff.status = ANY(ARRAY['OPEN','NEEDS_MORE_INFO','CONFIRMED']))`;
const selected = `EXISTS (SELECT 1 FROM selections sel WHERE sel.application_id = c.id
                  AND sel.selection_status = ANY(ARRAY['PROVISIONAL','CONFIRMED']))`;
const funnel = `WITH c AS (${cohort})
  SELECT count(*) AS submitted, count(*) FILTER (WHERE ${selected}) AS selected,
         count(*) FILTER (WHERE ${held}) AS held,
         (SELECT count(*) FROM c JOIN workflow_transitions t ON t.application_id = c.id) AS transitions_via_cohort,
         (SELECT coalesce(string_agg(DISTINCT coalesce(jurisdiction_district, '-'), ','), '(none)') FROM c) AS districts
    FROM c`;
const juris = `WITH c AS (${cohort})
  SELECT coalesce(string_agg(d, '; '), '(no rows)') FROM (
    SELECT c.jurisdiction_state || '/' || c.jurisdiction_district || '=' || count(*) AS d
      FROM c GROUP BY c.jurisdiction_state, c.jurisdiction_district ORDER BY 1) x`;

const who = [
  ['district officer (DNO Ranchi)', 'dno.ranchi.p11@example.org'],
  ["other district's officer (DNO Dumka)", 'dno.dumka.p11@example.org'],
  ['state officer (SNO Jharkhand)', 'sno.jharkhand.p11@example.org'],
  ['no actor set', null],
];
console.log('role: app_user (no BYPASSRLS); transaction READ ONLY; fixtures included (all current data is fixture)\n');
for (const [label, email] of who) {
  const setActor = email
    ? `SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email = '${email}'), true),
              set_config('app.actor_role', '${email.startsWith('sno') ? 'STATE_NODAL_OFFICER' : 'DISTRICT_NODAL_OFFICER'}', true);`
    : '';
  const out = psql(`SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${setActor}
    SELECT json_build_object('funnel', (SELECT row_to_json(f) FROM (${funnel}) f), 'jurisdiction', (${juris}))::text; COMMIT;`)
    .split('\n').filter((l) => l.startsWith('{')).pop();
  const r = JSON.parse(out);
  console.log(`${label.padEnd(38)} submitted=${r.funnel.submitted} selected=${r.funnel.selected} held=${r.funnel.held} transitions=${r.funnel.transitions_via_cohort} districts=${r.funnel.districts}`);
  console.log(`${''.padEnd(38)} jurisdiction rows: ${r.jurisdiction}`);
}
console.log('\nworkflow_transitions has no RLS; queried directly as app_user with no actor it returns: ' +
  psql(`SET ROLE app_user; SELECT count(*) FROM workflow_transitions;`).split('\n').pop() +
  ' rows - which is why analytics only reaches it through the RLS-scoped cohort (0 above with no actor).');
