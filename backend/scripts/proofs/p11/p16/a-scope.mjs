// Phase 16 Part A: the two new views' queries (the service's SQL, oracle scheme and window
// inlined, fixtures included so the oracle is visible) run as app_user per actor; EXPLAIN of both.
import { spawnSync } from 'node:child_process';
import { psql } from '../psql.mjs';

const W0 = "'2026-09-01'::timestamptz", W1 = "'2026-10-31'::timestamptz";
const APPS = `SELECT a.id, a.current_stage, a.stage_due_at, sc.code AS scheme_code FROM applications a JOIN schemes sc ON sc.id = a.scheme_id WHERE sc.code = 'WQ_ORACLE_P16'`;
const LEVEL = `CASE WHEN o.jurisdiction_state IS NULL THEN 'NATIONAL' WHEN o.jurisdiction_district IS NULL THEN 'STATE' ELSE 'DISTRICT' END`;
const WORKLOAD = `
WITH apps AS (${APPS}),
acts AS (
  SELECT d.officer_id, CASE d.decision WHEN 'APPROVE' THEN 'verify' WHEN 'REJECT' THEN 'reject' WHEN 'DEFECT' THEN 'defective' ELSE 'other' END AS action,
         coalesce((d.reasons ->> 'eligibility_review_confirmed')::boolean, false) AS override,
         extract(epoch FROM t.created_at - (SELECT max(p.created_at) FROM workflow_transitions p WHERE p.application_id = d.application_id AND p.to_stage = t.from_stage AND p.created_at < t.created_at)) AS handling_s
    FROM decision_records d JOIN apps ON apps.id = d.application_id
    LEFT JOIN workflow_transitions t ON t.id = CASE WHEN d.reasons ->> 'workflow_transition_id' ~ '^[0-9a-f-]{36}$' THEN (d.reasons ->> 'workflow_transition_id')::uuid END AND t.application_id = d.application_id
   WHERE d.created_at >= ${W0} AND d.created_at < ${W1}
  UNION ALL
  SELECT e.confirmed_by_officer_id, 'document_confirm', jsonb_array_length(coalesce(e.corrected_fields, '[]'::jsonb)) > 0 OR e.classification_matches_slot IS FALSE, NULL
    FROM document_extractions e JOIN documents doc ON doc.id = e.document_id JOIN apps ON apps.id = doc.application_id
   WHERE e.confirmed_by_officer_id IS NOT NULL AND e.confirmed_at >= ${W0} AND e.confirmed_at < ${W1}
  UNION ALL
  SELECT ff.reviewed_by_officer_id, 'fraud_review', ff.status = 'FALSE_POSITIVE', NULL FROM fraud_flags ff JOIN apps ON apps.id = ff.application_id
   WHERE ff.reviewed_by_officer_id IS NOT NULL AND ff.reviewed_at >= ${W0} AND ff.reviewed_at < ${W1}
  UNION ALL
  SELECT sel.confirmed_by_officer_id, 'selection_confirm', sel.objection_window_overridden, NULL FROM selections sel JOIN apps ON apps.id = sel.application_id
   WHERE sel.confirmed_by_officer_id IS NOT NULL AND sel.confirmed_at >= ${W0} AND sel.confirmed_at < ${W1}
  UNION ALL
  SELECT cd.officer_id, 'committee_decision', cd.kind LIKE 'OVERRIDE_%', NULL FROM selection_committee_decisions cd
    JOIN selection_list_entries le ON le.id = cd.entry_id JOIN apps ON apps.id = le.application_id
   WHERE cd.created_at >= ${W0} AND cd.created_at < ${W1})
SELECT r.name AS role, ${LEVEL} AS level, count(*)::int AS actions_total, count(DISTINCT acts.officer_id)::int AS officers_active
  FROM acts JOIN officers o ON o.id = acts.officer_id JOIN roles r ON r.id = o.role_id
 GROUP BY r.name, ${LEVEL} ORDER BY 1, 2 LIMIT 100`;
const VQ = `
WITH apps AS (${APPS}),
docs AS (
  SELECT apps.scheme_code, d.document_type AS slot, d.source, d.intake_status, x.status AS extraction_status, x.review_status
    FROM documents d JOIN apps ON apps.id = d.application_id
    LEFT JOIN LATERAL (SELECT e.status, e.review_status FROM document_extractions e WHERE e.document_id = d.id ORDER BY e.created_at DESC, e.id LIMIT 1) x ON TRUE
   WHERE d.created_at >= ${W0} AND d.created_at < ${W1})
SELECT scheme_code, slot, count(*)::int AS uploaded, count(*) FILTER (WHERE review_status = 'AUTO_ACCEPTED')::int AS auto_verified
  FROM docs GROUP BY scheme_code, slot LIMIT 2000`;

const asUser = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q -F " "'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN READ ONLY; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim()).split('\n').join(' ; ') || '(no rows)';
};
const ACTORS = [
  ['DNO Ranchi (district officer)', 'dno.ranchi.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['DNO Dumka (another district)', 'dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['SNO Jharkhand (state)', 'sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['no actor set', null, ''],
];
console.log('=== A5.9 workload query as app_user (role | level | actions_total | officers_active)');
for (const [label, email, role] of ACTORS) console.log(`   ${label.padEnd(30)} ${asUser(email, role, WORKLOAD)}`);
console.log('\n=== A5.9 verification-quality query as app_user (scheme | slot | uploaded | auto_verified)');
for (const [label, email, role] of ACTORS) console.log(`   ${label.padEnd(30)} ${asUser(email, role, VQ)}`);
console.log('   (oracle: W01-W10 Ranchi, W11-W12 Dumka; Dumka applications have 2 documents, both quality-rejected income certificates)');

console.log('\n=== A5.10 EXPLAIN (ANALYZE, BUFFERS) as app_user / MINISTRY_OFFICER (national) - the two new queries');
for (const [name, sql] of [['workload', WORKLOAD], ['verification quality', VQ]]) {
  const out = asUser('ministry.p11@example.org', 'MINISTRY_OFFICER', `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${sql}`).split(' ; ');
  console.log(`   --- ${name}: ${out.length} plan lines`);
  for (const l of out.filter((l) => /Limit|Hash Join|Nested Loop|Seq Scan|Index|Aggregate|Subquery|SubPlan|Filter: /.test(l)).slice(0, 40)) console.log(`   ${l}`);
  for (const l of out.filter((l) => /Execution Time|Planning Time|Buffers: shared/.test(l)).slice(-3)) console.log(`   ${l.trim()}`);
}
console.log('\n   table sizes: ' + psql(`SELECT string_agg(relname||'='||n_live_tup, ' ' ORDER BY relname) FROM pg_stat_user_tables WHERE relname IN ('applications','decision_records','documents','document_extractions','workflow_transitions','fraud_flags','selections','selection_committee_decisions','sla_breaches');`));
