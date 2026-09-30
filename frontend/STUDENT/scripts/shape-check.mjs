#!/usr/bin/env node
/**
 * Live shape check: for each configured account, calls every GET the UI
 * uses (plus the public eligibility POST) and prints ONLY field names and
 * JSON types. Values are printed only for fields named status, stage,
 * severity, outcome, reason_code or trigger_action (or ending in _status, _stage, _outcome).
 * Output: docs/live-shapes/<account>.txt. Read only: no writes.
 *
 * Accounts from .env.local: E2E_* (deficiency), E2E_RESULT_*, E2E_SANCTIONED_*.
 * Credentials, tokens and other values are never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
const ACCOUNTS = [
  ['deficiency', env.E2E_EMAIL, env.E2E_PASSWORD],
  ['result', env.E2E_RESULT_EMAIL, env.E2E_RESULT_PASSWORD],
  ['sanctioned', env.E2E_SANCTIONED_EMAIL, env.E2E_SANCTIONED_PASSWORD],
].filter(([, e, p]) => e && p);

const VALUE_KEYS = /^(status|stage|severity|outcome|reason_code|trigger_action)$|_(status|stage|outcome)$/;

/** Merges the shape of a JSON value into a type tree. */
function shapeOf(v) {
  if (v === null) return { t: new Set(['null']) };
  if (Array.isArray(v)) {
    const node = { t: new Set(['array']), items: null, n: v.length };
    for (const x of v) node.items = merge(node.items, shapeOf(x));
    return node;
  }
  if (typeof v === 'object') {
    const node = { t: new Set(['object']), fields: {} };
    for (const [k, x] of Object.entries(v)) node.fields[k] = shapeOf(x);
    return node;
  }
  return { t: new Set([typeof v]) };
}
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { t: new Set([...a.t, ...b.t]) };
  if (a.fields || b.fields) {
    out.fields = { ...(a.fields ?? {}) };
    for (const [k, v] of Object.entries(b.fields ?? {})) out.fields[k] = merge(out.fields[k], v);
    // fields missing on one side are optional
    for (const k of Object.keys(out.fields)) if (!(a.fields && k in a.fields) || !(b.fields && k in b.fields)) out.fields[k].optional = true;
  }
  if (a.items || b.items) out.items = merge(a.items, b.items);
  if ('n' in a || 'n' in b) out.n = (a.n ?? 0) + (b.n ?? 0);
  return out;
}
/** Collects the distinct values of the allowed keys. */
function values(v, acc = {}) {
  if (Array.isArray(v)) v.forEach((x) => values(x, acc));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (VALUE_KEYS.test(k) && (typeof x === 'string' || x === null)) (acc[k] ??= new Set()).add(String(x));
      values(x, acc);
    }
  return acc;
}
function render(node, indent = '  ', name = '') {
  const types = [...node.t].sort().join('|');
  const lines = [`${indent}${name}${name ? (node.optional ? '?: ' : ': ') : ''}${types}${node.t.has('array') ? ` (${node.n} items)` : ''}`];
  if (node.fields) for (const k of Object.keys(node.fields).sort()) lines.push(...render(node.fields[k], indent + '  ', k));
  if (node.items) lines.push(...render(node.items, indent + '  ', '[]'));
  return lines;
}

async function call(token, method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  let data = null;
  if (ct.includes('json')) data = await res.json().catch(() => null);
  else await res.arrayBuffer();
  return { status: res.status, ct: ct.split(';')[0], data };
}

mkdirSync('docs/live-shapes', { recursive: true });
for (const [label, email, password] of ACCOUNTS) {
  const out = [`# Live shapes: ${label} account (${new Date().toISOString().slice(0, 10)})`, `# API ${BASE}. Field names and JSON types only; values only for status/stage/severity/outcome/reason_code.`, ''];
  const record = (title, res) => {
    out.push(`## ${title} -> HTTP ${res.status}${res.ct && !res.ct.includes('json') ? ` (${res.ct})` : ''}`);
    if (res.data !== null && res.data !== undefined) {
      out.push(...render(shapeOf(res.data)));
      const vals = values(res.data);
      for (const [k, set] of Object.entries(vals)) out.push(`  values ${k}: ${[...set].sort().join(', ')}`);
    }
    out.push('');
  };
  const login = await call(null, 'POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    out.push(`login -> HTTP ${login.status} ${login.data?.code ?? ''}`);
    writeFileSync(`docs/live-shapes/${label}.txt`, out.join('\n'));
    console.log(`${label}: login failed HTTP ${login.status}`);
    continue;
  }
  const token = login.data.access_token;
  const refresh = login.data.refresh_token;
  record('POST /auth/login (field names only)', { ...login, data: Object.fromEntries(Object.keys(login.data).map((k) => [k, typeof login.data[k] === 'number' ? 0 : ''])) });
  record('GET /auth/me', await call(token, 'GET', '/auth/me'));
  record('GET /applicants/me', await call(token, 'GET', '/applicants/me'));
  record('GET /applicants/me/consents', await call(token, 'GET', '/applicants/me/consents'));
  record('GET /application-drafts', await call(token, 'GET', '/application-drafts'));
  record('GET /notifications', await call(token, 'GET', '/notifications'));
  const apps = await call(token, 'GET', '/applications');
  record('GET /applications', apps);
  for (const [i, app] of (apps.data ?? []).entries()) {
    const id = app.id;
    const tag = `application #${i + 1}`;
    record(`GET /applications/{id} (${tag})`, await call(token, 'GET', `/applications/${id}`));
    record(`GET /applications/{id}/history (${tag})`, await call(token, 'GET', `/applications/${id}/history`));
    const docs = await call(token, 'GET', `/applications/${id}/documents`);
    record(`GET /applications/{id}/documents (${tag})`, docs);
    const firstDoc = docs.data?.documents?.[0]?.document_id;
    if (firstDoc) record(`GET /documents/{id} (${tag}, first document)`, await call(token, 'GET', `/documents/${firstDoc}`));
    const defs = await call(token, 'GET', `/applications/${id}/deficiencies`);
    record(`GET /applications/{id}/deficiencies (${tag})`, defs);
    const items = (defs.data?.deficiencies ?? []).flatMap((d) => d.items ?? []);
    const item = items.find((x) => x.crop_ref) ?? items[0];
    if (item) {
      const crop = await call(token, 'GET', `/applications/${id}/deficiencies/items/${item.id}/crop`);
      record(`GET .../deficiencies/items/{itemId}/crop (${tag}, crop_ref ${item.crop_ref ? 'set' : 'null'})`, crop);
    }
    record(`GET /applications/{id}/selection-result (${tag})`, await call(token, 'GET', `/applications/${id}/selection-result`));
  }
  record('GET /schemes (public)', await call(null, 'GET', '/schemes'));
  const all = await call(null, 'POST', '/schemes/check-eligibility', { applicant: {} });
  record('POST /schemes/check-eligibility (public, empty profile)', all);
  const s = all.data?.indeterminate?.[0] ?? all.data?.eligible?.[0];
  if (s) record('GET /schemes/{code}/versions/{v}/form-schema (public)', await call(null, 'GET', `/schemes/${s.scheme_code}/versions/${s.version_no}/form-schema`));
  await call(null, 'POST', '/auth/logout', { refresh_token: refresh });
  writeFileSync(`docs/live-shapes/${label}.txt`, out.join('\n'));
  console.log(`${label}: ${(apps.data ?? []).length} application(s) -> docs/live-shapes/${label}.txt`);
}
