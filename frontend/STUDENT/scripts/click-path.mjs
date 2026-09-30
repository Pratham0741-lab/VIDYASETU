#!/usr/bin/env node
/**
 * Click-path proof for the student portal: drives the same API calls the UI
 * makes, in the UI's order, against the running backend.
 *
 *   node scripts/click-path.mjs [--register-if-missing] [--read-only]
 *
 * --read-only: only the read checks below (public scheme list, stage history
 * with and without a token, selection result) plus login/logout; nothing is
 * written. Use it with a demo account.
 *
 * Reads E2E_EMAIL and E2E_PASSWORD (and optionally E2E_OFFICER_EMAIL /
 * E2E_OFFICER_PASSWORD) from .env.local and VITE_API_BASE_URL from .env.
 * Never prints credentials, tokens, request bodies or personal data: only
 * HTTP statuses, codes, counts and field names.
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ------------------------------------------------------------------ config
function readEnv(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env };
const BASE = (env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/+$/, '');
const EMAIL = env.E2E_EMAIL;
const PASSWORD = env.E2E_PASSWORD;
const REGISTER = process.argv.includes('--register-if-missing');
const READ_ONLY = process.argv.includes('--read-only');
if (!EMAIL || !PASSWORD) {
  console.error('E2E_EMAIL and E2E_PASSWORD must be set in .env.local');
  process.exit(2);
}

// ------------------------------------------------------------------ http
let access = null;
let refresh = null;
let failures = 0;

async function call(method, path, { body, form, auth = true, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth && access) headers.Authorization = `Bearer ${access}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const requestId = res.headers.get('x-request-id');
  if (raw) return { status: res.status, requestId, blob: await res.blob() };
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, requestId, data };
}

function step(name, res, expect, extra = '') {
  const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
  if (!ok) failures++;
  const code = res.data && res.data.code ? ` ${res.data.code}` : '';
  const reason = res.data?.details?.reason ? ` reason=${res.data.details.reason}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} HTTP ${res.status}${code}${reason}${extra ? `  ${extra}` : ''}`);
  return ok;
}

/** A small valid white PNG (synthetic test image). */
function syntheticPng(width = 600, height = 800) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  for (let y = 100; y < height - 100; y += 40) rows.fill(0x20, y * (width * 3 + 1) + 1 + 150, y * (width * 3 + 1) + 1 + 1650);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ path
console.log(`API ${BASE}`);

// 1. Login (register first only when asked and the account does not exist).
let res = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD }, auth: false });
if (res.status === 401 && REGISTER) {
  const id = Math.random().toString(16).slice(2, 10);
  const reg = await call('POST', '/auth/register', {
    auth: false,
    body: {
      email: EMAIL,
      password: PASSWORD,
      first_name: 'E2E',
      last_name: 'Clickpath',
      category: 'ST',
      domicile_state: 'Jharkhand',
      domicile_district: 'Ranchi',
      caste_cert_number: `STC-E2E-${id}`,
      annual_income: '150000.00',
      bank_account: `SBIN0000002:${Date.now()}`,
      gender: 'OTHER',
      dob: '2002-01-15',
      preferred_language: 'en',
    },
  });
  step('register synthetic applicant', reg, 201, `fields=${Object.keys(reg.data ?? {}).join(',')}`);
  res = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD }, auth: false });
}
if (!step('login', res, 200, `fields=${Object.keys(res.data ?? {}).join(',')}`)) process.exit(1);
access = res.data.access_token;
refresh = res.data.refresh_token;

res = await call('GET', '/auth/me');
step('auth/me role check', res, 200, `role=${res.data?.role}`);
if (res.data?.role !== 'APPLICANT') {
  console.log('FAIL  account is not an APPLICANT; the portal would refuse it');
  process.exit(1);
}

res = await call('GET', '/applicants/me');
step('applicant profile', res, 200, `preferred_language=${res.data?.preferred_language} supported=${res.data?.supported_languages?.join('/')}`);

// Read checks for the F1-B routes (also the whole run in --read-only mode).
{
  const pub = await call('GET', '/schemes', { auth: false });
  step('GET /schemes without a token', pub, 200, `schemes=${pub.data?.schemes?.length ?? 0}`);
  if (!(pub.data?.schemes?.length > 0)) {
    failures++;
    console.log('FAIL  GET /schemes returned an empty list');
  }
  const apps = await call('GET', '/applications');
  step('own applications', apps, 200, `count=${apps.data?.length ?? 0}`);
  const own = apps.data?.[0];
  if (own) {
    const h = await call('GET', `/applications/${own.id}/history`);
    const entries = h.data?.history ?? [];
    step('history of own application', h, 200, `entries=${entries.length} dated=${entries.filter((e) => typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at))).length} actions=${[...new Set(entries.map((e) => e.trigger_action))].join(',')}`);
    step('history without a token -> 401', await call('GET', `/applications/${own.id}/history`, { auth: false }), 401);
    const sr = await call('GET', `/applications/${own.id}/selection-result`);
    step('selection result (published or 404)', sr, [200, 404], sr.status === 200 ? `list.status=${sr.data?.list?.status} selection_run_id=${sr.data?.list?.selection_run_id ? 'present' : 'null'}` : '');
  } else {
    console.log('SKIP  history checks: this account has no application');
  }
}

if (READ_ONLY) {
  res = await call('POST', '/auth/logout', { auth: false, body: { refresh_token: refresh } });
  step('logout', res, 204);
  console.log(failures === 0 ? '\nclick-path (read-only): all steps passed' : `\nclick-path (read-only): ${failures} step(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

// 2. Consent: read notices, give missing required purposes.
res = await call('GET', '/applicants/me/consents');
step('consents: notices', res, 200, `notice=${res.data?.notice_version} purposes=${res.data?.purposes?.map((p) => p.purpose).join(',')} missing=${res.data?.missing_for_applications?.length}`);
const consents = res.data;
for (const p of consents.purposes.filter((x) => !x.current)) {
  const r = await call('POST', '/applicants/me/consents', { body: { purpose: p.purpose, status: 'GIVEN', notice_version: consents.notice_version, language: consents.language } });
  step(`consent give ${p.purpose}`, r, 201, `missing_after=${r.data?.missing_for_applications?.length}`);
}

// 3. Eligibility (public routes, as on the landing page).
res = await call('POST', '/schemes/check-eligibility', { auth: false, body: { applicant: {} } });
const all = res.data ? [...res.data.eligible, ...res.data.not_eligible, ...res.data.indeterminate] : [];
step('eligibility: scheme list (empty profile)', res, 200, `schemes=${all.length}`);
res = await call('POST', '/schemes/check-eligibility', { auth: false, body: { applicant: { category: 'ST', family_income_annual: 268000 } } });
step('eligibility: ST, income 268000', res, 200, `eligible=${res.data?.eligible.length} not_eligible=${res.data?.not_eligible.length} indeterminate=${res.data?.indeterminate.length}`);
const pm = all.find((s) => s.scheme_code === 'POST_MATRIC') ?? all[0];
res = await call('GET', `/schemes/${pm.scheme_code}/versions/${pm.version_no}/form-schema`, { auth: false });
const form = res.data;
const limit = form?.fields.find((f) => f.key === 'family_income_annual')?.limits?.[0]?.value;
step(`form-schema ${pm.scheme_code} v${pm.version_no}`, res, 200, `fields=${form?.fields.length} checklist=${form?.documents.checklist.length} income_limit=${limit}`);

// 4. Draft, then submit; first with a required consent withdrawn (409), then given.
const recorded = new Set(['category', 'pvtg_group', 'gender', 'is_disabled', 'disability_percentage', 'domicile_state', 'domicile_district', 'family_income_annual', 'age', 'academic_year_number', 'institution_name', 'institution_code', 'course_name', 'is_hosteller']);
const declared = {};
for (const f of form.fields.filter((x) => !recorded.has(x.key))) {
  if (f.options.length) declared[f.key] = f.options[0];
  else if (f.types.includes('number')) declared[f.key] = 3;
}
const dto = { scheme_version_id: pm.scheme_version_id, academic_year: '2026-27', institution_name: 'E2E Test College', course_name: 'BA', course_year: 1, is_hosteller: false, declared };
res = await call('POST', '/application-drafts', { body: dto });
step('save draft', res, 201, `status=${res.data?.status}`);
const draftId = res.data?.id;

const required = consents.purposes.find((p) => p.required_for_applications);
res = await call('POST', '/applicants/me/consents', { body: { purpose: required.purpose, status: 'WITHDRAWN', notice_version: consents.notice_version, language: consents.language } });
step(`consent withdraw ${required.purpose}`, res, 201);
res = await call('POST', `/application-drafts/${draftId}/submit`);
step('submit without consent -> 409 consent_required', res, 409, `message_key=${res.data?.details?.message_key}`);
res = await call('POST', '/applicants/me/consents', { body: { purpose: required.purpose, status: 'GIVEN', notice_version: consents.notice_version, language: consents.language } });
step(`consent give ${required.purpose} (from consent screen)`, res, 201);
res = await call('POST', `/application-drafts/${draftId}/submit`);
const app = res.data?.application;
step('submit draft', res, [200, 201], `stage=${app?.current_stage} gate=${app?.eligibility_gate?.outcome}`);

// 5. Upload, then poll.
res = await call('GET', `/applications/${app.id}/documents`);
step('document checklist', res, 200, `slots=${res.data?.slots?.length} ml_mode=${res.data?.ml_mode}`);
const slot = res.data.checklist.includes('income_certificate') ? 'income_certificate' : res.data.checklist[0];
const fd = new FormData();
fd.append('document_type', slot);
fd.append('file', new Blob([syntheticPng()], { type: 'image/png' }), 'synthetic-e2e.png');
res = await call('POST', `/applications/${app.id}/documents`, { form: fd });
step(`upload ${slot}`, res, [200, 202], `status=${res.data?.status} quality.usable=${res.data?.quality?.usable}`);
const docId = res.data?.document_id;
let state = res.data?.status;
for (let i = 0; i < 20 && state === 'PROCESSING'; i++) {
  await sleep(1500);
  const d = await call('GET', `/documents/${docId}`);
  state = d.data?.state;
  if (state !== 'PROCESSING') step(`poll document (${i + 1} polls)`, d, 200, `state=${state} verification_status=${d.data?.verification_status}`);
}
res = await call('POST', `/applications/${app.id}/documents`, { form: (() => { const f = new FormData(); f.append('document_type', slot); f.append('file', new Blob(['not a document'], { type: 'text/plain' }), 'x.txt'); return f; })() });
step('upload text/plain (refused)', res, [400, 415, 422]);

// 6. Deficiencies and resubmit (the synthetic application is not DEFECTIVE).
res = await call('GET', `/applications/${app.id}/deficiencies`);
step('list deficiencies', res, 200, `deficiencies=${res.data?.deficiencies?.length} stage=${res.data?.current_stage}`);
res = await call('POST', `/applications/${app.id}/resubmit`, { body: {} });
step('resubmit when not DEFECTIVE -> 409', res, 409);

// 7. Selection result.
res = await call('GET', `/applications/${app.id}/selection-result`);
step('selection result (none published -> 404)', res, [200, 404]);

// 8. Dashboard data: application, notifications, mark read.
res = await call('GET', `/applications/${app.id}`);
step('application status', res, 200, `stage=${res.data?.current_stage} status=${res.data?.status} due=${res.data?.stage_due_at ? 'set' : 'none'}`);
res = await call('GET', '/notifications');
step('notifications', res, 200, `count=${res.data?.count} unread=${res.data?.notifications?.filter((n) => !n.read_at).length}`);
const unread = res.data?.notifications?.find((n) => !n.read_at);
if (unread) step('mark notification read', await call('POST', `/notifications/${unread.id}/read`), [200, 201]);

// 9. Session: refresh gives a new access token; logout revokes the refresh token.
res = await call('POST', '/auth/refresh', { auth: false, body: { refresh_token: refresh } });
step('refresh access token', res, 200);
res = await call('POST', '/auth/logout', { auth: false, body: { refresh_token: refresh } });
step('logout', res, 204);
res = await call('POST', '/auth/refresh', { auth: false, body: { refresh_token: refresh } });
step('refresh after logout -> 401', res, 401);

// 10. Role gating: an officer account is refused by the portal.
if (env.E2E_OFFICER_EMAIL && env.E2E_OFFICER_PASSWORD) {
  access = null;
  res = await call('POST', '/auth/login', { auth: false, body: { email: env.E2E_OFFICER_EMAIL, password: env.E2E_OFFICER_PASSWORD } });
  step('officer login', res, 200);
  access = res.data?.access_token;
  const me = await call('GET', '/auth/me');
  const refused = me.data?.role !== 'APPLICANT';
  console.log(`${refused ? 'PASS' : 'FAIL'}  ${'portal role gate'.padEnd(46)} role=${me.data?.role} -> ${refused ? 'refused and logged out' : 'NOT refused'}`);
  if (!refused) failures++;
  await call('POST', '/auth/logout', { auth: false, body: { refresh_token: res.data?.refresh_token } });
} else {
  console.log('SKIP  officer role gate: E2E_OFFICER_EMAIL / E2E_OFFICER_PASSWORD not set');
}

console.log(failures === 0 ? '\nclick-path: all steps passed' : `\nclick-path: ${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
