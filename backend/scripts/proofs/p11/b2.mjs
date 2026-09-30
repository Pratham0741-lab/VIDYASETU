import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
import { psql } from './psql.mjs';
const min = await login('ministry.p11@example.org');
const H = state.P.B2H;
if (!state.P.B2C) {
  const email = 'b2c.anita.p11@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Anita', last_name: 'Ekka', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-880051', annual_income: '420000.00', bank_account: 'SBIN0004455:88006006', gender: 'FEMALE', dob: '2003-11-19' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2028-29', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.P.B2C = { email, applicationId: app.id, application_no: app.application_no }; save();
  for (const w of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand']) await call('POST', `/applications/${app.id}/verify`, { remarks: 'ok' }, await login(`${w}.p11@example.org`));
}
const C = state.P.B2C;
const key = { [H.application_no]: 'H', [C.application_no]: 'C' };
const who = (xs) => JSON.stringify(xs.map((x) => key[x.application_no] ?? x.application_no));
const run = async (label, dry) => {
  const r = await call('POST', '/schemes/TOP_CLASS/academic-years/2028-29/run-selection', dry ? { dry_run: true } : {}, min, { raw: true });
  writeFileSync(`responses/b2-${label}.json`, JSON.stringify(r, null, 1));
  if (r.status !== 200) { console.log(`${label}: HTTP ${r.status} ${JSON.stringify(r.body)}`); return r; }
  console.log(`${label}: HTTP 200 dry_run=${r.body.dry_run} counts=${JSON.stringify(r.body.counts)} selected=${who(r.body.selected)} not_selected=${who(r.body.not_selected)} held=${JSON.stringify(r.body.held.map((h) => `${key[h.application_no]}:${h.status}:${h.fraud_flag_ids.length} flag`))}`);
  return r;
};
const facts = (label) => console.log(`  ${label}: ` + psql(`SELECT string_agg(CASE id WHEN '${H.applicationId}' THEN 'H' ELSE 'C' END || ' stage=' || current_stage || ' status=' || status, '; ' ORDER BY application_no) FROM applications WHERE id IN ('${H.applicationId}','${C.applicationId}');`));
const step = process.argv[2];
if (step === 'held') {
  console.log('H flags:', psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status, ', ') FROM fraud_flags WHERE application_id='${H.applicationId}';`));
  facts('before');
  const a = await run('dry-1', true), b = await run('dry-2', true);
  const strip = (r) => JSON.stringify({ s: r.body.selected, n: r.body.not_selected, h: r.body.held, c: r.body.counts, p: r.body.pools });
  console.log(`  determinism: dry-1 and dry-2 identical = ${strip(a) === strip(b)}`);
  await run('committed', false);
  facts('after committed run');
  console.log('  selections rows:', psql(`SELECT string_agg(CASE application_id WHEN '${H.applicationId}' THEN 'H' ELSE 'C' END || ':' || selection_status, ', ') FROM selections WHERE academic_year='2028-29';`));
  await new Promise((r) => setTimeout(r, 2500));
  for (const [k, p] of [['H', H], ['C', C]]) {
    const n = await call('GET', '/notifications', undefined, await login(p.email));
    console.log(`  ${k} notifications: ${JSON.stringify((n.notifications ?? n).map((x) => x.template_key))}`);
  }
}
if (step === 'release') {
  const id = psql(`SELECT id FROM fraud_flags WHERE application_id='${H.applicationId}' AND severity='HIGH';`);
  const r = await call('POST', `/fraud-flags/${id}/disposition`, { status: 'FALSE_POSITIVE', notes: 'B2 fixture: account verified with the bank as belonging to H.' }, min, { raw: true });
  console.log(`ministry dispositions H flag FALSE_POSITIVE: HTTP ${r.status} status=${r.body.status}`);
  await run('dry-after-release', true);
  await run('committed-after-release', false);
}
