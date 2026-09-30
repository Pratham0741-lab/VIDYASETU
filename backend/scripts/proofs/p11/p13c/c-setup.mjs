// Phase 13C Part C fixtures: applicants with every checklist document uploaded
// (mock fixtures); the income certificate issued 2024-06-01 (older than 12 months).
import { call, login, save, state, upload, waitProcessed, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';

export const INCOME_SLOT_OF = (checklist) => checklist.find((s) => /income/i.test(s));
export const marker = (first, last, extra = '') =>
  `clean;holder_name=${encodeURIComponent(`${first} ${last}`)}${extra}`;

export async function defApplicant(key, first, last, lang, { district = 'Ranchi', incomeIssued = '2024-06-01', phone } = {}) {
  state.P ??= {};
  if (state.P[key]?.uploaded) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  if (!state.P[key]) {
    const n = String(Object.keys(state.P).length + 100).padStart(3, '0');
    const reg = await call('POST', '/auth/register', {
      email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand',
      domicile_district: district, caste_cert_number: `JH-ST-2026-13C${n}`, annual_income: '180000.00',
      bank_account: `SBIN0004455:13C0${n}00`, gender: 'FEMALE', dob: '2004-03-03',
      ...(lang ? { preferred_language: lang } : {}),
      ...(phone ? { phone } : {}),
    }, undefined, { raw: true });
    if (reg.status !== 201) throw new Error(`register ${key}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login(email));
    state.P[key] = { email, applicationId: app.id, application_no: app.application_no, district, stage: app.current_stage, lang: lang ?? 'en' };
    save();
  }
  const P = state.P[key];
  const t = await login(email);
  const docs = await call('GET', `/applications/${P.applicationId}/documents`, undefined, t);
  const checklist = docs.checklist.map((c) => (typeof c === 'string' ? c : c.document_type ?? c.slot));
  P.checklist = checklist;
  for (const slot of checklist) {
    const extra = slot === INCOME_SLOT_OF(checklist) ? `;issue_date=${incomeIssued};family_income_annual=180000` : '';
    const r = await upload(t, P.applicationId, slot, marker(first, last, extra));
    if (r.status >= 300) throw new Error(`upload ${key} ${slot}: ${r.status} ${JSON.stringify(r.body)}`);
    await waitProcessed(t, r.body.document_id);
  }
  P.uploaded = true;
  save();
  return P;
}

if (process.argv[1]?.endsWith('c-setup.mjs')) {
  for (const [key, first, last, lang] of [
    ['H1', 'Phulmani', 'Kisku', 'hi'],
    ['E1', 'Rohit', 'Lakra', 'en'],
    ['S1', 'Sumitra', 'Murmu', 'sat'],
    ['BA1', 'Anita', 'Tudu', null],
    ['BA2', 'Birsa', 'Soren', null],
    ['BA3', 'Chandmuni', 'Hansda', null],
  ]) {
    const P = await defApplicant(key, first, last, lang);
    console.log(`${key.padEnd(4)} ${P.application_no} lang=${P.lang} stage=${P.stage} checklist=${P.checklist.length} slots uploaded`);
  }
}
