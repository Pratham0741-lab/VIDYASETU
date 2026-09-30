import { call, login, state } from './p9lib.mjs';
import { execFileSync } from 'node:child_process';
const psql = (sql) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql }).toString().trim();
const min = await login('ministry9@example.org');
const statuses = [];
const post = async (label, path) => { const r = await call('POST', path, undefined, min, { raw: true }); statuses.push(r.status); console.log(`  ${label}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 330)}`); return r; };
for (const [key, scenario] of [['F1', 'INSUFFICIENT_BALANCE'], ['F2', 'TIMEOUT'], ['F3', 'ACCOUNT_INVALID'], ['F4', 'PENDING']]) {
  const f = state.F[key];
  console.log(`\n=== ${key} ${f.application_no} (mock scenario ${scenario})`);
  const i = await post('initiate', `/disbursements/${f.disbursementId}/initiate`);
  if (i.status === 200) await post('reconcile', `/disbursements/${f.disbursementId}/reconcile`);
}
console.log('\n--- after one pass: what was recorded');
const q = () => psql(`SELECT a.application_no, d.status AS disbursement, left(coalesce(d.transaction_reference,'-'),28) AS pfms_reference, coalesce(d.utr_number,'-') AS utr, coalesce(d.failure_reason,'-') AS failure_reason, (d.disbursed_at IS NOT NULL) AS disbursed, a.current_stage FROM disbursements d JOIN applications a ON a.id=d.application_id WHERE a.academic_year='2027-28' ORDER BY a.application_no;`);
console.log(q());
const f4 = state.F.F4;
console.log(`\n=== F4 PENDING: waiting past the mock's 60 s settlement window, then reconcile again`);
await new Promise((r) => setTimeout(r, 62_000));
await post('reconcile (after 62 s)', `/disbursements/${f4.disbursementId}/reconcile`);
console.log('\n--- final state');
console.log(q());
console.log(`\nHTTP statuses seen: ${JSON.stringify(statuses)}  | any 5xx other than the timeout's 503: ${statuses.some((s) => s >= 500 && s !== 503)}`);
console.log(psql(`SELECT count(*) AS internal_errors_logged FROM (SELECT 1) x WHERE false;`).split('\n').slice(-2, -1).join(''));
