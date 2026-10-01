#!/usr/bin/env node
// VIDYASETU demo seed: a small, realistic demo dataset for the prototype video.
//
// Data only, through the real API routes (registration, consent, applications,
// document uploads, officer actions, selection lists, sanction orders,
// disbursement schedules, renewals), so encryption, match hashes, audit rows and
// RLS behave as in production. The only owner-level step is the labelled
// backdating of submission times (backdateWave below); nothing else touches a
// table directly.
//
// Deterministic (fixed SEED) and safe to run twice: every step reads the
// current state through the API first and only acts when something is missing.
//
// Not in the repository: passwords and tokens. The seed reads DEMO_SEED_DIR
// (default: ../.demo-seed next to the repository) for
//   demo.env    DEMO_PASSWORD (all demo accounts), ADMIN_EMAIL, ADMIN_PASSWORD
//               (an existing SUPER_ADMIN, who provisions the demo officers),
//               API_BASE
//   state.json  refresh tokens (written by the seed)
//   logins.md   the demo accounts and what to show with each (written by the seed)
//
// Usage (stack running; see docs/DEMO.md):  node scripts/demo/seed-demo.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.env.DEMO_SEED_DIR ?? join(REPO, '..', '.demo-seed'));
const ENV = Object.fromEntries(
  readFileSync(join(OUT, 'demo.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const API = ENV.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const PW = ENV.DEMO_PASSWORD;
if (!PW || !ENV.ADMIN_EMAIL || !ENV.ADMIN_PASSWORD) throw new Error(`demo.env in ${OUT} is incomplete`);
const STATE_FILE = join(OUT, 'state.json');
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { refresh: {} };
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), { mode: 0o600 });
const DOCS_DIR = join(OUT, 'docs');
mkdirSync(DOCS_DIR, { recursive: true });

// ------------------------------------------------------------------ constants
const SEED = 20260929;
const YEAR = '2025-26'; // no test fixture uses this academic year: demo lists hold demo rows only
const RENEWAL_YEAR = '2026-27';
const STATE = 'Jharkhand';
const DOMAIN = 'demo@example.org'; // every demo account is <local>.demo@example.org (not tagged as a fixture)
const NOTICE = '2026-10-v1';
const VERSION_NO = { NFST: 5, TOP_CLASS: 3, POST_MATRIC: 2 };
const LEVEL = {
  NFST: "Ph.D in Science, Humanities, and Social Sciences (Master's degree or 4-year Bachelor's degree with Research as per NEP 2020)",
  TOP_CLASS: 'Graduate and Post Graduate level courses in 265 notified premier institutes',
  POST_MATRIC:
    "Higher education starting from Class XI to Post Graduation (Classes XI-XII, ITI, Polytechnic Diploma, Graduate Degree, PG Diploma, Master's, M.Phil, Ph.D in recognized institutions)",
};

// Synthetic institutions (names invented; codes JH-<district>-NN).
const INSTITUTIONS = [
  { code: 'JH-GUM-01', name: 'Koel Valley Degree College, Gumla (synthetic)', district: 'Gumla', scheme: 'POST_MATRIC', course: 'B.Sc. Botany' },
  { code: 'JH-GUM-02', name: 'Gumla Institute of Tribal Research Studies (synthetic)', district: 'Gumla', scheme: 'NFST', course: 'Ph.D Anthropology' },
  { code: 'JH-GUM-03', name: 'Palkot Institute of Nursing and Allied Health (synthetic)', district: 'Gumla', scheme: 'POST_MATRIC', course: 'Diploma in General Nursing' },
  { code: 'JH-KHU-01', name: 'Khunti Hill Science College (synthetic)', district: 'Khunti', scheme: 'POST_MATRIC', course: 'B.A. Economics' },
  { code: 'JH-KHU-02', name: 'Chotanagpur Institute of Technology (synthetic)', district: 'Khunti', scheme: 'TOP_CLASS', course: 'B.Tech Civil Engineering' },
  { code: 'JH-LOH-01', name: 'Lohardaga Valley Arts College (synthetic)', district: 'Lohardaga', scheme: 'POST_MATRIC', course: 'B.Com' },
  { code: 'JH-LOH-02', name: 'South Koel University, Department of Anthropology (synthetic)', district: 'Lohardaga', scheme: 'NFST', course: 'Ph.D Tribal Studies' },
  { code: 'JH-LOH-03', name: 'Netarhat Plateau Institute of Management (synthetic)', district: 'Lohardaga', scheme: 'TOP_CLASS', course: 'MBA' },
];
const DISTRICTS = [...new Set(INSTITUTIONS.map((i) => i.district))];

// Scenario mix per scheme (60 applicants). See docs/DEMO.md for what each shows.
//   F final list; F_EXCLUDED final list, excluded by the committee (override);
//   SNO / DNO waiting at that review level; JUST just submitted (waiting for the institute);
//   REJ_INO / REJ_DNO rejected at that level; DEF_EXPIRED / DEF_OFFICER itemised deficiency
//   (expired income certificate / officer-raised item); RESUB resubmitted (back with the
//   institute); RESUB_VERIFIED resubmitted and verified onward; GATE_INELIGIBLE refused by
//   the automatic gate (income over the ceiling); BANK_A / BANK_B one bank account typed two
//   ways; DUP_SRC / DUP_COPY one file uploaded by two applicants.
const MIX = {
  NFST: { F: 12, SNO: 2, DNO: 2, JUST: 2, REJ_DNO: 1, DEF_OFFICER: 1 },
  TOP_CLASS: { F: 6, F_EXCLUDED: 1, SNO: 2, DNO: 2, JUST: 3, REJ_INO: 1, DEF_EXPIRED: 1, RESUB: 1, GATE_INELIGIBLE: 1 },
  POST_MATRIC: { F: 9, SNO: 1, DNO: 2, JUST: 2, BANK_A: 1, BANK_B: 1, DUP_SRC: 1, DUP_COPY: 1, REJ_INO: 1, DEF_EXPIRED: 1, RESUB_VERIFIED: 1, DEF_OFFICER: 1 },
};
const TARGET_STAGE = {
  F: 'MINISTRY_APPROVED', F_EXCLUDED: 'MINISTRY_APPROVED', SNO: 'SNO_VERIFIED', DNO: 'DNO_VERIFIED',
  JUST: 'INO_VERIFIED', BANK_A: 'INO_VERIFIED', BANK_B: 'INO_VERIFIED', DUP_SRC: 'INO_VERIFIED', DUP_COPY: 'INO_VERIFIED',
  REJ_INO: 'REJECTED', REJ_DNO: 'REJECTED', DEF_EXPIRED: 'DEFECTIVE', DEF_OFFICER: 'DEFECTIVE',
  RESUB: 'INO_VERIFIED', RESUB_VERIFIED: 'DNO_VERIFIED', GATE_INELIGIBLE: 'DEFECTIVE',
};
// Submission waves (week of submission; backdated): older scenarios first.
const WAVE_OF = {
  F: [0, 1, 2], F_EXCLUDED: [1], SNO: [1, 2, 3], DNO: [2, 3], JUST: [4, 5], BANK_A: [5], BANK_B: [5], DUP_SRC: [5], DUP_COPY: [5],
  REJ_INO: [2, 3], REJ_DNO: [2], DEF_EXPIRED: [3, 4], DEF_OFFICER: [3], RESUB: [3], RESUB_VERIFIED: [2], GATE_INELIGIBLE: [4],
};
const WAVE_START = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-24'];
const MAX_PER_INSTITUTION_PER_WAVE = 4; // under the institution-surge minimum (5 in 7 days)

// Given names chosen to share none with the test fixtures (fuzzy identity matching).
const FEMALE = ['Alka', 'Amrita', 'Bimla', 'Ekta', 'Ignes', 'Jasinta', 'Kamla', 'Maliya', 'Neha', 'Olivia', 'Priti', 'Sabita', 'Shanti', 'Sheela', 'Tabita', 'Vandana', 'Anupama', 'Binita', 'Celestina', 'Dipti', 'Florence', 'Janki', 'Kusum', 'Leela', 'Monika', 'Namita', 'Pratima', 'Rosalin', 'Sujata', 'Urmila'];
const MALE = ['Abhay', 'Binod', 'Dinesh', 'Emil', 'Gyan', 'Hiren', 'Lochan', 'Nitin', 'Pradeep', 'Robin', 'Sanjay', 'Somnath', 'Uday', 'Xavier', 'Amit', 'Bishnu', 'Cyril', 'Darsan', 'Firoz', 'Gopinath', 'Jerome', 'Kailash', 'Lawrence', 'Mukesh', 'Niranjan', 'Prem', 'Rajiv', 'Samuel', 'Titus', 'Vinay'];
const SURNAMES = ['Tigga', 'Soreng', 'Kandulna', 'Topno', 'Kullu', 'Beck', 'Bilung', 'Guria', 'Jojo', 'Khalkho', 'Kispotta', 'Lomga', 'Mahli', 'Sanga', 'Aind', 'Bage', 'Dang', 'Kongari', 'Mundu', 'Tuti'];

// --------------------------------------------------------------- utilities
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const counts = {};
const note = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
const log = (...a) => console.log(...a);

async function http(method, path, { body, token, form } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form ? form() : body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(1000);
        continue;
      }
      throw err;
    }
    if (res.status === 429) {
      const h = [...res.headers].find(([k]) => k.startsWith('retry-after'));
      await sleep((Number(h?.[1] ?? 15) + 1) * 1000);
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json };
  }
}
function must(label, r, ok = [200, 201, 202]) {
  if (!ok.includes(r.status)) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// Tokens: one login per account; afterwards access tokens come from the stored
// refresh token (the refresh route is not throttled, and a second run logs in to nothing).
const access = new Map();
async function token(email, password = PW) {
  const cached = access.get(email);
  if (cached && cached.exp > Date.now()) return cached.token;
  const rt = state.refresh[email];
  if (rt) {
    const r = await http('POST', '/auth/refresh', { body: { refresh_token: rt } });
    if (r.status === 200) {
      access.set(email, { token: r.body.access_token, exp: Date.now() + (r.body.expires_in - 60) * 1000 });
      return r.body.access_token;
    }
  }
  const r = await http('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) return null;
  note('logins');
  state.refresh[email] = r.body.refresh_token;
  saveState();
  access.set(email, { token: r.body.access_token, exp: Date.now() + (r.body.expires_in - 60) * 1000 });
  return r.body.access_token;
}

/** Owner-level SQL (used only by the labelled backdating step). */
function psql(sql) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q -v ON_ERROR_STOP=1'], { cwd: REPO, input: sql });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

// ------------------------------------------------------------------ the plan
// Built entirely from the fixed seed before any call, so every run plans the same data.
function buildPlan() {
  const officers = [
    { key: 'MIN', email: `ministry.${DOMAIN}`, name: 'Ministry Scholarship Officer (demo)', role: 'MINISTRY_OFFICER' },
    { key: 'SNO', email: `sno.jharkhand.${DOMAIN}`, name: 'Jharkhand State Nodal Officer (demo)', role: 'STATE_NODAL_OFFICER', jurisdiction_state: STATE },
    ...DISTRICTS.map((d) => ({ key: `DNO:${d}`, email: `dno.${d.toLowerCase()}.${DOMAIN}`, name: `${d} District Nodal Officer (demo)`, role: 'DISTRICT_NODAL_OFFICER', jurisdiction_state: STATE, jurisdiction_district: d })),
    ...INSTITUTIONS.map((i) => ({ key: `INO:${i.code}`, email: `ino.${i.code.toLowerCase()}.${DOMAIN}`, name: `Nodal Officer, ${i.name}`, role: 'INSTITUTE_NODAL_OFFICER', jurisdiction_state: STATE, jurisdiction_district: i.district, institution_code: i.code })),
    // Generic E2E logins (E2E_DNO_* / E2E_INO_*). DNO and INO must be pinned to a district
    // (and an INO to an institution), so both sit where demo applications are: Gumla, JH-GUM-01.
    { key: 'DNO', email: `dno.jharkhand.${DOMAIN}`, name: 'Jharkhand District Nodal Officer, Gumla (demo)', role: 'DISTRICT_NODAL_OFFICER', jurisdiction_state: STATE, jurisdiction_district: 'Gumla' },
    { key: 'INO', email: `ino.jharkhand.${DOMAIN}`, name: 'Jharkhand Institute Nodal Officer, JH-GUM-01 (demo)', role: 'INSTITUTE_NODAL_OFFICER', jurisdiction_state: STATE, jurisdiction_district: 'Gumla', institution_code: 'JH-GUM-01' },
    { key: 'COMMITTEE', email: `committee.jharkhand.${DOMAIN}`, name: 'Jharkhand Selection Committee Member (demo)', role: 'COMMITTEE', jurisdiction_state: STATE },
    { key: 'AUDITOR', email: `auditor.jharkhand.${DOMAIN}`, name: 'Jharkhand Scholarship Auditor (demo)', role: 'AUDITOR', jurisdiction_state: STATE },
  ];

  const usedNames = new Set(['Reshma Tigga']); // reserved for the benign look-alike pair
  const applicants = [];
  let n = 0;
  for (const scheme of ['NFST', 'TOP_CLASS', 'POST_MATRIC']) {
    const insts = INSTITUTIONS.filter((i) => i.scheme === scheme);
    const scenarios = Object.entries(MIX[scheme]).flatMap(([s, k]) => Array(k).fill(s));
    scenarios.forEach((scenario, idx) => {
      n += 1;
      const inst = insts[idx % insts.length];
      const female = rnd() < 0.5;
      let first;
      let last;
      do {
        first = (female ? FEMALE : MALE)[int(0, 29)];
        last = SURNAMES[int(0, SURNAMES.length - 1)];
      } while (usedNames.has(`${first} ${last}`));
      usedNames.add(`${first} ${last}`);
      const yearOfStudy = scheme === 'NFST' ? (idx % 5) + 1 : int(1, scheme === 'TOP_CLASS' ? 4 : 3);
      const birthYear = scheme === 'NFST' ? int(1993, 1999) : scheme === 'TOP_CLASS' ? int(2002, 2006) : int(2003, 2008);
      const income = scenario === 'GATE_INELIGIBLE' ? 950000 : scheme === 'NFST' ? int(9, 60) * 10000 : scheme === 'TOP_CLASS' ? int(20, 70) * 10000 : int(6, 23) * 10000;
      applicants.push({
        n,
        key: `A${pad(n)}`,
        scheme,
        scenario,
        inst,
        first,
        last,
        gender: female ? 'FEMALE' : 'MALE',
        dob: `${birthYear}-${pad(int(1, 12))}-${pad(int(1, 28))}`,
        income,
        lang: rnd() < 0.35 ? 'hi' : 'en',
        caste_cert: `JH-ST-${2016 + int(0, 8)}-DM${pad(n, 3)}`,
        bank: `${['SBIN', 'BKID', 'UBIN', 'PUNB'][int(0, 3)]}000${int(1000, 9999)}:${int(3, 9)}${pad(int(0, 99999999), 8)}${int(10, 99)}`,
        yearOfStudy,
        waveChoice: WAVE_OF[scenario][int(0, WAVE_OF[scenario].length - 1)],
        day: int(0, 3),
        minute: int(10 * 60, 16 * 60 + 50),
      });
    });
  }
  // The benign look-alike pair: same name, different dates of birth, districts and accounts.
  const twinA = applicants.find((a) => a.scheme === 'TOP_CLASS' && a.scenario === 'F' && a.gender === 'FEMALE') ?? applicants.find((a) => a.scheme === 'TOP_CLASS' && a.scenario === 'F');
  const twinB = applicants.find((a) => a.scheme === 'POST_MATRIC' && a.scenario === 'DNO' && a.inst.district !== twinA.inst.district);
  for (const [t, dob] of [[twinA, '2004-02-11'], [twinB, '2006-09-27']]) Object.assign(t, { first: 'Reshma', last: 'Tigga', gender: 'FEMALE', dob, benignTwin: true });
  // One bank account, typed two ways.
  const bankA = applicants.find((a) => a.scenario === 'BANK_A');
  const bankB = applicants.find((a) => a.scenario === 'BANK_B');
  bankA.bank = 'SBIN0007781:31245678901';
  bankB.bank = 'sbin0007781 3124-5678-901';
  // TOP_CLASS's income ceiling is Rs 6 lakh (rule income_ceiling). The first run registered A23
  // with Rs 6.8 lakh (the draw above exceeded the ceiling) and the automatic gate refused its
  // application; registration income cannot be changed through the API, so A23 is the demo's
  // gate-ineligible example and A38, planned for that, is an ordinary final-list applicant.
  // Every other TOP_CLASS income drawn above the ceiling is brought Rs 2 lakh under it.
  for (const a of applicants.filter((x) => x.scheme === 'TOP_CLASS')) {
    if (a.key === 'A23') a.scenario = 'GATE_INELIGIBLE';
    else if (a.key === 'A38') Object.assign(a, { scenario: 'F', income: 450000 });
    else if (a.income >= 600000) a.income -= 200000;
  }
  // Emails: a<nn>.<first>.<last>.demo@example.org
  for (const a of applicants) a.email = `a${pad(a.n)}.${a.first.toLowerCase()}.${a.last.toLowerCase()}.${DOMAIN}`;

  // Waves: at most MAX_PER_INSTITUTION_PER_WAVE per institution (move later, else earlier).
  const load = {};
  for (const a of applicants) {
    const order = [a.waveChoice, ...[1, 2, 3, 4, 5].flatMap((d) => [a.waveChoice + d, a.waveChoice - d])].filter((w) => w >= 0 && w < WAVE_START.length);
    a.wave = order.find((w) => (load[`${a.inst.code}:${w}`] ?? 0) < MAX_PER_INSTITUTION_PER_WAVE);
    load[`${a.inst.code}:${a.wave}`] = (load[`${a.inst.code}:${a.wave}`] ?? 0) + 1;
    const d = new Date(`${WAVE_START[a.wave]}T00:00:00+05:30`);
    d.setUTCDate(d.getUTCDate() + a.day);
    a.submitAt = new Date(d.getTime() + a.minute * 60000).toISOString();
  }
  // Post-selection choices.
  const nfstFinal = applicants.filter((a) => a.scheme === 'NFST' && a.scenario === 'F');
  const sanction = [
    ...nfstFinal.filter((a) => a.yearOfStudy <= 3).slice(0, 5),
    ...applicants.filter((a) => a.scheme === 'TOP_CLASS' && a.scenario === 'F').slice(0, 3),
    ...applicants.filter((a) => a.scheme === 'POST_MATRIC' && a.scenario === 'F').slice(0, 3),
  ];
  for (const a of sanction) a.sanction = true;
  const renewApprove = sanction.find((a) => a.scheme === 'NFST' && a.yearOfStudy === 1) ?? sanction.find((a) => a.scheme === 'NFST');
  const renewPending = sanction.find((a) => a.scheme === 'NFST' && a !== renewApprove);
  renewApprove.renewal = 'APPROVE';
  renewPending.renewal = 'PENDING';
  // Bulk verification at the institute level for two institutions (workload: bulk_actions).
  const bulkInstitutions = ['JH-GUM-01', 'JH-KHU-02'];
  return { officers, applicants, bulkInstitutions };
}

// ------------------------------------------------------------- documents
// Every checklist slot, descriptive label and canonical key alike (a scheme's checklist
// names most documents both ways), maps to one kind of generated document. Slots marked
// "(if applicable)" are optional and are left empty.
const SLOT_PATTERNS = {
  caste: /^(ST certificate|ST Certificate|ST\/PVTG certificate|caste_certificate$)/,
  income: /income certificate|^income_certificate$/i,
  marksheet: /^(Marksheet\/Certificate|Master's degree|Scanned copy of certificates|Last qualified marks|marksheet$)/,
  bonafide: /^(Bona fide|bonafide_certificate$)/,
  fee: /^Fee Receipt/,
  passbook: /bank passbook/,
  domicile: /^Domicile/,
  net: /^(UGC-NET|ugc_net_scorecard$)/,
  admission: /^(Ph\.D Admission|admission_offer_letter$)/,
  matric: /^10th/,
  photo: /passport size photograph/,
  progress: /^research_progress_report$/,
  institution: /^institution_verification$/,
};
const OPTIONAL = /\(if applicable\)/i;
function kindOf(slot) {
  if (OPTIONAL.test(slot)) return null;
  const hit = Object.entries(SLOT_PATTERNS).find(([, re]) => re.test(slot));
  if (!hit) throw new Error(`no demo document kind for checklist slot "${slot}"`);
  return hit[0];
}
function docsFor(a, checklist) {
  return checklist.map((slot, i) => ({ slot, i, kind: kindOf(slot) })).filter((d) => d.kind);
}
/** Deterministic per-applicant number in [lo, hi]: document texts never depend on run order. */
const h = (a, salt, lo, hi) => lo + (((a.n * 2654435761 + salt * 40503) >>> 0) % (hi - lo + 1));
const INCOME_ISSUED = (a) => (['DEF_EXPIRED', 'RESUB', 'RESUB_VERIFIED'].includes(a.scenario) ? '2024-03-12' : `2026-0${h(a, 1, 4, 7)}-1${h(a, 2, 0, 9)}`);
function docText(a, kind, issued, slotLabel) {
  const name = `${a.first} ${a.last}`;
  const head = 'SYNTHETIC DEMO DOCUMENT - NOT A REAL CERTIFICATE - VIDYASETU PROTOTYPE';
  const L = {
    caste: ['GOVERNMENT OF JHARKHAND', 'SCHEDULED TRIBE CERTIFICATE', `Certificate No: ${a.caste_cert}`, `This is to certify that ${name}, resident of ${a.inst.district} district, Jharkhand, belongs to a Scheduled Tribe.`, 'Issuing authority: Circle Officer (synthetic)'],
    income: ['GOVERNMENT OF JHARKHAND', 'INCOME CERTIFICATE', `Certificate No: ${incomeCertNo(a, issued)}`, `Name: ${name}`, `Annual family income: Rs ${a.income}`, `Issue date: ${issued}`],
    marksheet: ['STATEMENT OF MARKS (synthetic)', `Name of candidate: ${name}`, `Examination: ${a.scheme === 'NFST' ? 'M.A. / M.Sc. final' : 'Higher Secondary (Class XII)'}`, `Percentage: ${h(a, 3, 58, 91)}%`, 'Result: PASS'],
    bonafide: [a.inst.name, 'BONA FIDE CERTIFICATE', `Certified that ${name} is a bona fide student of this institution in year ${a.yearOfStudy} of ${a.inst.course}, session ${YEAR}.`],
    fee: [a.inst.name, 'FEE RECEIPT', `Received from ${name}`, `Tuition fee for session ${YEAR}: Rs ${h(a, 4, 12, 95)}000`],
    passbook: ['BANK PASSBOOK - FIRST PAGE (synthetic)', `Account holder: ${name}`, `Account: XXXXXXX${a.bank.replace(/\D/g, '').slice(-4)}`],
    domicile: ['GOVERNMENT OF JHARKHAND', 'DOMICILE CERTIFICATE', `${name} is a permanent resident of ${a.inst.district} district, Jharkhand.`],
    net: ['JOINT CSIR-UGC NET SCORECARD (synthetic)', `Candidate: ${name}`, 'Result: Qualified for JRF', `Score: ${h(a, 5, 60, 90)}`],
    admission: [a.inst.name, 'Ph.D ADMISSION / JOINING CERTIFICATE', `${name} joined the Ph.D programme in ${a.inst.course} in year ${2026 - a.yearOfStudy}.`],
    matric: ['JHARKHAND ACADEMIC COUNCIL (synthetic)', 'MATRICULATION CERTIFICATE', `Name: ${name}`, `Date of birth: ${a.dob}`],
    photo: ['PASSPORT SIZE PHOTOGRAPH (placeholder)', `Applicant: ${name}`, 'No real photograph: synthetic demo applicant.'],
    progress: [a.inst.name, 'RESEARCH PROGRESS REPORT', `Scholar: ${name}`, `Year ${a.yearOfStudy}: coursework completed, field survey in progress; supervisor satisfied.`],
    institution: [a.inst.name, 'INSTITUTION VERIFICATION', `Institution code: ${a.inst.code}`, `Enrolment of ${name} in ${a.inst.course} verified for session ${YEAR}.`],
  };
  return [head, ...L[kind], ...(slotLabel ? [`Checklist item: ${slotLabel}`] : [])].join('\n');
}
// ML_MODE=mock "reads" what the marker says, else fixed defaults (MOCK-INC-0001 on every income
// certificate, one MOCK bank account on every passbook) - which the fraud detectors would match
// across all applicants. So every identifier the mock would read is given the applicant's own
// value, exactly as the rendered page shows it.
function markerFor(a, kind, issued) {
  const p = [`clean;holder_name=${encodeURIComponent(`${a.first} ${a.last}`)}`];
  if (kind === 'income') p.push(`issue_date=${issued}`, `family_income_annual=${a.income}`, `certificate_number=${encodeURIComponent(incomeCertNo(a, issued))}`);
  else if (kind === 'caste') p.push(`caste_cert_number=${encodeURIComponent(a.caste_cert)}`);
  else if (kind === 'passbook') p.push(`bank_account=${encodeURIComponent(a.bank)}`);
  else p.push(`document_number=${encodeURIComponent(`DEMO-${a.key}-${kind.toUpperCase()}`)}`, 'issue_date=2026-06-15');
  return p.join(';');
}
/** One number per certificate: the renewed certificate of a resubmission is a new one. */
const incomeCertNo = (a, issued) => `JH-INC-${issued.slice(0, 4)}-${a.key}`;
// PNG helpers: add the ML_MODE=mock fixture marker as a tEXt chunk before IEND.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();
function withMarker(png, marker) {
  const data = Buffer.from(`Comment\0VIDYASETU-MOCK-FIXTURE:${marker};END`, 'latin1');
  const td = Buffer.concat([Buffer.from('tEXt', 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), len, td, crc, png.subarray(iend)]);
}
function renderMany(jobs) {
  const todo = jobs.filter((j) => !existsSync(join(DOCS_DIR, `${j.key}.png`)));
  if (todo.length > 0) {
    const script = readFileSync(join(REPO, 'scripts', 'demo', 'render_docs.py'), 'utf8');
    const r = spawnSync('docker', ['compose', 'exec', '-T', 'ml', 'python', '-c', script], { cwd: REPO, input: JSON.stringify(todo), maxBuffer: 256 << 20 });
    if (r.status !== 0) throw new Error(`render failed: ${r.stderr.toString()}`);
    for (const line of r.stdout.toString().trim().split('\n')) {
      const [key, b64] = line.split(' ');
      writeFileSync(join(DOCS_DIR, `${key}.png`), Buffer.from(b64, 'base64'));
    }
    note('documents_rendered', todo.length);
  }
  return Object.fromEntries(jobs.map((j) => [j.key, readFileSync(join(DOCS_DIR, `${j.key}.png`))]));
}
async function upload(tok, appId, slot, bytes, name) {
  return http('POST', `/applications/${appId}/documents`, {
    token: tok,
    form: () => {
      const fd = new FormData();
      fd.append('document_type', slot);
      fd.append('file', new Blob([bytes], { type: 'image/png' }), name);
      return fd;
    },
  });
}
async function waitProcessed(tok, docId) {
  for (let i = 0; i < 90; i++) {
    const d = await http('GET', `/documents/${docId}`, { token: tok });
    if (d.status === 200 && d.body.state !== 'PROCESSING') return d.body;
    await sleep(1000);
  }
  throw new Error(`document ${docId} still processing after 90 s`);
}

// ------------------------------------------------------------ phase 1: officers
async function ensureOfficers(plan) {
  const admin = await token(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  if (!admin) throw new Error('the SUPER_ADMIN in demo.env cannot log in');
  for (const o of plan.officers) {
    if (await token(o.email)) continue;
    const { key: _k, ...dto } = o;
    const r = await http('POST', '/admin/officers', { token: admin, body: { ...dto, password: PW } });
    if (r.status === 201) note('officers_created');
    else if (r.status !== 409) must(`provision ${o.email}`, r);
    if (!(await token(o.email))) throw new Error(`cannot log in as ${o.email}`);
  }
}
const officerFor = (plan, key) => plan.officers.find((o) => o.key === key).email;

// -------------------------------------------------- phase 2: applicants in waves
function declaredFor(a) {
  if (a.scheme === 'NFST')
    return { education_level: LEVEL.NFST, degree_enrolled: 'Ph.D', tenure_years: a.yearOfStudy, net_csir_net_score: 55 + (a.n * 7) % 40, masters_or_4yr_bachelor_research_score: 55 + (a.n * 11) % 35 };
  // Income and year of study are recorded fields (registration income, course_year): never declared.
  if (a.scheme === 'TOP_CLASS') return { education_level: LEVEL.TOP_CLASS, notified_course_duration_years: 4 };
  return { education_level: LEVEL.POST_MATRIC, enrolled_course_duration_years: 3 };
}
async function ensureApplicant(a, versionIds) {
  let tok = await token(a.email);
  if (!tok) {
    const r = await http('POST', '/auth/register', {
      body: {
        email: a.email, password: PW, first_name: a.first, last_name: a.last, category: 'ST', domicile_state: STATE,
        domicile_district: a.inst.district, caste_cert_number: a.caste_cert, annual_income: `${a.income}.00`,
        bank_account: a.bank, gender: a.gender, dob: a.dob, preferred_language: a.lang,
      },
    });
    must(`register ${a.key}`, r, [201]);
    note('applicants_registered');
    tok = await token(a.email);
  }
  const c = must(`consents ${a.key}`, await http('GET', '/applicants/me/consents', { token: tok }));
  for (const purpose of ['application_processing', 'government_verification', 'notifications']) {
    const current = (c.purposes ?? []).find((p) => p.purpose === purpose);
    if (current?.current === true) continue; // GIVEN for the current notice version
    must(`consent ${a.key} ${purpose}`, await http('POST', '/applicants/me/consents', { token: tok, body: { purpose, status: 'GIVEN', notice_version: NOTICE, language: a.lang } }), [201]);
    note('consents_given');
  }
  const mine = must(`apps ${a.key}`, await http('GET', '/applications', { token: tok }));
  const list = Array.isArray(mine) ? mine : (mine.applications ?? mine.items ?? []);
  let app = list.find((x) => x.academic_year === YEAR);
  if (!app) {
    app = must(`apply ${a.key}`, await http('POST', '/applications', {
      token: tok,
      body: { scheme_version_id: versionIds[a.scheme], academic_year: YEAR, institution_code: a.inst.code, institution_name: a.inst.name, course_name: a.inst.course, course_year: a.yearOfStudy, is_hosteller: a.n % 3 === 0, declared: declaredFor(a) },
    }), [201]);
    note('applications_submitted');
  }
  a.appId = app.id;
  a.appNo = app.application_no;
  return tok;
}
async function ensureDocuments(a, tok, shared) {
  // Reading an application's documents is itself a logged view (document_access_log, audited):
  // once every slot is filled the seed records that in its ledger and never reads them again,
  // so a second run writes nothing. (DUP_COPY still needs DUP_SRC's file while incomplete.)
  state.docsComplete ??= {};
  if (state.docsComplete[a.key] && !(a.scenario === 'DUP_SRC' && !state.docsComplete[shared.dupCopyKey])) return;
  const docs = must(`documents ${a.key}`, await http('GET', `/applications/${a.appId}/documents`, { token: tok }));
  const filled = new Set(docs.slots.filter((s) => s.state !== 'MISSING').map((s) => s.slot));
  const wanted = docsFor(a, docs.checklist);
  const issued = INCOME_ISSUED(a);
  // The duplicate-file scenario: the first marksheet slot (the scheme's own label) of DUP_COPY
  // receives DUP_SRC's marksheet file, byte for byte.
  const dupSlot = wanted.find((w) => w.kind === 'marksheet');
  if (a.scenario === 'DUP_SRC') {
    const key = `${a.key}-s${dupSlot.i}`;
    const legacy = join(DOCS_DIR, `${a.key}-marksheet.png`); // name used by the first run
    const img = existsSync(legacy) ? readFileSync(legacy) : renderMany([{ key, text: docText(a, 'marksheet', issued, dupSlot.slot) }])[key];
    shared.dupMarksheet = withMarker(img, markerFor(a, 'marksheet', issued));
  }
  // Terminal (REJECTED) or DEFECTIVE with open items: uploads are refused or restricted to the
  // named documents (those are handled by the resubmission step).
  if ((await openItems(a, tok)).length > 0) return;
  const missing = wanted.filter((w) => !filled.has(w.slot));
  const images = renderMany(missing.map((w) => ({ key: `${a.key}-s${w.i}`, text: docText(a, w.kind, issued, w.slot) })));
  const pending = [];
  for (const w of missing) {
    let bytes = withMarker(images[`${a.key}-s${w.i}`], markerFor(a, w.kind, issued));
    if (a.scenario === 'DUP_COPY' && w === dupSlot) bytes = shared.dupMarksheet;
    const r = await upload(tok, a.appId, w.slot, bytes, `${w.kind}.png`);
    if (r.status === 409 && ['application_closed', 'slot_not_in_open_deficiency'].includes(r.body?.details?.reason)) return;
    const b = must(`upload ${a.key} ${w.kind}`, r, [200, 202]);
    note('documents_uploaded');
    if (b.document_id) pending.push(b.document_id);
  }
  for (const id of pending) await waitProcessed(tok, id);
  state.docsComplete[a.key] = true;
  saveState();
}
/** The application's open deficiency items (any status other than RESOLVED). */
async function openItems(a, tok) {
  const d = must(`deficiencies ${a.key}`, await http('GET', `/applications/${a.appId}/deficiencies`, { token: tok }));
  return d.deficiencies.filter((x) => x.status !== 'RESOLVED').flatMap((x) => x.items.filter((i) => i.status !== 'RESOLVED').map((i) => ({ ...i, deficiency_id: x.id })));
}
/**
 * A defective applicant answers the open items: a generated document for every item that
 * names a missing document and - for the resubmission scenarios - a current income
 * certificate for an expired one; then resubmits. DEF_EXPIRED applicants leave the expired
 * certificate open (they stay DEFECTIVE with that one item). Returns true when it acted.
 */
async function answerDeficiency(a) {
  const t = await token(a.email);
  const items = await openItems(a, t);
  const renew = a.scenario === 'RESUB' || a.scenario === 'RESUB_VERIFIED';
  const todo = items.filter((i) => i.check_code === 'DOCUMENT_PRESENT' || (renew && i.check_code === 'DOCUMENT_VALIDITY'));
  if (todo.length === 0) return false;
  const docs = must('docs', await http('GET', `/applications/${a.appId}/documents`, { token: t }));
  const pending = [];
  for (const i of todo) {
    const slot = i.document_slot;
    const idx = docs.checklist.indexOf(slot);
    const kind = kindOf(slot);
    const issued = kind === 'income' && renew ? '2026-08-20' : INCOME_ISSUED(a);
    const key = `${a.key}-s${idx}${kind === 'income' && renew ? '-renewed' : ''}`;
    const img = renderMany([{ key, text: docText(a, kind, issued, slot) }])[key];
    const up = await upload(t, a.appId, slot, withMarker(img, markerFor(a, kind, issued)), `${kind}.png`);
    if (up.status === 409 && up.body?.details?.reason === 'slot_not_in_open_deficiency') continue;
    const b = must(`answer ${a.key} ${slot}`, up, [200, 202]);
    note('documents_uploaded');
    if (b.document_id) pending.push(b.document_id);
  }
  for (const id of pending) await waitProcessed(t, id);
  must(`resubmit ${a.key}`, await http('POST', `/applications/${a.appId}/deficiencies/${todo[0].deficiency_id}/resubmit`, { token: t }));
  note('resubmissions');
  return true;
}
/**
 * LABELLED OWNER-LEVEL STEP (the only direct table write of the seed):
 * moves the submission of each demo application in the wave to its planned
 * date. Per application: applications.submitted_at and created_at; the
 * stage clock (stage_entered_at, stage_due_at) while the application is
 * still in the stage it entered at submission; the workflow_transitions and
 * documents rows written at submission / intake (created_at). Idempotent:
 * an application already at (or before) its planned date is left alone.
 */
function backdateWave(apps) {
  const lines = apps.map((a) => `('${a.appId}'::uuid, '${a.submitAt}'::timestamptz)`);
  const sql = `-- VIDYASETU DEMO SEED: labelled owner-level backdating of submission times (scripts/demo/seed-demo.mjs)
DO $$
DECLARE r record; v_old timestamptz; v_shift interval; n int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES ${lines.join(', ')}) AS t(app_id, target) LOOP
    SELECT a.submitted_at INTO v_old FROM applications a
      JOIN applicants p ON p.id = a.applicant_id JOIN accounts c ON c.id = p.user_id
     WHERE a.id = r.app_id AND c.email LIKE '%.${DOMAIN}';
    IF v_old IS NULL OR v_old <= r.target + interval '1 hour' THEN CONTINUE; END IF;
    v_shift := v_old - r.target;
    UPDATE applications SET submitted_at = submitted_at - v_shift, created_at = created_at - v_shift,
           stage_entered_at = CASE WHEN stage_entered_at <= v_old + interval '10 minutes' THEN stage_entered_at - v_shift ELSE stage_entered_at END,
           stage_due_at = CASE WHEN stage_entered_at <= v_old + interval '10 minutes' THEN stage_due_at - v_shift ELSE stage_due_at END
     WHERE id = r.app_id;
    UPDATE workflow_transitions SET created_at = created_at - v_shift
     WHERE application_id = r.app_id AND created_at <= v_old + interval '10 minutes';
    UPDATE documents SET created_at = created_at - v_shift, updated_at = updated_at - v_shift
     WHERE application_id = r.app_id AND created_at <= v_old + interval '60 minutes';
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'demo backdate: % application(s) moved', n;
END $$;
SELECT count(*) FROM applications WHERE id IN (${apps.map((a) => `'${a.appId}'`).join(',')}) AND submitted_at < now() - interval '1 day';`;
  writeFileSync(join(OUT, `backdate-wave.sql`), sql);
  return psql(sql);
}

// ---------------------------------------------------- phase 3: the review workflow
async function appView(plan, a) {
  return must(`read ${a.key}`, await http('GET', `/applications/${a.appId}`, { token: await token(officerFor(plan, 'MIN')) }));
}
async function act(plan, a, who, path, body) {
  const r = await http('POST', `/applications/${a.appId}/${path}`, { token: await token(who), body });
  must(`${path} ${a.key} by ${who}`, r);
  note(`action_${path.split('/')[0]}`);
  return r.body;
}
const REMARKS = {
  REJ_INO: 'The fee receipt and the bona fide certificate name a different course from the application.',
  REJ_DNO: 'The Ph.D joining certificate predates the stated research registration; not eligible for this session.',
  DEF_EXPIRED: 'The income certificate is older than twelve months. Please upload a current certificate.',
  DEF_OFFICER: 'The ST certificate carries no seal or signature of the issuing authority. Please upload an attested copy.',
};
async function drive(plan, a) {
  const ino = officerFor(plan, `INO:${a.inst.code}`);
  const dno = officerFor(plan, `DNO:${a.inst.district}`);
  const sno = officerFor(plan, 'SNO');
  for (let step = 0; step < 8; step++) {
    const v = await appView(plan, a);
    const stage = v.current_stage;
    const target = TARGET_STAGE[a.scenario];
    // A defective applicant (resubmission scenarios, and DEF_EXPIRED for its missing documents)
    // answers the open items first; afterwards the planned stage decides.
    if (stage === 'DEFECTIVE' && ['RESUB', 'RESUB_VERIFIED', 'DEF_EXPIRED'].includes(a.scenario) && (await answerDeficiency(a))) continue;
    if (stage === target && !(a.scenario === 'RESUB' || a.scenario === 'RESUB_VERIFIED')) return stage;
    const defs = must(`deficiencies ${a.key}`, await http('GET', `/applications/${a.appId}/deficiencies`, { token: await token(ino) })).deficiencies;
    if (a.scenario === 'RESUB' || a.scenario === 'RESUB_VERIFIED') {
      if (stage === 'INO_VERIFIED' && defs.length === 0) {
        await act(plan, a, ino, 'deficiencies', { reason: REMARKS.DEF_EXPIRED });
        continue;
      }
      if (stage === 'DEFECTIVE') throw new Error(`${a.key}: DEFECTIVE with nothing left to answer`);
      if (a.scenario === 'RESUB' && stage === 'INO_VERIFIED') return stage;
      if (a.scenario === 'RESUB_VERIFIED' && stage === 'INO_VERIFIED') {
        await act(plan, a, ino, 'verify', v.needs_eligibility_review ? { eligibility_review_confirmed: true } : {});
        continue;
      }
      if (stage === target) return stage;
    }
    if (a.scenario === 'DEF_EXPIRED' && stage === 'INO_VERIFIED' && defs.length === 0) {
      await act(plan, a, ino, 'deficiencies', { reason: REMARKS.DEF_EXPIRED });
      continue;
    }
    if (a.scenario === 'DEF_OFFICER' && stage === 'INO_VERIFIED' && defs.length === 0) {
      const docs = must('docs', await http('GET', `/applications/${a.appId}/documents`, { token: await token(ino) }));
      const casteSlot = docs.checklist.find((s) => SLOT_PATTERNS.caste.test(s));
      await act(plan, a, ino, 'deficiencies', { reason: REMARKS.DEF_OFFICER, include_failed_checks: false, items: [{ document_slot: casteSlot, check_code: 'OFFICER', problem_code: 'deficiency.problem.not_attested' }] });
      continue;
    }
    if (a.scenario === 'REJ_INO' && stage === 'INO_VERIFIED') {
      await act(plan, a, ino, 'reject', { remarks: REMARKS.REJ_INO });
      continue;
    }
    if (a.scenario === 'REJ_DNO' && stage === 'DNO_VERIFIED') {
      await act(plan, a, dno, 'reject', { remarks: REMARKS.REJ_DNO });
      continue;
    }
    const forward = { INO_VERIFIED: ino, DNO_VERIFIED: dno, SNO_VERIFIED: sno }[stage];
    const order = ['INO_VERIFIED', 'DNO_VERIFIED', 'SNO_VERIFIED', 'MINISTRY_APPROVED'];
    if (forward && order.indexOf(stage) < order.indexOf(target === 'REJECTED' ? 'DNO_VERIFIED' : target)) {
      await act(plan, a, forward, 'verify', v.needs_eligibility_review && stage === 'INO_VERIFIED' ? { eligibility_review_confirmed: true } : {});
      continue;
    }
    return stage;
  }
  throw new Error(`${a.key} did not reach ${TARGET_STAGE[a.scenario]}`);
}
async function bulkVerify(plan) {
  for (const code of plan.bulkInstitutions) {
    const ino = officerFor(plan, `INO:${code}`);
    const ids = [];
    for (const a of plan.applicants.filter((x) => x.inst.code === code && ['F', 'F_EXCLUDED', 'SNO', 'DNO'].includes(x.scenario))) {
      if ((await appView(plan, a)).current_stage === 'INO_VERIFIED') ids.push(a.appId);
    }
    if (ids.length === 0) continue;
    const r = must(`bulk ${code}`, await http('POST', '/applications/bulk-actions', { token: await token(ino), body: { action: 'VERIFY', application_ids: ids } }));
    note('bulk_verified', r.changed ?? 0);
    log(`  bulk VERIFY by ${ino}: requested ${r.requested}, changed ${r.changed}, skipped ${r.skipped} (batch ${r.batch_id})`);
  }
}

// ---------------------------------------------------- phase 4: selection lists
const OVERRIDE_REASON = 'Admission letter shows the programme starts in the next session; not eligible for the 2025-26 award.';
const CLOSE_REASON = 'Committee met on the objection window and recorded no pending objections for this list.';
async function ensureList(plan, scheme) {
  const min = await token(officerFor(plan, 'MIN'));
  const com = await token(officerFor(plan, 'COMMITTEE'));
  let lists = must('lists', await http('GET', `/selection-lists?scheme=${scheme}&academic_year=${YEAR}`, { token: min })).lists;
  if (lists.length === 0) {
    const r = must(`run-selection ${scheme}`, await http('POST', `/schemes/${scheme}/academic-years/${YEAR}/run-selection`, { token: min, body: {} }));
    note('selection_runs');
    log(`  run-selection ${scheme} ${YEAR}: list ${r.selection_list_id} counts ${JSON.stringify(r.counts)}`);
    lists = must('lists', await http('GET', `/selection-lists?scheme=${scheme}&academic_year=${YEAR}`, { token: min })).lists;
  }
  const listId = lists[0].id;
  for (let i = 0; i < 6; i++) {
    const list = must('list', await http('GET', `/selection-lists/${listId}`, { token: com }));
    if (list.status === 'FINAL_PUBLISHED') return list;
    if (list.status === 'DRAFT') {
      const excluded = plan.applicants.find((a) => a.scheme === scheme && a.scenario === 'F_EXCLUDED');
      const entry = excluded && list.entries.find((e) => e.application_id === excluded.appId);
      if (entry && !entry.committee_decision) {
        must('override', await http('POST', `/selection-lists/${listId}/entries/${entry.id}/override`, { token: com, body: { decision: 'EXCLUDE', reason: OVERRIDE_REASON } }));
        note('committee_overrides');
      }
      const ap = await http('POST', `/selection-lists/${listId}/approve`, { token: com, body: {} });
      if (ap.status !== 409) must('approve', ap);
      must('publish provisional', await http('POST', `/selection-lists/${listId}/publish-provisional`, { token: min, body: {} }));
      note('lists_published_provisional');
    } else if (list.status === 'PROVISIONAL_PUBLISHED') {
      must('close window early', await http('POST', `/selection-lists/${listId}/close-objection-window-early`, { token: com, body: { reason: CLOSE_REASON } }));
    } else if (list.status === 'OBJECTION_WINDOW_CLOSED') {
      must('publish final', await http('POST', `/selection-lists/${listId}/publish-final`, { token: min, body: {} }));
      note('lists_published_final');
    }
  }
  throw new Error(`list ${listId} did not reach FINAL_PUBLISHED`);
}

// ---------------------------------------- phase 5: sanction, disbursement, renewals
async function selectionsByApp(plan) {
  const min = await token(officerFor(plan, 'MIN'));
  const out = new Map();
  for (const scheme of ['NFST', 'TOP_CLASS', 'POST_MATRIC']) {
    for (let page = 1; page < 50; page++) {
      const b = must('selections', await http('GET', `/selections?scheme=${scheme}&academic_year=${YEAR}&page=${page}&page_size=100`, { token: min }));
      const rows = Object.values(b).find(Array.isArray) ?? [];
      for (const s of rows) out.set(s.application_id, { ...s, id: s.selection_id });
      if (rows.length < 100) break;
    }
  }
  return out;
}
async function postSelection(plan) {
  const min = await token(officerFor(plan, 'MIN'));
  const sel = await selectionsByApp(plan);
  for (const a of plan.applicants.filter((x) => x.sanction)) {
    const s = sel.get(a.appId);
    if (!s) throw new Error(`${a.key} has no selection`);
    if (s.selection_status === 'PROVISIONAL') {
      must(`confirm ${a.key}`, await http('POST', `/selections/${s.id}/confirm`, { token: min, body: { override_reason: 'Final list published; the committee closed the objection window early with no pending objections.' } }));
      note('selections_confirmed');
    }
    const so = await http('POST', `/selections/${s.id}/sanction-order`, { token: min, body: {} });
    if (so.status === 201) note('sanction_orders');
    else if (!(so.status === 409 && so.body?.details?.reason === 'sanction_order_exists')) must(`sanction ${a.key}`, so);
    a.sanctionOrderId = so.body?.sanction_order_id ?? so.body?.details?.sanction_order_id;
    const sc = await http('POST', `/selections/${s.id}/disbursements`, { token: min, body: {} });
    if (sc.status === 201 || sc.status === 200) {
      if ((sc.body.instalments ?? []).length > 0) note('disbursement_instalments', sc.body.instalments.length);
      a.schedule = sc.body.disbursement_mode === 'FORWARDED_TO_STATE' ? 'FORWARDED_TO_STATE' : sc.body.release_cadence;
    } else if (!(sc.status === 409 && sc.body?.details?.reason === 'schedule_exists')) must(`schedule ${a.key}`, sc);
  }
  // Renewals (NFST): one approved for the next year, one submitted and waiting.
  for (const a of plan.applicants.filter((x) => x.renewal)) {
    const t = await token(a.email);
    const existing = must('renewals', await http('GET', `/applications/${a.appId}/renewals`, { token: t }));
    const rows = Array.isArray(existing) ? existing : (Object.values(existing).find(Array.isArray) ?? []);
    let ren = rows.find((r) => r.academic_year === RENEWAL_YEAR);
    if (!ren) {
      ren = must(`renew ${a.key}`, await http('POST', `/applications/${a.appId}/renewals`, {
        token: t,
        body: { academic_year: RENEWAL_YEAR, academic_year_number: a.yearOfStudy + 1, passed_previous_year: true, percentage_obtained: 60 + (a.n % 25), progress_report: 'Completed the coursework and the field survey; the research advisory committee approved the synopsis.' },
      }), [201]);
      note('renewals_submitted');
    }
    if (a.renewal !== 'APPROVE') continue;
    const ino = await token(officerFor(plan, `INO:${a.inst.code}`));
    if (ren.verification_status === 'PENDING') {
      ren = must('endorse', await http('POST', `/renewals/${ren.id}/endorse`, { token: ino, body: { remarks: 'Progress report checked against the department record.' } }));
    }
    if (ren.verification_status === 'ENDORSED' && !ren.continuation_verdict) {
      must('continuation', await http('POST', `/renewals/${ren.id}/continuation-check`, { token: min, body: {} }));
      ren = { ...ren, continuation_verdict: 'checked' };
    }
    if (ren.verification_status === 'ENDORSED') {
      must('decide', await http('POST', `/renewals/${ren.id}/decide`, { token: min, body: { decision: 'APPROVE', remarks: 'Continuation approved for the next year of the fellowship.' } }));
      note('renewals_approved');
    }
  }
}

// ------------------------------------------------------------------------ main
function writeLogins(plan) {
  const L = ['# VIDYASETU demo logins (generated by scripts/demo/seed-demo.mjs; NOT in the repository)', '', `Password for every demo account: DEMO_PASSWORD in ${join(OUT, 'demo.env')}`, `SUPER_ADMIN: ${ENV.ADMIN_EMAIL} (ADMIN_PASSWORD in demo.env; an existing account - the API cannot create a SUPER_ADMIN)`, '', '## Officers', '', '| Role | Email | Jurisdiction |', '|---|---|---|'];
  for (const o of plan.officers) L.push(`| ${o.role} | ${o.email} | ${[o.jurisdiction_state ?? 'national', o.jurisdiction_district, o.institution_code].filter(Boolean).join(' / ')} |`);
  L.push('', '## Applicants', '', '| Key | Email | Scheme | Scenario | District | Institution | Language | Application |', '|---|---|---|---|---|---|---|---|');
  for (const a of plan.applicants) L.push(`| ${a.key} | ${a.email} | ${a.scheme}${a.scheme === 'NFST' ? ` (Ph.D year ${a.yearOfStudy})` : ''} | ${a.scenario}${a.benignTwin ? ' + benign look-alike' : ''}${a.sanction ? ' + sanctioned' : ''}${a.renewal ? ` + renewal ${a.renewal}` : ''} | ${a.inst.district} | ${a.inst.code} | ${a.lang} | ${a.appNo ?? ''} |`);
  writeFileSync(join(OUT, 'logins.md'), L.join('\n') + '\n', { mode: 0o600 });
}

async function main() {
  const plan = buildPlan();
  log(`demo seed ${SEED}: ${plan.applicants.length} applicants, ${plan.officers.length} officers, academic year ${YEAR}; state in ${OUT}`);

  log('phase 1: officers');
  await ensureOfficers(plan);

  const min = await token(officerFor(plan, 'MIN'));
  const versionIds = {};
  for (const [code, v] of Object.entries(VERSION_NO)) {
    const fs = must(`form-schema ${code}`, await http('GET', `/schemes/${code}/versions/${v}/form-schema`, { token: min }));
    versionIds[code] = fs.scheme_version_id;
  }

  log('phase 2: applicants, consent, applications and documents, in backdated weekly waves');
  const shared = { dupCopyKey: plan.applicants.find((x) => x.scenario === 'DUP_COPY').key };
  for (let w = 0; w < WAVE_START.length; w++) {
    const wave = plan.applicants.filter((a) => a.wave === w).sort((x, y) => (x.scenario === 'DUP_COPY') - (y.scenario === 'DUP_COPY'));
    for (const a of wave) {
      const tok = await ensureApplicant(a, versionIds);
      await ensureDocuments(a, tok, shared);
    }
    const moved = backdateWave(wave);
    log(`  wave ${w} (${WAVE_START[w]}): ${wave.length} applications; submitted more than a day ago now: ${moved}`);
  }

  // Fraud detection runs at workflow transitions and before forward actions. The duplicate-file
  // pair waits at the institute with its documents uploaded after submission, so the institute
  // officer runs the fraud checks on it (POST /applications/:id/fraud-checks), once.
  log('phase 2b: institute officer runs the fraud checks on the duplicate-file pair');
  for (const a of plan.applicants.filter((x) => x.scenario === 'DUP_SRC' || x.scenario === 'DUP_COPY')) {
    const ino = await token(officerFor(plan, `INO:${a.inst.code}`));
    const flags = must(`flags ${a.key}`, await http('GET', `/applications/${a.appId}/fraud-flags`, { token: ino }));
    const list = flags.flags ?? [];
    if (list.some((f) => f.flag_type === 'DUPLICATE_FILE_HASH')) continue;
    const r = must(`fraud-checks ${a.key}`, await http('POST', `/applications/${a.appId}/fraud-checks`, { token: ino }));
    note('fraud_checks_run');
    log(`  fraud checks ${a.key} (${a.scenario}): new flags ${r.run?.new_flags ?? '?'}`);
  }

  log('phase 3: review workflow (bulk at two institutes, then every application to its planned stage)');
  await bulkVerify(plan);
  for (const a of plan.applicants) {
    const stage = await drive(plan, a);
    a.stage = stage;
  }

  log('phase 4: selection lists (committee override on TOP_CLASS)');
  for (const scheme of ['NFST', 'TOP_CLASS', 'POST_MATRIC']) {
    const list = await ensureList(plan, scheme);
    log(`  ${scheme} ${YEAR}: list ${list.id} ${list.status}, ${list.entries.length} entries`);
  }

  log('phase 5: sanction orders, disbursement schedules, renewals; SLA sweep');
  await postSelection(plan);
  const sa = await token(ENV.ADMIN_EMAIL, ENV.ADMIN_PASSWORD);
  const sweep = must('sla sweep', await http('POST', '/applications/sla-breaches/sweep', { token: sa, body: {} }));
  if (sweep.newly_recorded > 0) note('sla_breaches_recorded', sweep.newly_recorded);

  writeLogins(plan);
  log(`done. changes made by this run: ${Object.keys(counts).length === 0 ? 'none' : JSON.stringify(counts)}`);
}

export { buildPlan };

// Runs only when executed directly (importing the module, e.g. to inspect the plan, seeds nothing).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('SEED FAILED:', err.message);
    process.exit(1);
  });
}
