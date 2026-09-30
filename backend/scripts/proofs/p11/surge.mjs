import { call, login, save, state } from './lib.mjs';
import { applicant } from './setup.mjs';
import { psql } from './psql.mjs';
const FIRST = ['Aakash','Bhavna','Chetan','Deepa','Eshan','Farida','Gopal','Hema','Ishaan','Jyoti','Kishore','Lalita','Manoj','Nandini','Omkar','Parvati','Rohit','Sarita','Tarun','Usha','Vikram','Yamini','Zubin','Asha','Birsa','Champa','Dilip','Ganga','Hari','Indu','Jagdish','Kiran'];
const LAST = ['Soren','Murmu','Tudu','Marandi','Besra','Kisku','Hansdak','Baskey'];
let n = 0;
const dob = (i) => new Date(Date.UTC(1999, 0, 1) + i * 37 * 86400000).toISOString().slice(0, 10);
const person = (tag, inst) => { const i = n++; return [tag, FIRST[i], LAST[i % LAST.length], dob(i), i % 2 ? 'FEMALE' : 'MALE', 'Ranchi', `SBIN0004455:7709${String(i).padStart(4, '0')}`, `JH-ST-2026-9${String(i).padStart(5, '0')}`, inst]; };
const phase = process.argv[2];
state.S ??= {};
if (phase === 'history') {
  for (const inst of ['U-SURGE-01', 'U-NORMAL-02']) {
    state.S[inst] = { anchor: null, baseline: [], now: [] };
    state.S[inst].anchor = (await applicant(person(`${inst}-A`, inst))).applicationId;
    for (let k = 0; k < 8; k++) state.S[inst].baseline.push((await applicant(person(`${inst}-B${k}`, inst))).applicationId);
  }
  state.S.n = n; save();
  console.log('history fixture created (all submitted just now):', Object.fromEntries(['U-SURGE-01', 'U-NORMAL-02'].map((i) => [i, 1 + state.S[i].baseline.length])));
}
if (phase === 'backdate') {
  const sql = ['U-SURGE-01', 'U-NORMAL-02'].map((inst) => {
    const s = state.S[inst];
    return [`UPDATE applications SET submitted_at = now() - interval '70 days' WHERE id = '${s.anchor}';`,
      ...s.baseline.map((id, k) => `UPDATE applications SET submitted_at = now() - interval '${60 - 7 * k} days' WHERE id = '${id}';`)].join('\n');
  }).join('\n');
  psql(`-- P11 TEST FIXTURE: backdate the surge scenario's history (labelled; audited by the trigger)\nBEGIN;\n${sql}\nCOMMIT;`);
  console.log(psql(`SELECT institution_code, count(*) AS apps, min(submitted_at)::date AS earliest, max(submitted_at)::date AS latest, array_agg((now()::date - submitted_at::date) ORDER BY submitted_at) AS days_ago FROM applications WHERE institution_code IN ('U-SURGE-01','U-NORMAL-02') GROUP BY 1 ORDER BY 1;`, ['-P', 'pager=off']));
}
if (phase === 'now') {
  n = state.S.n;
  for (let k = 0; k < 12; k++) state.S['U-SURGE-01'].now.push((await applicant(person(`U-SURGE-01-N${k}`, 'U-SURGE-01'))).applicationId);
  for (let k = 0; k < 2; k++) state.S['U-NORMAL-02'].now.push((await applicant(person(`U-NORMAL-02-N${k}`, 'U-NORMAL-02'))).applicationId);
  state.S.n = n; save();
  console.log('current window: U-SURGE-01 +12, U-NORMAL-02 +2');
}
if (phase === 'check') {
  const ino = await login('ino.ranchi.p11@example.org');
  for (const inst of ['U-SURGE-01', 'U-NORMAL-02']) {
    const id = state.S[inst].now.at(-1) ?? state.S[inst].anchor;
    const r = await call('POST', `/applications/${id}/fraud-checks`, undefined, ino);
    const s = r.run.surge;
    console.log(`${inst}: status=${s.status} window_count=${s.window_count} baseline_counts=${JSON.stringify(s.baseline_counts)} median=${s.baseline_median} threshold=${s.threshold ?? '-'}${s.reason ? ' reason=' + s.reason : ''}`);
  }
  console.log('\nINSTITUTION_SURGE flags in DB:');
  console.log(psql(`SELECT flag_type, severity, subject_type, institution_code, jurisdiction_state, jurisdiction_district, summary FROM fraud_flags WHERE flag_type='INSTITUTION_SURGE';`, ['-P', 'pager=off']));
  console.log(psql(`SELECT 'FUZZY flags touching surge fixture: ' || count(*) FROM fraud_flags f JOIN applications a ON a.id=f.application_id WHERE f.flag_type='FUZZY_IDENTITY_MATCH' AND a.institution_code IN ('U-SURGE-01','U-NORMAL-02');`));
}
