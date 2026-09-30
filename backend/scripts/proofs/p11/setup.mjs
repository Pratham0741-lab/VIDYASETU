import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
if (!state.officers) {
  const admin = await login('admin.p11@example.org');
  for (const [email, role, st, di, inst] of [
    ['ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421'],
    ['dno.ranchi.p11@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi'],
    ['sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand'],
    ['ministry.p11@example.org', 'MINISTRY_OFFICER'],
    ['ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Dumka', 'U-0877'],
    ['dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Dumka'],
  ]) await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin);
  state.officers = true; save();
}
// key, first, last, dob, gender, district, bank, caste cert, institution_code
export const PEOPLE = [
  ['B1', 'Arjun', 'Tirkey', '2003-02-14', 'MALE', 'Ranchi', 'SBIN0004455:77012345', 'JH-ST-2026-100001', null],
  ['B2', 'Meena', 'Hembrom', '2004-09-03', 'FEMALE', 'Dumka', 'sbin0004455 : 77012345', 'JH-ST-2026-100002', null],
  ['C1', 'Rakesh', 'Bara', '2002-06-21', 'MALE', 'Ranchi', 'SBIN0004455:77020001', 'JH-ST-2026-555001', null],
  ['C2', 'Suman', 'Lakra', '2003-12-08', 'FEMALE', 'Ranchi', 'SBIN0004455:77020002', 'jh st 2026 555001', null],
  ['D1', 'Pooja', 'Minj', '2004-01-27', 'FEMALE', 'Ranchi', 'SBIN0004455:77030001', 'JH-ST-2026-100005', null],
  ['D2', 'Anil', 'Kerketta', '2002-10-19', 'MALE', 'Ranchi', 'SBIN0004455:77030002', 'JH-ST-2026-100006', null],
  ['D3', 'Nirmala', 'Kujur', '2005-05-30', 'FEMALE', 'Ranchi', 'SBIN0004455:77030003', 'JH-ST-2026-100007', null],
  ['F1', 'Sunita Kumari', 'Hansda', '2004-03-12', 'FEMALE', 'Ranchi', 'SBIN0004455:77040001', 'JH-ST-2026-100008', null],
  ['F2', 'Sunita K.', 'Hansda', '2004-03-12', 'FEMALE', 'Ranchi', 'SBIN0004455:77040002', 'JH-ST-2026-100009', null],
  ['G1', 'Kavya', 'Oraon', '2006-05-02', 'FEMALE', 'Ranchi', 'SBIN0004455:77050001', 'JH-ST-2026-100010', null],
  ['G2', 'Kavya', 'Oraon', '1998-11-20', 'FEMALE', 'Ranchi', 'SBIN0004455:77050002', 'JH-ST-2026-100011', null],
];
export async function applicant([key, first, last, dob, gender, district, bank, caste, inst]) {
  if (state.P?.[key]) return state.P[key];
  state.P ??= {};
  const email = `${key.toLowerCase()}.${first.split(' ')[0].toLowerCase()}.p11@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: caste, annual_income: '180000.00', bank_account: bank, gender, dob });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC }, ...(inst ? { institution_code: inst } : {}) }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no, district };
  save();
  return state.P[key];
}
if (process.argv[1]?.endsWith('setup.mjs')) {
  for (const p of PEOPLE) {
    const a = await applicant(p);
    console.log(`${p[0]} ${p[1]} ${p[2]} (${p[5]}, dob ${p[3]}) -> ${a.application_no}`);
  }
}
