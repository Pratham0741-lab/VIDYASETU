// Phase 12: every analytics number vs independently written SQL (DB owner, same window, fixtures included).
import { readFileSync } from 'node:fs';
import { psql } from '../psql.mjs';

const J = (v) => JSON.parse(readFileSync(`responses/p12/admin-fixtures-${v}.json`, 'utf8'));
const q = (sql) => JSON.parse(psql(`SELECT coalesce(json_agg(x), '[]') FROM (${sql}) x;`));
const W = `a.submitted_at >= '2026-06-01' AND a.submitted_at < '2027-06-01'`;
let bad = 0;
const cmp = (label, api, sql) => {
  const ok = JSON.stringify(api) === JSON.stringify(sql);
  if (!ok) bad++;
  console.log(`${ok ? 'MATCH' : 'DIFF '} ${label.padEnd(44)} api=${JSON.stringify(api)} sql=${JSON.stringify(sql)}`);
};

// B-1 funnel
const f = J('funnel');
const [fs] = q(`SELECT
  count(*) AS submitted,
  count(*) FILTER (WHERE a.current_stage IN ('MINISTRY_APPROVED','DISBURSED') OR a.id IN (SELECT application_id FROM workflow_transitions WHERE to_stage='MINISTRY_APPROVED')) AS verified,
  count(*) FILTER (WHERE a.id IN (SELECT application_id FROM selections WHERE selection_status IN ('PROVISIONAL','CONFIRMED'))) AS selected,
  count(*) FILTER (WHERE a.id IN (SELECT application_id FROM sanction_orders)) AS sanctioned,
  count(*) FILTER (WHERE a.current_stage='DISBURSED' OR a.id IN (SELECT application_id FROM disbursements WHERE status='SUCCESS')) AS disbursed,
  count(*) FILTER (WHERE a.id IN (SELECT application_id FROM fraud_flags WHERE severity='HIGH' AND status IN ('OPEN','NEEDS_MORE_INFO','CONFIRMED'))) AS held,
  count(*) FILTER (WHERE a.current_stage='REJECTED') AS rejected,
  count(*) FILTER (WHERE a.status='UNDER_REVIEW') AS under_review
  FROM applications a WHERE ${W}`);
cmp('funnel steps', f.steps.map((s) => s.count), [fs.submitted, fs.verified, fs.selected, fs.sanctioned, fs.disbursed]);
cmp('funnel held / rejected / under_review', [f.held.count, f.current.rejected, f.current.under_review], [fs.held, fs.rejected, fs.under_review]);

// B-2 SLA: completed stays and in-stage counts per stage, median hours
const s = J('sla');
const ss = q(`WITH t AS (SELECT w.application_id, w.to_stage, w.created_at,
    lead(w.created_at) OVER (PARTITION BY w.application_id ORDER BY w.created_at, w.id) AS nxt
    FROM workflow_transitions w JOIN applications a ON a.id=w.application_id WHERE ${W})
  SELECT to_stage AS stage, count(nxt) AS completed, count(*) - count(nxt) AS in_stage,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM nxt-created_at)) FILTER (WHERE nxt IS NOT NULL) / 3600)::numeric, 1)::float8 AS median_h
  FROM t WHERE to_stage IN ('INO_VERIFIED','DNO_VERIFIED','SNO_VERIFIED','MINISTRY_APPROVED','DEFECTIVE') GROUP BY 1 ORDER BY 1`);
for (const x of ss) {
  const a = s.stages.find((y) => y.stage === x.stage);
  cmp(`sla ${x.stage} completed/in_stage/median_h`, [a.completed_stays, a.in_stage_now, a.median_hours], [x.completed, x.in_stage, x.median_h]);
}

// B-3 schemes
const sc = J('schemes');
const scs = q(`SELECT s.code, a.academic_year, count(*) AS apps,
    count(*) FILTER (WHERE a.id IN (SELECT application_id FROM selections WHERE selection_status IN ('PROVISIONAL','CONFIRMED'))) AS selected,
    count(*) FILTER (WHERE a.id IN (SELECT application_id FROM fraud_flags WHERE severity='HIGH' AND status IN ('OPEN','NEEDS_MORE_INFO','CONFIRMED'))) AS held,
    count(*) FILTER (WHERE a.current_stage='DEFECTIVE') AS defective
  FROM applications a JOIN schemes s ON s.id=a.scheme_id WHERE ${W} GROUP BY 1,2 ORDER BY 1,2`);
cmp('schemes rows (code year apps selected held defective)', sc.schemes.map((r) => [r.scheme_code, r.academic_year, r.applications, r.selected, r.held, r.defective]), scs.map((r) => [r.code, r.academic_year, r.apps, r.selected, r.held, r.defective]));

// B-4 disbursements
const d = J('disbursements');
const ds = q(`SELECT s.code, d.status, count(*) AS n, sum(d.amount)::float8 AS amount,
    bool_or(d.status='PENDING' AND a.id IN (SELECT application_id FROM fraud_flags WHERE severity='HIGH' AND status IN ('OPEN','NEEDS_MORE_INFO','CONFIRMED'))) AS any_held
  FROM disbursements d JOIN applications a ON a.id=d.application_id JOIN schemes s ON s.id=a.scheme_id WHERE ${W} GROUP BY 1,2 ORDER BY 1,2`);
const apiByRaw = {};
for (const r of d.by_status) {
  const raw = r.status === 'PAID' ? 'SUCCESS' : r.status === 'HELD_BY_FRAUD_REVIEW' ? 'PENDING' : r.status;
  const k = `${r.scheme_code} ${raw}`;
  apiByRaw[k] = [(apiByRaw[k]?.[0] ?? 0) + r.instalments, (apiByRaw[k]?.[1] ?? 0) + r.amount];
}
cmp('disbursements by raw status (count, amount)', apiByRaw, Object.fromEntries(ds.map((r) => [`${r.code} ${r.status}`, [r.n, r.amount]])));
cmp('disbursements scheduled totals', d.scheduled.map((r) => [r.scheme_code, r.instalments, r.amount]), q(`SELECT s.code, count(*) AS n, sum(d.amount)::float8 AS amount FROM disbursements d JOIN applications a ON a.id=d.application_id JOIN schemes s ON s.id=a.scheme_id WHERE ${W} AND s.disbursement_mode='SCHEDULED_BY_PLATFORM' GROUP BY 1 ORDER BY 1`).map((r) => [r.code, r.n, r.amount]));
cmp('State DBT (POST_MATRIC selected)', d.handled_by_state.map((r) => [r.scheme_code, r.applications, r.amount]), q(`SELECT s.code, count(*) AS n FROM applications a JOIN schemes s ON s.id=a.scheme_id WHERE ${W} AND s.disbursement_mode='FORWARDED_TO_STATE' AND a.id IN (SELECT application_id FROM selections WHERE selection_status IN ('PROVISIONAL','CONFIRMED')) GROUP BY 1`).map((r) => [r.code, r.n, null]));

// B-5 fraud
const fr = J('fraud');
cmp('fraud flags by type/severity/status', fr.application_flags.map((r) => [r.flag_type, r.severity, r.status, r.flags]), q(`SELECT f.flag_type, f.severity, f.status, count(*) AS n FROM fraud_flags f JOIN applications a ON a.id=f.application_id WHERE ${W} GROUP BY 1,2,3 ORDER BY 1,2,3`).map((r) => [r.flag_type, r.severity, r.status, r.n]));
cmp('fraud institution flags', fr.institution_flags.map((r) => [r.flag_type, r.status, r.flags]), q(`SELECT flag_type, status, count(*) AS n FROM fraud_flags WHERE subject_type='INSTITUTION' AND created_at >= '2026-06-01' AND created_at < '2027-06-01' GROUP BY 1,2 ORDER BY 1,2`).map((r) => [r.flag_type, r.status, r.n]));
cmp('held applications', fr.held_applications.total, fs.held);

// B-6 jurisdiction (unsuppressed SQL, for comparison with the suppressed API)
const j = J('jurisdiction');
const js = q(`SELECT jurisdiction_state AS state, jurisdiction_district AS district, count(*) AS apps FROM applications a WHERE ${W} GROUP BY 1,2 ORDER BY 1,2`);
cmp('jurisdiction rows (district, applications)', j.rows.map((r) => [r.district, r.applications]), js.map((r) => [r.district, r.apps < 5 ? '<5' : r.apps]));
console.log(`  (SQL raw district counts: ${JSON.stringify(js.map((r) => [r.district, r.apps]))}; API applies the <5 rule and secondary suppression)`);
console.log(`\n${bad === 0 ? 'ALL MATCH' : bad + ' DIFFERENCE(S)'}`);
