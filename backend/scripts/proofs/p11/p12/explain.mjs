// Phase 12 proof 9: EXPLAIN ANALYZE for the two heaviest analytics queries (same SQL shape as the service).
import { psql } from '../psql.mjs';

const cohort = `SELECT a.id, a.current_stage, a.status, a.academic_year, a.scheme_version_id,
         a.jurisdiction_state, a.jurisdiction_district, a.institution_code, a.stage_due_at,
         s.code AS scheme_code, s.disbursement_mode
    FROM applications a JOIN schemes s ON s.id = a.scheme_id
   WHERE a.submitted_at >= '2026-06-01' AND a.submitted_at < '2027-06-01'
     AND NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type = 'application' AND f.entity_id = a.id)`;
const held = `EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.application_id = c.id AND ff.severity = 'HIGH' AND ff.status = ANY(ARRAY['OPEN','NEEDS_MORE_INFO','CONFIRMED']))`;
const selected = `EXISTS (SELECT 1 FROM selections sel WHERE sel.application_id = c.id AND sel.selection_status = ANY(ARRAY['PROVISIONAL','CONFIRMED']))`;
const sla = `WITH c AS (${cohort}),
  stays AS (SELECT t.application_id, t.to_stage AS stage, t.created_at AS entered_at,
                   lead(t.created_at) OVER (PARTITION BY t.application_id ORDER BY t.created_at, t.id) AS left_at
              FROM workflow_transitions t JOIN c ON c.id = t.application_id),
  sla AS (SELECT * FROM unnest(ARRAY['INO_VERIFIED','DNO_VERIFIED','SNO_VERIFIED','MINISTRY_APPROVED','DEFECTIVE'], ARRAY[7,7,10,15,15]) AS x(stage, days))
  SELECT sla.stage, count(st.left_at),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM st.left_at - st.entered_at)) FILTER (WHERE st.left_at IS NOT NULL),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM st.left_at - st.entered_at)) FILTER (WHERE st.left_at IS NOT NULL),
         count(*) FILTER (WHERE st.left_at IS NULL AND c.stage_due_at < now())
    FROM sla LEFT JOIN stays st ON st.stage = sla.stage LEFT JOIN c ON c.id = st.application_id
   GROUP BY sla.stage, sla.days`;
const juris = `WITH c AS (${cohort})
  SELECT c.jurisdiction_state, c.jurisdiction_district, c.institution_code, count(*),
         count(*) FILTER (WHERE ${selected}), count(*) FILTER (WHERE ${held}),
         count(*) FILTER (WHERE c.stage_due_at < now()),
         coalesce(sum((SELECT sum(d.amount) FROM disbursements d WHERE d.application_id = c.id AND d.status = 'SUCCESS' AND d.currency = 'INR')), 0),
         count(*) OVER ()
    FROM c GROUP BY 1, 2, 3 ORDER BY 1, 2 NULLS FIRST, 3 NULLS FIRST LIMIT 50 OFFSET 0`;

const asSno = `SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY;
  SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email = 'sno.jharkhand.p11@example.org'), true),
         set_config('app.actor_role', 'STATE_NODAL_OFFICER', true);`;
for (const [name, sql] of [['SLA / bottleneck (window + percentiles over transitions)', sla], ['jurisdiction rollup (group by district, institution)', juris]]) {
  for (const seqscan of ['on', 'off']) {
    console.log(`\n===== ${name} | enable_seqscan=${seqscan}`);
    const plan = psql(`${asSno} SET LOCAL enable_seqscan = ${seqscan}; EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY ON) ${sql}; ROLLBACK;`, ['-At', '-P', 'pager=off']);
    console.log(plan.split('\n').filter((l) => l.trim() && !/^\S+\|/.test(l)).join('\n'));
  }
}
console.log('\nrows in the tables involved: ' + psql(`SELECT string_agg(relname||'='||n_live_tup, ' ') FROM pg_stat_user_tables WHERE relname IN ('applications','workflow_transitions','fraud_flags','selections','disbursements','test_fixtures');`));
