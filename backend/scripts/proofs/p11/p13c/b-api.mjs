// Phase 13C proof B1: the objection-window override reason needs 10 trimmed characters (API).
import { writeFileSync } from 'node:fs';
import { call, login, save as saveState, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
const min = await login('ministry.p11@example.org');
const save = (n, r) => writeFileSync(`responses/p13c/${n}.json`, JSON.stringify(r, null, 1));
let run;
// A fresh TOP_CLASS application for 2029-30 (no selection yet), verified through INO -> DNO -> SNO.
state.P ??= {};
if (!state.P.B13C) {
  const email = 'b13c.sunita.p11@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Sunita', last_name: 'Hembrom', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-913013', annual_income: '300000.00', bank_account: 'SBIN0004455:91300130', gender: 'FEMALE', dob: '2002-02-02' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2029-30', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.P.B13C = { email, applicationId: app.id, application_no: app.application_no };
  saveState();
  for (const who of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand']) {
    const r = await call('POST', `/applications/${app.id}/verify`, {}, await login(`${who}.p11@example.org`), { raw: true });
    console.log(`${who} verifies ${app.application_no}: HTTP ${r.status} -> ${r.body.application?.current_stage ?? r.body.code}`);
  }
}
for (const [code, year] of [['TOP_CLASS', '2029-30']]) {
  const r = await call('POST', `/schemes/${code}/academic-years/${year}/run-selection`, {}, min, { raw: true });
  console.log(`run-selection ${code} ${year}: HTTP ${r.status} ${r.body.code ?? ''} ${r.body.details?.reason ?? ''} selected=${r.body.counts?.selected ?? '-'}`);
  if (r.status === 200 && r.body.selected?.length) { run = r.body; save(`b-run-${code}-${year}`, r); break; }
}
const sel = run.selected[0].selection_id;
console.log(`selection ${sel.slice(0, 8)} (PROVISIONAL, objection window open)`);
for (const [label, body] of [['no reason', {}], ['blank "   "', { override_reason: '   ' }], ['"too short" (9)', { override_reason: 'too short' }], ['"  short 9  " padded to 12, 9 trimmed', { override_reason: '  short 9x  ' }]]) {
  const r = await call('POST', `/selections/${sel}/confirm`, body, min, { raw: true });
  save(`b-confirm-${label.replace(/\W+/g, '-')}`, r);
  console.log(`confirm, ${label.padEnd(38)} HTTP ${r.status} ${r.body.code} ${r.body.message_key ?? ''} ${JSON.stringify(r.body.details ?? '')}`);
}
const ok = await call('POST', `/selections/${sel}/confirm`, { override_reason: 'Committee met on 29 Sep; no objections filed.' }, min, { raw: true });
save('b-confirm-ok', ok);
console.log(`confirm, 45-character reason                HTTP ${ok.status} status=${ok.body.selection?.selection_status} overridden=${ok.body.objection_window?.overridden}`);
