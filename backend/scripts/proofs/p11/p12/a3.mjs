// Phase 12 A3: NFST quarterly schedules, hold guard, POST_MATRIC State DBT, TOP_CLASS regression.
import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW, LEVELS as LVL } from '../lib.mjs';
import { applicant } from '../setup.mjs';
import { psql } from '../psql.mjs';

const rec = (label, r) => {
  writeFileSync(`responses/p12-${label}.json`, JSON.stringify(r, null, 1));
  return r;
};
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const line = (s, r, extra = '') => console.log(`${s.padEnd(58)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const min = await login('ministry.p11@example.org');
const V5 = psql(`SELECT v.id FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE s.code='NFST' AND v.version_no=5;`);
const rows = (appId) =>
  psql(`SELECT installment_no||' | '||component_type||' | '||amount||' '||currency||' | '||beneficiary_type||' | due '||scheduled_date||' | '||status FROM disbursements WHERE application_id='${appId}' ORDER BY installment_no;`);
const indent = (s) => '    ' + s.split('\n').join('\n    ');
state.P12 ??= {};

async function nfst(key, first, last, dob, bank, year) {
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  await call('POST', '/auth/register', {
    email, password: PW, first_name: first, last_name: last, category: 'ST',
    domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-77${year}0${key.length}1`,
    annual_income: '420000.00', bank_account: bank, gender: 'FEMALE', dob,
  });
  const app = await call('POST', '/applications', {
    scheme_version_id: V5, academic_year: '2027-28', course_year: year,
    declared: { education_level: LVL.NFST, degree_enrolled: 'PhD', tenure_years: year, net_csir_net_score: 80, masters_or_4yr_bachelor_research_score: 70 },
  }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  console.log(`${key}: NFST v5 2027-28, recorded PhD year ${year} -> ${app.application_no} gate=${app.eligibility_gate?.outcome} stage=${app.current_stage}`);
  for (const w of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand']) {
    const r = await call('POST', `/applications/${app.id}/verify`, { remarks: 'verified' }, await login(`${w}.p11@example.org`), { raw: true });
    if (r.status !== 200) console.log(`  verify by ${w}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  }
  return state.P[key];
}

const step = process.argv[2];
if (step === 'nfst') {
  const Y1 = await nfst('P12N1', 'Sumani', 'Kerketta', '1996-03-21', 'SBIN0004455:55001001', 1);
  const Y3 = await nfst('P12N3', 'Rebecca', 'Minz', '1994-08-30', 'SBIN0004455:55003003', 3);
  const r = await req('nfst-selection', 'POST', '/schemes/NFST/academic-years/2027-28/run-selection', {}, min);
  line('ministry runs NFST 2027-28 selection', r, ` basis=${r.body.basis} selected=${r.body.counts?.selected} held=${r.body.counts?.held}`);
  for (const [k, p] of [['P12N1', Y1], ['P12N3', Y3]]) {
    const sel = r.body.selected.find((s) => s.application_id === p.applicationId).selection_id;
    const c = await req(`${k}-confirm`, 'POST', `/selections/${sel}/confirm`, { override_reason: 'P12 A3 test fixture: committee confirmation inside the objection window.' }, min);
    const so = await req(`${k}-sanction`, 'POST', `/selections/${sel}/sanction-order`, undefined, min);
    const sc = await req(`${k}-schedule`, 'POST', `/selections/${sel}/disbursements`, undefined, min);
    console.log(`\n${k}: confirm HTTP ${c.status}; sanction order HTTP ${so.status}; schedule HTTP ${sc.status} mode=${sc.body.disbursement_mode} cadence=${sc.body.release_cadence} rates_status=${sc.body.rates_status} instalments=${sc.body.instalments?.length}`);
    console.log(`  basis: ${sc.body.scheduled_date_basis}`);
    console.log(`  unschedulable: ${JSON.stringify(sc.body.unschedulable_benefits?.map((u) => u.benefit_id))}`);
    console.log('  rows (installment | component | amount | beneficiary | due | status):\n' + indent(rows(p.applicationId)));
    state.P12[k] = { selectionId: sel };
    save();
  }
}
if (step === 'hold') {
  const Y1 = state.P.P12N1;
  const d1 = psql(`SELECT id FROM disbursements WHERE application_id='${Y1.applicationId}' AND installment_no=1;`);
  await applicant(['P12S', 'Birsi', 'Tete', '1990-01-19', 'FEMALE', 'Ranchi', 'sbin0004455 55001001', 'JH-ST-2026-770991', null]);
  await new Promise((res) => setTimeout(res, 2500));
  console.log('P12N1 flags:', psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status, ', ') FROM fraud_flags WHERE application_id='${Y1.applicationId}';`));
  let r = await req('nfst-initiate-held', 'POST', `/disbursements/${d1}/initiate`, undefined, min);
  line('ministry initiates P12N1 quarter 1 (HIGH flag OPEN)', r, ` flag_types=${JSON.stringify(r.body.details?.flag_types)}`);
  console.log('  denial row:', psql(`SELECT action_attempted||' | '||denial_reason||' | '||subject_type||':'||subject_id FROM authorization_denials WHERE request_id='${r.body.requestId}';`));
  console.log('  quarter 1 after refusal:', psql(`SELECT status||' ref='||coalesce(transaction_reference,'null') FROM disbursements WHERE id='${d1}';`));
  const f = await req('nfst-disp-fp', 'POST', `/fraud-flags/${r.body.details.flag_ids[0]}/disposition`, { status: 'FALSE_POSITIVE', notes: 'P12 fixture: the bank confirms the account belongs to the scholar.' }, min);
  line('ministry dispositions the flag FALSE_POSITIVE', f, ` status=${f.body.status}`);
  r = await req('nfst-initiate-released', 'POST', `/disbursements/${d1}/initiate`, undefined, min);
  line('ministry initiates P12N1 quarter 1 (released)', r, ` status=${r.body.status} amount=${r.body.amount} ref=${r.body.transaction_reference}`);
  console.log('  rows now:\n' + indent(rows(Y1.applicationId)));
}
if (step === 'pms') {
  const X = state.P.A2X;
  const [selId, selStatus] = psql(`SELECT id||' '||selection_status FROM selections WHERE application_id='${X.applicationId}';`).split(' ');
  console.log(`POST_MATRIC fixture ${X.application_no}: selection ${selId} ${selStatus}; sanction orders=${psql(`SELECT count(*) FROM sanction_orders WHERE selection_id='${selId}';`)}`);
  const r = await req('pms-schedule', 'POST', `/selections/${selId}/disbursements`, undefined, min);
  line('ministry creates the POST_MATRIC schedule', r, ' ' + JSON.stringify(r.body));
  const l = await req('pms-list', 'GET', `/applications/${X.applicationId}/disbursements`, undefined, min);
  line('GET applications/:id/disbursements', l, ` body=${JSON.stringify(l.body)}`);
  console.log(`  disbursement rows for it: ${psql(`SELECT count(*) FROM disbursements WHERE application_id='${X.applicationId}';`)}; zero-amount rows anywhere: ${psql(`SELECT count(*) FROM disbursements WHERE amount = 0;`)}`);
}
if (step === 'top') {
  const C = state.P.B2C;
  const sel = psql(`SELECT id FROM selections WHERE application_id='${C.applicationId}';`);
  const c = await req('top-confirm', 'POST', `/selections/${sel}/confirm`, { override_reason: 'P12 A3 test fixture: TOP_CLASS regression.' }, min);
  const so = await req('top-sanction', 'POST', `/selections/${sel}/sanction-order`, undefined, min);
  const r = await req('top-schedule', 'POST', `/selections/${sel}/disbursements`, undefined, min);
  console.log(`TOP_CLASS 2028-29 (C): confirm ${c.status}, sanction ${so.status}, schedule HTTP ${r.status} mode=${r.body.disbursement_mode} cadence=${r.body.release_cadence} rates_status=${r.body.rates_status} instalments=${r.body.instalments?.length}`);
  console.log('  rows:\n' + indent(rows(C.applicationId)));
}
