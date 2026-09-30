// Phase 14 loose ends, Part B proof: the scheduled SLA sweep records one breach per stage
// instance, idempotently; notifications to the responsible officer role; the sweep, the
// on-demand endpoint and the analytics SLA view agree on the same data.
// Run with the api started with SLA_SWEEP_INTERVAL_MS=20000.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveR = (n, r) => writeFileSync(`responses/p14/b-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(64)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const ino = { Ranchi: 'ino.ranchi.p11@example.org', Dumka: 'ino.dumka.p11@example.org' };
const dno = { Ranchi: 'dno.ranchi.p11@example.org', Dumka: 'dno.dumka.p11@example.org' };

// key, name, district, target stage, days in stage (SLA: INO 7, DNO 7, SNO 10, DEFECTIVE 15)
const PLAN = [
  ['SW1', 'Anjali', 'Ranchi', 'INO_VERIFIED', 10],
  ['SW2', 'Bandhan', 'Dumka', 'DNO_VERIFIED', 8],
  ['SW3', 'Charu', 'Ranchi', 'SNO_VERIFIED', 12],
  ['SW4', 'Dulari', 'Ranchi', 'DEFECTIVE', 20],
  ['SW5', 'Eshwar', 'Ranchi', 'INO_VERIFIED', 3],
  ['SW6', 'Fagu', 'Dumka', 'SNO_VERIFIED', 9],
];
const SLA = { INO_VERIFIED: 7, DNO_VERIFIED: 7, SNO_VERIFIED: 10, DEFECTIVE: 15 };

console.log('=== B.0 SLA figures read by the sweep (workflow definition, STAGE_SLA_DAYS)');
console.log('   ' + execFileSync('docker', ['compose', 'logs', '--no-color', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes('"sla sweep"')).slice(-1)[0].replace(/^.*"stageSlaDays":(\{[^}]*\}).*$/, '$1'));

console.log('\n=== B.1 fixtures: TOP_CLASS applicants moved to the target stage through the workflow');
state.P14 ??= {};
state.P14.sw ??= {};
for (const [key, first, district, stage] of PLAN) {
  if (state.P14.sw[key]) continue;
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(600 + PLAN.findIndex((p) => p[0] === key));
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: 'Tudu', category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-14B${n}`, annual_income: '150000.00', bank_account: `SBIN0004455:14B0${n}0`, gender: 'MALE', dob: '2004-04-04' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${JSON.stringify(reg.body)}`);
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  const chain = { INO_VERIFIED: [], DNO_VERIFIED: [ino[district]], SNO_VERIFIED: [ino[district], dno[district]], DEFECTIVE: [] }[stage];
  for (const who of chain) await call('POST', `/applications/${app.id}/verify`, {}, await login(who));
  if (stage === 'DEFECTIVE') {
    await call('POST', `/applications/${app.id}/mark-defective`, { code: 'DEF_P14_FIXTURE', title: 'Fixture defect', description: 'P14 SLA fixture: bona fide certificate unreadable', remarks: 'bona fide certificate page is unreadable' }, await login(ino[district]));
  }
  state.P14.sw[key] = { email, applicationId: app.id, application_no: app.application_no, district, stage };
  save();
}
for (const [key, , , stage, days] of PLAN) {
  const a = state.P14.sw[key];
  // Backdate the CURRENT stage instance: entered N days ago, due at entry + the stage SLA.
  psql(`UPDATE applications SET stage_entered_at = now() - interval '${days} days', stage_due_at = now() - interval '${days} days' + interval '${SLA[stage]} days' WHERE id='${a.applicationId}' AND current_stage='${stage}';`);
  console.log(`   ${key} ${a.application_no} ${a.district.padEnd(6)} ${psql(`SELECT current_stage||' entered '||to_char(stage_entered_at,'YYYY-MM-DD HH24:MI')||' due '||to_char(stage_due_at,'YYYY-MM-DD HH24:MI')||CASE WHEN stage_due_at < now() THEN '  PAST SLA' ELSE '  within SLA' END FROM applications WHERE id='${a.applicationId}';`)}`);
}

console.log('\n=== B.2 the scheduled job (every 20 s here) picks them up');
const before = Number(psql('SELECT count(*) FROM sla_breaches;'));
for (let i = 0; i < 40 && Number(psql('SELECT count(*) FROM sla_breaches;')) === before; i++) await sleep(1000);
await sleep(2000);
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', '--since', '3m', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes('"sla sweep"'));
for (const l of logs.slice(-3)) {
  const j = JSON.parse(l.replace(/^[^{]*/, ''));
  console.log(`   ${j.time} trigger=${j.trigger} breachedNow=${j.breachedNow} newlyRecorded=${j.newlyRecorded} run=${j.sweepRunId}`);
}
console.log('   recorded: ' + psql(`SELECT count(*)||' rows; by trigger: '||string_agg(DISTINCT coalesce(triggered_by_account_id::text,'SCHEDULE'), ',') FROM sla_breaches;`));

console.log('\n=== B.3 two more sweeps by hand (SUPER_ADMIN): nothing recorded twice');
const sa = await login('admin.p11@example.org');
let r = await call('POST', '/applications/sla-breaches/sweep', undefined, sa, { raw: true });
line('POST /applications/sla-breaches/sweep #1', r, ` breached_now=${r.body.breached_now} newly_recorded=${r.body.newly_recorded} already_recorded=${r.body.already_recorded}`);
saveR('sweep-1', r);
r = await call('POST', '/applications/sla-breaches/sweep', undefined, sa, { raw: true });
line('POST /applications/sla-breaches/sweep #2', r, ` breached_now=${r.body.breached_now} newly_recorded=${r.body.newly_recorded} already_recorded=${r.body.already_recorded}`);
saveR('sweep-2', r);
const sweepSet = r.body.breaches.map((b) => `${b.application_no}:${b.stage}`).sort();
console.log('   breaches: ' + sweepSet.join(', '));
r = await call('POST', '/applications/sla-breaches/sweep', undefined, await login('ministry.p11@example.org'), { raw: true });
line('  same as MINISTRY_OFFICER', r);
console.log('   rows per stage instance: ' + psql(`SELECT count(*)||' rows, '||count(DISTINCT (application_id, stage, stage_entered_at))||' distinct stage instances' FROM sla_breaches;`));
console.log('   compliant fixtures recorded: ' + psql(`SELECT count(*) FROM sla_breaches WHERE application_id IN ('${state.P14.sw.SW5.applicationId}','${state.P14.sw.SW6.applicationId}');`));

console.log('\n=== B.4 the three views agree on the same data');
const mo = await login('ministry.p11@example.org');
r = await call('GET', '/applications/sla-breaches', undefined, mo, { raw: true });
const endpointSet = r.body.applications.map((a) => `${a.application_no}:${a.current_stage}`).sort();
line('GET /applications/sla-breaches (MINISTRY_OFFICER, national)', r, ` count=${r.body.count}`);
saveR('on-demand', r);
r = await call('GET', '/analytics/sla?from=2026-01-01&to=2027-01-01&include_fixtures=true', undefined, sa, { raw: true });
line('GET /analytics/sla (SUPER_ADMIN, fixtures included)', r);
saveR('analytics-sla', r);
const analytics = Object.fromEntries(r.body.stages.map((s) => [s.stage, s.in_stage_past_sla]));
const byStage = (set) => set.reduce((t, x) => { const s = x.split(':')[1]; t[s] = (t[s] ?? 0) + 1; return t; }, {});
console.log(`   sweep (current breaches)  : ${JSON.stringify(byStage(sweepSet))}`);
console.log(`   on-demand endpoint        : ${JSON.stringify(byStage(endpointSet))}`);
console.log(`   analytics in_stage_past_sla: ${JSON.stringify(Object.fromEntries(Object.entries(analytics).filter(([, v]) => v !== 0)))}  (sla_days: ${JSON.stringify(Object.fromEntries(r.body.stages.map((s) => [s.stage, s.sla_days])))})`);
console.log(`   sweep set == endpoint set: ${JSON.stringify(sweepSet) === JSON.stringify(endpointSet)}; per-stage counts equal analytics: ${Object.entries(byStage(sweepSet)).every(([k, v]) => analytics[k] === v) && Object.values(analytics).reduce((a, b) => a + b, 0) === sweepSet.length}`);
for (const key of ['SW1', 'SW5']) {
  r = await call('GET', `/applications/${state.P14.sw[key].applicationId}/sla-status`, undefined, await login(state.P14.sw[key].email), { raw: true });
  line(`GET /applications/:id/sla-status (${key}, as the applicant)`, r, ` state=${r.body.state} sla_days=${r.body.sla_days} due=${r.body.due_at}`);
}
r = await call('GET', '/analytics/sla?from=2026-01-01&to=2027-01-01', undefined, mo, { raw: true });
line('GET /analytics/sla (MINISTRY_OFFICER, fixtures excluded)', r, ` in_stage_past_sla total=${r.body.stages.reduce((t, s) => t + s.in_stage_past_sla, 0)}`);

console.log('\n=== B.5 notifications: the officer role acting at the stage, in its jurisdiction');
await sleep(2000);
console.log(psql(`SELECT n.recipient_role||' '||coalesce(o.jurisdiction_district, o.jurisdiction_state, 'national')||' '||n.channel||' locale='||n.locale||' requested='||coalesce(n.requested_locale,'-')||' '||a.application_no||' | '||n.subject FROM notifications n JOIN applications a ON a.id=n.application_id JOIN officers o ON o.user_id=n.recipient_account_id WHERE n.template_key='officer.sla_breached' ORDER BY a.application_no, n.recipient_role, n.channel;`));
console.log('   notices per application: ' + psql(`SELECT string_agg(a.application_no||'='||c, ', ') FROM (SELECT application_id, count(*) c FROM notifications WHERE template_key='officer.sla_breached' GROUP BY 1) x JOIN applications a ON a.id=x.application_id;`));
console.log('   a body (English; officers have no language preference): ' + psql(`SELECT body FROM notifications WHERE template_key='officer.sla_breached' AND channel='IN_APP' ORDER BY created_at LIMIT 1;`));
console.log('   officer language column exists: ' + psql(`SELECT count(*) FROM information_schema.columns WHERE table_name='officers' AND column_name ILIKE '%lang%';`));

console.log('\n=== B.6 a new stage instance is a new breach; the old one stays recorded once');
const sw1 = state.P14.sw.SW1;
r = await call('POST', `/applications/${sw1.applicationId}/verify`, {}, await login(ino.Ranchi), { raw: true });
line('SW1 verified by INO Ranchi -> DNO_VERIFIED (due in 7 days)', r);
r = await call('POST', '/applications/sla-breaches/sweep', undefined, sa, { raw: true });
line('sweep', r, ` breached_now=${r.body.breached_now} newly_recorded=${r.body.newly_recorded}`);
psql(`UPDATE applications SET stage_entered_at = now() - interval '9 days', stage_due_at = now() - interval '2 days' WHERE id='${sw1.applicationId}' AND current_stage='DNO_VERIFIED';`);
r = await call('POST', '/applications/sla-breaches/sweep', undefined, sa, { raw: true });
line('DNO stay backdated 9 days; sweep', r, ` breached_now=${r.body.breached_now} newly_recorded=${r.body.newly_recorded}`);
console.log('   SW1 breach rows: ' + psql(`SELECT string_agg(stage||' entered '||to_char(stage_entered_at,'MM-DD HH24:MI'), '; ' ORDER BY detected_at) FROM sla_breaches WHERE application_id='${sw1.applicationId}';`));
await sleep(2000);
console.log('   SW1 notices: ' + psql(`SELECT string_agg(recipient_role||'/'||channel, ', ' ORDER BY created_at) FROM notifications WHERE template_key='officer.sla_breached' AND application_id='${sw1.applicationId}';`));

console.log('\n=== B.7 audit rows (SYSTEM actor) and the recorded-breach route under jurisdiction');
console.log(psql(`SELECT count(*)||' audit rows, actor_role '||string_agg(DISTINCT coalesce(actor_role,'-'), ',')||', actor_user_id null: '||bool_and(actor_user_id IS NULL) FROM audit_logs WHERE table_name='sla_breaches';`));
for (const who of ['ino.ranchi.p11@example.org', 'dno.dumka.p11@example.org', 'sno.jharkhand.p11@example.org', 'auditor.jharkhand.p11@example.org']) {
  r = await call('GET', '/applications/sla-breaches/recorded', undefined, await login(who), { raw: true });
  line(`GET /applications/sla-breaches/recorded as ${who.split('.p11')[0]}`, r, ` count=${r.body.count} districts=${[...new Set(r.body.breaches.map((b) => b.jurisdiction_district))].join(',')}`);
}
