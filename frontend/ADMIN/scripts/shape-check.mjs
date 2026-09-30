#!/usr/bin/env node
/**
 * Live shape check: for each role whose credentials are in .env.local, log in
 * and call every GET endpoint the portal uses. Prints ONLY field names and
 * JSON types (recursive; arrays described by their first element).
 *
 * Values are printed only for enum-like fields: a field named status, stage,
 * severity, role, type, outcome or reason_code, or ending in _status, _stage,
 * _severity, _role, _type, _outcome or _reason_code (e.g. current_stage,
 * flag_type, computed_outcome). For those, the distinct values over the
 * whole array are listed. No other value is ever printed.
 *
 * Output: docs/live-shapes/<ROLE>.txt (and stdout).
 *   node scripts/shape-check.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // missing file
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local'), ...process.env };
const BASE = (env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/+$/, '');

const ENUM_NAMES = ['status', 'stage', 'severity', 'role', 'type', 'outcome', 'reason_code'];
const isEnumField = (k) => ENUM_NAMES.some((n) => k === n || k.endsWith(`_${n}`));

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Describes a value: objects by their keys, arrays by their first element
 * (plus the merged key set of all elements, so optional keys show up).
 */
function describe(v, indent, lines, siblings) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return;
    const first = v[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) describeObject(first, indent, lines, v);
    else lines.push(`${pad}[] ${typeOf(first)}`);
    return;
  }
  if (v && typeof v === 'object') describeObject(v, indent, lines, siblings ?? [v]);
}

function describeObject(obj, indent, lines, all) {
  const pad = '  '.repeat(indent);
  const keys = [...new Set(all.flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])))];
  for (const k of keys) {
    const vals = all.map((o) => (o && typeof o === 'object' ? o[k] : undefined));
    const present = vals.filter((x) => x !== undefined);
    const types = [...new Set(present.map(typeOf))];
    const missingIn = all.length - present.length;
    let line = `${pad}${k}: ${types.join('|')}`;
    const firstArr = present.find((x) => Array.isArray(x));
    if (types.includes('array')) line += firstArr && firstArr.length ? ` of ${typeOf(firstArr[0])}` : ' (empty)';
    if (missingIn > 0) line += ` (absent in ${missingIn}/${all.length})`;
    if (isEnumField(k)) {
      const distinct = [...new Set(present.filter((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean').map(String))].sort();
      if (distinct.length) line += `  values=[${distinct.join(', ')}]`;
    }
    lines.push(line);
    const objs = present.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length) describeObject(objs[0], indent + 1, lines, objs);
    const arrs = present.filter((x) => Array.isArray(x) && x.length);
    if (arrs.length) {
      const elems = arrs.flat();
      if (elems[0] && typeof elems[0] === 'object' && !Array.isArray(elems[0])) describeObject(elems[0], indent + 1, lines, elems);
    }
  }
}

async function call(path, token, query) {
  let url = `${BASE}${path}`;
  if (query) url += `?${new URLSearchParams(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function login(email, password, retried = false) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  // Login is limited to 5 per minute per IP: wait once and retry.
  if (res.status === 429 && !retried) {
    console.log('login rate-limited (429); waiting 65 s');
    await new Promise((r) => setTimeout(r, 65_000));
    return login(email, password, true);
  }
  if (res.status !== 200) return { error: `login HTTP ${res.status}` };
  const j = await res.json();
  return { token: j.access_token, refresh: j.refresh_token };
}

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const to = new Date(Date.now() + DAY);
const WINDOW = { from: iso(new Date(to.getTime() - 366 * DAY)), to: iso(to) };

async function run(label, emailKey, passwordKey) {
  if (!env[emailKey] || !env[passwordKey]) {
    console.log(`SKIP ${label}: ${emailKey}/${passwordKey} not set`);
    return;
  }
  const s = await login(env[emailKey], env[passwordKey]);
  if (!s.token) {
    console.log(`SKIP ${label}: ${s.error}`);
    return;
  }
  const lines = [];
  const me = await call('/auth/me', s.token);
  const role = me.json?.role ?? label;
  lines.push(`# Live response shapes for ${role} (${new Date().toISOString()})`, `# field: type [(absent in n/m)] [values=[...] for enum-like fields only]`, '');

  const out = async (name, path, query) => {
    const r = await call(path, s.token, query);
    lines.push(`## GET ${name} -> HTTP ${r.status}`);
    if (r.status >= 400) {
      const reason = r.json?.details && !Array.isArray(r.json.details) ? r.json.details.reason : undefined;
      lines.push(`  error: code=${r.json?.code ?? '?'}${reason ? ` reason=${reason}` : ''}`);
    } else if (Array.isArray(r.json)) {
      lines.push(`  (top-level array, ${r.json.length} element(s))`);
      describe(r.json, 1, lines);
    } else describe(r.json, 1, lines);
    lines.push('');
    return r;
  };

  await out('/auth/me', '/auth/me');
  await out('/officers/me/preferences', '/officers/me/preferences');
  const queue = await out('/applications/queue', '/applications/queue');
  await out('/applications/queue?fraud=HIGH', '/applications/queue', { fraud: 'HIGH' });
  const anyQ = await out('/applications/queue?fraud=ANY', '/applications/queue', { fraud: 'ANY' });
  await out('/applications/queue?needs_eligibility_review=true', '/applications/queue', { needs_eligibility_review: 'true' });

  const apps = queue.json?.applications ?? [];
  // Prefer an application that has uploaded documents (so /documents/:id is observed).
  let appId = apps[0]?.id;
  for (const a of apps.slice(0, 20)) {
    const d = await call(`/applications/${a.id}/documents`, s.token);
    if ((d.json?.documents ?? []).length > 0) {
      appId = a.id;
      break;
    }
  }
  if (appId) {
    await out('/applications/:id', `/applications/${appId}`);
    const docs = await out('/applications/:id/documents', `/applications/${appId}/documents`);
    const docList = docs.json?.documents ?? [];
    const doc = docList.find((d) => d.state === 'NEEDS_REVIEW') ?? docList[0];
    if (doc) await out('/documents/:id', `/documents/${doc.document_id}`);
  } else lines.push('## /applications/:id, /documents: skipped (queue empty or not permitted)', '');
  const fraudId = anyQ.json?.applications?.[0]?.id ?? appId;
  if (fraudId) await out('/applications/:id/fraud-flags', `/applications/${fraudId}/fraud-flags`);

  await out('/analytics/fraud', '/analytics/fraud', WINDOW);
  await out('/analytics/funnel', '/analytics/funnel', WINDOW);
  await out('/analytics/sla', '/analytics/sla', WINDOW);
  await out('/analytics/verification-quality', '/analytics/verification-quality', WINDOW);

  const lists = await out('/selection-lists', '/selection-lists');
  const l = lists.json?.lists ?? [];
  if (l[0]) {
    await out('/selection-lists/:id', `/selection-lists/${l[0].id}`);
    await out('/analytics/fairness', '/analytics/fairness', { scheme: l[0].scheme_code, academic_year: l[0].academic_year });
  }
  await out('/grievances', '/grievances');
  await out('/audit/verify', '/audit/verify');
  await out('/authorization-denials', '/authorization-denials', { limit: '50' });
  await out('/document-access', '/document-access', { limit: '50' });

  if (s.refresh) await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh }) });
  mkdirSync('docs/live-shapes', { recursive: true });
  writeFileSync(`docs/live-shapes/${role}.txt`, lines.join('\n') + '\n');
  console.log(`${role}: ${lines.filter((x) => x.startsWith('## ')).length} endpoint(s) -> docs/live-shapes/${role}.txt`);
}

await run('officer', 'E2E_EMAIL', 'E2E_PASSWORD');
await run('committee', 'E2E_COMMITTEE_EMAIL', 'E2E_COMMITTEE_PASSWORD');
await run('auditor', 'E2E_AUDITOR_EMAIL', 'E2E_AUDITOR_PASSWORD');
