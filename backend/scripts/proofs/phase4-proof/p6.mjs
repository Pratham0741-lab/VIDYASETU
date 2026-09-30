// Phase 6 proof harness: real HTTP flow only. Passwords come from pw.env (random per proof dir).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const API = 'http://127.0.0.1:3000/api/v1';
const PW = readFileSync(new URL('./pw.env', import.meta.url), 'utf8').match(/PW=(.*)/)[1].trim();
const seed = JSON.parse(readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/prisma/scheme_versions_seed_v2.json', 'utf8'));
const level = (code) => seed.find((v) => v.scheme_code === code && v.effective_to == null).config.rules.find((r) => r.id === 'education_level_match').params.eligible_level;
const STATE = new URL('./p6-state.json', import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { apps: {}, tokens: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, token) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 15);
      process.stdout.write(`  (429 on ${path}, waiting ${wait}s)\n`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  }
}
async function login(email) {
  if (!state.tokens[email]) { state.tokens[email] = (await call('POST', '/auth/login', { email, password: PW })).access_token; save(); }
  return state.tokens[email];
}

const versions = JSON.parse(process.env.VERSIONS); // { NOS: id, NFST: id, POST_MATRIC: id }

// --- officers (SUPER_ADMIN bootstrapped via the documented script)
const OFFICERS = [
  ['ino.ranchi@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421'],
  ['dno.ranchi@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi'],
  ['sno.jharkhand@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand'],
  ['ministry.officer@example.org', 'MINISTRY_OFFICER'],
];
if (!state.officers) {
  const admin = await login('admin.phase6@example.org');
  for (const [email, role, st, di, inst] of OFFICERS) {
    await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role,
      ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin);
  }
  state.officers = true; save();
}

// --- applicant pool: [key, scheme, category, gender, income, qs|null, declaredExtra, stopAt]
const NOS = (qs) => ({ education_level: level('NOS'), degree_enrolled: 'Master', tenure_years: 2, university_qs_ranking: qs });
const pool = [];
const stFemale = { S02: 1, S18: 1, S19: 1 };
for (let i = 1; i <= 20; i++) {
  const k = `S${String(i).padStart(2, '0')}`;
  pool.push([k, 'NOS', 'ST', stFemale[k] ? 'FEMALE' : 'MALE', '350000.00', NOS(20 * i), 'MINISTRY_APPROVED']);
}
for (const [k, qs, g] of [['P1', 55, 'MALE'], ['P2', 150, 'MALE'], ['P3', 310, 'MALE'], ['P4', 450, 'FEMALE'], ['P5', 900, 'MALE']]) {
  pool.push([k, 'NOS', 'PVTG', g, '350000.00', NOS(qs), 'MINISTRY_APPROVED']);
}
pool.push(['S21', 'NOS', 'ST', 'FEMALE', '350000.00', NOS(5), 'DNO_VERIFIED']); // best QS rank, but not yet approved
const NF = (net, acad) => ({ education_level: level('NFST'), degree_enrolled: 'PhD', tenure_years: 2,
  ...(net === null ? {} : { net_csir_net_score: net }), masters_or_4yr_bachelor_research_score: acad });
pool.push(['N1', 'NFST', 'ST', 'MALE', '800000.00', NF(82, 71), 'MINISTRY_APPROVED']);   // 76.5
pool.push(['N2', 'NFST', 'PVTG', 'FEMALE', '800000.00', NF(90, 80), 'MINISTRY_APPROVED']); // 85
pool.push(['N3', 'NFST', 'ST', 'FEMALE', '800000.00', NF(70, 83), 'MINISTRY_APPROVED']); // 76.5 tie, submitted later
pool.push(['N4', 'NFST', 'ST', null, '800000.00', NF(null, 88), 'MINISTRY_APPROVED']);    // no NET score -> unranked
pool.push(['M1', 'POST_MATRIC', 'ST', 'FEMALE', '180000.00', { education_level: level('POST_MATRIC') }, 'MINISTRY_APPROVED']);
pool.push(['M2', 'POST_MATRIC', 'ST', 'MALE', '120000.00', { education_level: level('POST_MATRIC') }, 'MINISTRY_APPROVED']);

const names = { ST: ['Oraon', 'Munda', 'Santhal', 'Ho'], PVTG: ['Birhor', 'Asur', 'Korwa'] };
for (const [key, scheme, category, gender, income, declared] of pool) {
  if (state.apps[key]) continue;
  const email = `${key.toLowerCase()}.p6@example.org`;
  const reg = { email, password: PW, first_name: `Cand${key}`, last_name: names[category][key.charCodeAt(1) % names[category].length],
    category, domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-${category}-${key}`,
    annual_income: income, bank_account: `SBIN0001234:3001${key}`, dob: '2000-04-17', ...(gender ? { gender } : {}) };
  await call('POST', '/auth/register', reg);
  const token = await login(email);
  const app = await call('POST', '/applications', { scheme_version_id: versions[scheme], academic_year: '2026-27', declared }, token);
  state.apps[key] = { id: app.id, application_no: app.application_no, scheme, category, gender, gate: app.eligibility_gate.outcome, stage: app.current_stage };
  save();
  console.log(`${key.padEnd(4)} ${scheme.padEnd(11)} ${category.padEnd(5)} ${String(gender).padEnd(6)} gate=${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}

// --- walk each application to its target stage through the real officer endpoints
const steps = [['ino.ranchi@example.org', 'INO_VERIFIED', 'DNO_VERIFIED'], ['dno.ranchi@example.org', 'DNO_VERIFIED', 'SNO_VERIFIED'], ['sno.jharkhand@example.org', 'SNO_VERIFIED', 'MINISTRY_APPROVED']];
const order = ['INO_VERIFIED', 'DNO_VERIFIED', 'SNO_VERIFIED', 'MINISTRY_APPROVED'];
for (const [key, , , , , , stopAt] of pool) {
  const a = state.apps[key];
  for (const [officer, from, to] of steps) {
    if (a.stage !== from || order.indexOf(from) >= order.indexOf(stopAt)) continue;
    const r = await call('POST', `/applications/${a.id}/verify`, { remarks: `Verified at ${from}` }, await login(officer));
    a.stage = r.application.current_stage; save();
  }
}
console.log('final stages:', Object.entries(state.apps).map(([k, a]) => `${k}=${a.stage}`).join(' '));
