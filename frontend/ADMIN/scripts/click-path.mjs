#!/usr/bin/env node
/**
 * Click-path proof for the officer portal: drives the same API calls the UI
 * makes, in the same order, and prints status codes and counts only.
 *
 * Credentials come from .env.local (git-ignored) and are never printed:
 *   E2E_EMAIL, E2E_PASSWORD                   a reviewer officer (scrutiny, fraud)
 *   E2E_COMMITTEE_EMAIL, E2E_COMMITTEE_PASSWORD   optional (selection as committee)
 *   E2E_AUDITOR_EMAIL, E2E_AUDITOR_PASSWORD       optional (audit verify)
 *   E2E_APPLICANT_EMAIL, E2E_APPLICANT_PASSWORD   optional (refusal check)
 *   E2E_INO_EMAIL, E2E_INO_PASSWORD               optional institute officer for the
 *                                              document file and history checks; when not
 *                                              set, E2E_EMAIL / E2E_PASSWORD (also a reviewer)
 *                                              is used and the output says so
 *   VITE_API_BASE_URL                          default http://localhost:3000/api/v1
 *
 * Read-only by default: state-changing calls are dry runs. With --write it
 * also verifies or marks defective ONE queue item and records ONE fraud
 * disposition (use on demo data only).
 *
 *   node scripts/click-path.mjs [--write]
 */
import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // missing file: empty
  }
  return out;
}
const env = { ...loadEnv('.env'), ...loadEnv('.env.local'), ...process.env };
const BASE = (env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/+$/, '');

let passed = 0;
let failed = 0;
let skipped = 0;
const pad = (s, n) => String(s).padEnd(n);
function report(ok, name, detail) {
  if (ok === null) skipped++;
  else if (ok) passed++;
  else failed++;
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${pad(name, 46)} ${detail}`);
}

async function call(method, path, { token, body, query } = {}) {
  let url = `${BASE}${path}`;
  if (query) {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined)).toString();
    if (q) url += `?${q}`;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, requestId: res.headers.get('x-request-id') };
}

/** Error summary without the body: code and reason only. */
function err(r) {
  const code = r.json?.code ?? '';
  const reason = r.json?.details && !Array.isArray(r.json.details) ? r.json.details.reason ?? '' : '';
  return `HTTP ${r.status}${code ? ` ${code}` : ''}${reason ? ` (${reason})` : ''}`;
}

const INO_FALLBACK = !(env.E2E_INO_EMAIL && env.E2E_INO_PASSWORD);
const INO_KEYS = INO_FALLBACK ? ['E2E_EMAIL', 'E2E_PASSWORD'] : ['E2E_INO_EMAIL', 'E2E_INO_PASSWORD'];

async function login(emailKey, passwordKey, label) {
  const email = env[emailKey];
  const password = env[passwordKey];
  if (!email || !password) {
    report(null, `login (${label})`, `${emailKey}/${passwordKey} not set in .env.local`);
    return null;
  }
  let r = await call('POST', '/auth/login', { body: { email, password } });
  // Login is limited to 5 per minute per IP: wait once and retry.
  if (r.status === 429) {
    console.log('      (login rate-limited, waiting 65 s)');
    await new Promise((res) => setTimeout(res, 65_000));
    r = await call('POST', '/auth/login', { body: { email, password } });
  }
  if (r.status !== 200 || !r.json?.access_token) {
    report(false, `login (${label})`, err(r));
    return null;
  }
  const me = await call('GET', '/auth/me', { token: r.json.access_token });
  report(me.status === 200, `login + /auth/me (${label})`, `HTTP ${me.status} role=${me.json?.role ?? '?'} jurisdiction=${me.json?.jurisdictionState ?? 'national'}${me.json?.jurisdictionDistrict ? `/${me.json.jurisdictionDistrict}` : ''} name=${me.json?.name ? 'yes' : 'no'} institution_code=${me.json?.institution_code ? 'yes' : 'no'}`);
  return { token: r.json.access_token, refresh: r.json.refresh_token, role: me.json?.role, district: me.json?.jurisdictionDistrict ?? null };
}

/** Binary GET: status and the headers the portal relies on; the body is read only for its size. */
async function fetchFile(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const bytes = (await res.arrayBuffer()).byteLength;
  return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', bytes };
}

/** Documents with a stored file (not DigiLocker), up to `max`, from the given applications. */
async function uploadedDocs(apps, token, max = 8) {
  const out = [];
  for (const a of apps.slice(0, max)) {
    const d = await call('GET', `/applications/${a.id}/documents`, { token });
    const doc = (d.json?.documents ?? []).find((x) => x.source !== 'DIGILOCKER');
    if (doc) out.push({ app: a, doc });
  }
  return out;
}

async function logout(s) {
  if (s?.refresh) await call('POST', '/auth/logout', { body: { refresh_token: s.refresh } });
}

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);

let outOfScope = null;

async function main() {
  console.log(`API ${BASE}  mode=${WRITE ? 'WRITE (one decision, one disposition)' : 'read-only + dry runs'}`);

  const bad = await call('POST', '/auth/login', { body: { email: 'nobody.clickpath@example.org', password: 'not-a-real-password-123' } });
  report(bad.status === 401, 'wrong password is refused', err(bad));

  // Applicant refusal: the portal logs out an APPLICANT after /auth/me.
  const applicant = await login('E2E_APPLICANT_EMAIL', 'E2E_APPLICANT_PASSWORD', 'applicant');
  if (applicant) {
    report(applicant.role === 'APPLICANT', 'applicant role detected -> portal refuses', `role=${applicant.role}`);
    const q = await call('GET', '/applications/queue', { token: applicant.token });
    report(q.status === 403, 'applicant cannot read the officer queue', err(q));
    await logout(applicant);
  }

  // Reviewer: scrutiny and fraud
  const officer = await login('E2E_EMAIL', 'E2E_PASSWORD', 'officer');
  if (officer) {
    const t = officer.token;
    const q = await call('GET', '/applications/queue', { token: t });
    const apps = q.json?.applications ?? [];
    report(q.status === 200, 'queue', q.status === 200 ? `HTTP 200 count=${q.json.count} stages=${(q.json.stages ?? []).join(',')}` : err(q));
    for (const f of [{ needs_eligibility_review: 'true' }, { fraud: 'HIGH' }]) {
      const r = await call('GET', '/applications/queue', { token: t, query: f });
      report(r.status === 200, `queue ?${new URLSearchParams(f)}`, r.status === 200 ? `HTTP 200 count=${r.json.count}` : err(r));
    }
    const target = apps.find((a) => !a.fraud?.held) ?? apps[0];
    if (!target) report(null, 'open a case', 'queue is empty');
    else {
      const a = await call('GET', `/applications/${target.id}`, { token: t });
      report(a.status === 200, 'open a case: application', a.status === 200 ? `HTTP 200 ${a.json.application_no} stage=${a.json.current_stage}` : err(a));
      const d = await call('GET', `/applications/${target.id}/documents`, { token: t });
      const docs = d.json?.documents ?? [];
      report(d.status === 200, 'open a case: documents', d.status === 200 ? `HTTP 200 documents=${docs.length} checklist=${d.json.checklist?.length ?? 0} ml_mode=${d.json.ml_mode}` : err(d));
      const doc = docs.find((x) => x.state === 'NEEDS_REVIEW') ?? docs[0];
      if (doc) {
        const g = await call('GET', `/documents/${doc.document_id}`, { token: t });
        const fields = g.json?.extraction?.fields ?? [];
        report(g.status === 200, 'document view (fields + confidence)', g.status === 200 ? `HTTP 200 state=${g.json.state} fields=${fields.length} threshold=${g.json.extraction?.review_threshold ?? '-'}` : err(g));
      }
      const short = await call('POST', `/applications/${target.id}/reject`, { token: t, body: { remarks: 'too short' } });
      report(short.status === 400 && short.json?.code === 'REASON_REQUIRED', 'reject with a 9-char reason is refused', err(short));
      const defPreview = await call('POST', `/applications/${target.id}/deficiencies`, { token: t, body: { reason: 'Click-path dry run of a deficiency', dry_run: true } });
      report(defPreview.status === 200 || defPreview.status === 409, 'deficiency dry run', defPreview.status === 200 ? `HTTP 200 items=${defPreview.json.items?.length} deadline_days=${defPreview.json.deadline_days}` : err(defPreview));
      if (WRITE) {
        const v = await call('POST', `/applications/${target.id}/verify`, { token: t, body: target.needs_eligibility_review ? { remarks: 'Eligibility reviewed manually in the click-path proof', eligibility_review_confirmed: true } : { remarks: 'Verified in the click-path proof' } });
        if (v.status === 200) report(true, 'verify with a reason', `HTTP 200 ${v.json.transition.from_stage} -> ${v.json.transition.to_stage}`);
        else {
          report(null, 'verify with a reason', `${err(v)}; trying mark-defective`);
          const m = await call('POST', `/applications/${target.id}/mark-defective`, { token: t, body: { code: 'DEF_CLICK_PATH', title: 'Documents to re-check', description: 'Please re-upload a clear copy of the listed documents.', remarks: 'Marked defective in the click-path proof' } });
          report(m.status === 200, 'mark defective with a reason', m.status === 200 ? `HTTP 200 ${m.json.transition.from_stage} -> ${m.json.transition.to_stage}` : err(m));
        }
      } else report(null, 'verify / mark defective with a reason', 'read-only run (use --write)');
    }
    const ids = apps.slice(0, 5).map((a) => a.id);
    if (ids.length) {
      const b = await call('POST', '/applications/bulk-actions', { token: t, body: { action: 'VERIFY', application_ids: ids, dry_run: true } });
      const skips = (b.json?.items ?? []).filter((i) => i.outcome === 'SKIPPED').map((i) => i.skip_reason);
      report(b.status === 200 && b.json?.dry_run === true, 'bulk VERIFY dry run', b.status === 200 ? `HTTP 200 requested=${b.json.requested} would_change=${b.json.would_change} skipped=${b.json.skipped}${skips.length ? ` [${[...new Set(skips)].join(',')}]` : ''}` : err(b));
    } else report(null, 'bulk VERIFY dry run', 'queue is empty');

    const held = (await call('GET', '/applications/queue', { token: t, query: { fraud: 'ANY' } })).json?.applications ?? [];
    const fraudApp = held[0];
    if (!fraudApp) report(null, 'fraud flags', 'no flagged application in the queue');
    else {
      const f = await call('GET', `/applications/${fraudApp.id}/fraud-flags`, { token: t });
      const flags = f.json?.flags ?? [];
      report(f.status === 200, 'fraud flags', f.status === 200 ? `HTTP 200 ${f.json.application_no} held=${f.json.held} flags=${flags.map((x) => `${x.flag_type}/${x.severity}/${x.status}`).join(',')}` : err(f));
      const c = await call('POST', `/applications/${fraudApp.id}/fraud-checks`, { token: t });
      report(c.status === 200, 'fraud check (selected application)', c.status === 200 ? `HTTP 200 flags=${c.json.flags?.length}` : err(c));
      const flag = flags[0];
      if (flag) {
        const shortNotes = await call('POST', `/fraud-flags/${flag.id}/disposition`, { token: t, body: { status: 'NEEDS_MORE_INFO', notes: 'short' } });
        report(shortNotes.status === 400 && shortNotes.json?.code === 'REASON_REQUIRED', 'disposition without a 10-char reason is refused', err(shortNotes));
        if (WRITE) {
          const d = await call('POST', `/fraud-flags/${flag.id}/disposition`, { token: t, body: { status: 'NEEDS_MORE_INFO', notes: 'Click-path proof: evidence reviewed, more information requested' } });
          report(d.status === 200, 'disposition NEEDS_MORE_INFO with a reason', d.status === 200 ? `HTTP 200 status=${d.json.status}` : err(d));
        } else report(null, 'disposition with a reason', 'read-only run (use --write)');
      }
    }
    const now = new Date(Date.now() + DAY);
    const fa = await call('GET', '/analytics/fraud', { token: t, query: { from: iso(new Date(now.getTime() - 366 * DAY)), to: iso(now) } });
    report(fa.status === 200, 'analytics/fraud (metric cards)', fa.status === 200 ? `HTTP 200 held_total=${fa.json.held_applications?.total} rows=${fa.json.application_flags?.length}` : err(fa));
    const sl = await call('GET', '/selection-lists', { token: t });
    report(sl.status === 200, 'selection lists (officer)', sl.status === 200 ? `HTTP 200 lists=${sl.json.lists?.length}` : err(sl));
    const den = await call('GET', '/authorization-denials', { token: t, query: { limit: 5 } });
    report(den.status === 200 || den.status === 403, 'authorization denials', den.status === 200 ? `HTTP 200 rows=${den.json.denials?.length}` : err(den));
    const acc = await call('GET', '/document-access', { token: t, query: { limit: 5 } });
    report(acc.status === 200 || acc.status === 403, 'document access log', acc.status === 200 ? `HTTP 200 rows=${acc.json.accesses?.length}` : err(acc));
    const av = await call('GET', '/audit/verify', { token: t });
    report(av.status === 403, 'audit verify refused for a reviewer', err(av));
    // F2-B: a document with a stored file in another district, for the out-of-scope check.
    outOfScope = (await uploadedDocs(apps, t)).map((x) => ({ district: x.app.jurisdiction_district, id: x.doc.document_id }));
    await logout(officer);
  }

  // F2-B: institute officer (district scope): original file, history.
  if (INO_FALLBACK) console.log('      (no E2E_INO_* in .env.local: the file and history checks use E2E_EMAIL, a reviewer)');
  const ino = await login(INO_KEYS[0], INO_KEYS[1], INO_FALLBACK ? 'reviewer for file checks (E2E_EMAIL)' : 'institute officer');
  if (ino) {
    const q = await call('GET', '/applications/queue', { token: ino.token });
    const apps = q.json?.applications ?? [];
    report(q.status === 200, 'ino queue', q.status === 200 ? `HTTP 200 count=${apps.length}` : err(q));
    const [inScope] = await uploadedDocs(apps, ino.token, 10);
    if (!inScope) report(null, 'GET /documents/:id/file (in scope)', 'no uploaded document in this queue');
    else {
      const f = await fetchFile(`/documents/${inScope.doc.document_id}/file`, ino.token);
      const typeOk = /^(image\/(jpeg|png|webp)|application\/pdf)/.test(f.type);
      report(f.status === 200 && typeOk && /no-store/.test(f.cache), 'GET /documents/:id/file (in scope)', `HTTP ${f.status} content-type=${f.type.split(';')[0]} cache-control=${f.cache} bytes=${f.bytes > 0 ? '>0' : '0'}`);
      const h = await call('GET', `/applications/${inScope.app.id}/history`, { token: ino.token });
      report(h.status === 200 && Array.isArray(h.json?.history), 'GET /applications/:id/history', h.status === 200 ? `HTTP 200 entries=${h.json.history.length} actions=${[...new Set(h.json.history.map((x) => x.trigger_action))].join(',')}` : err(h));
    }
    // Out of scope: a document from another district (only meaningful for a district-scoped
    // caller). Otherwise an unknown id, which the backend answers with the same 404.
    const other = ino.district ? (outOfScope ?? []).find((x) => x.district && x.district !== ino.district) : null;
    if (other) {
      const f = await fetchFile(`/documents/${other.id}/file`, ino.token);
      report(f.status === 404, 'GET /documents/:id/file (out of scope)', `HTTP ${f.status} (document in another district)`);
    } else {
      const f = await fetchFile('/documents/00000000-0000-4000-8000-000000000000/file', ino.token);
      report(f.status === 404, 'GET /documents/:id/file (not visible)', `HTTP ${f.status} (unknown id; the caller's scope is ${ino.district ? 'a district' : 'the whole state'}, so no out-of-scope document exists for it)`);
    }
    const hBad = await call('GET', '/applications/00000000-0000-4000-8000-000000000000/history', { token: ino.token });
    report(hBad.status === 404, 'history of an unknown application', err(hBad));
    await logout(ino);
  }

  // Committee: selection read
  const committee = await login('E2E_COMMITTEE_EMAIL', 'E2E_COMMITTEE_PASSWORD', 'committee');
  if (committee) {
    const sl = await call('GET', '/selection-lists', { token: committee.token });
    const lists = sl.json?.lists ?? [];
    report(sl.status === 200, 'selection lists (committee)', sl.status === 200 ? `HTTP 200 lists=${lists.length} statuses=${lists.map((l) => l.status).join(',')}` : err(sl));
    if (lists[0]) {
      const one = await call('GET', `/selection-lists/${lists[0].id}`, { token: committee.token });
      report(one.status === 200, 'selection list entries', one.status === 200 ? `HTTP 200 ${one.json.scheme_code} ${one.json.academic_year} entries_in_scope=${one.json.entries_in_scope}` : err(one));
    }
    // F2-B: objection list per list (ids, status and dates only).
    let total = 0;
    let open = 0;
    const statuses = [];
    for (const l of lists) {
      const o = await call('GET', `/selection-lists/${l.id}/objections`, { token: committee.token });
      statuses.push(o.status);
      total += o.json?.objections?.length ?? 0;
      open += (o.json?.objections ?? []).filter((x) => !x.decided).length;
    }
    report(statuses.length > 0 && statuses.every((x) => x === 200), 'GET /selection-lists/:id/objections (committee)', `HTTP ${[...new Set(statuses)].join(',')} lists=${statuses.length} objections=${total} not_decided=${open}`);
    const q = await call('GET', '/applications/queue', { token: committee.token });
    report(q.status === 403, 'committee has no scrutiny queue', err(q));
    await logout(committee);
  }

  // Auditor: audit verify
  const auditor = await login('E2E_AUDITOR_EMAIL', 'E2E_AUDITOR_PASSWORD', 'auditor');
  if (auditor) {
    const av = await call('GET', '/audit/verify', { token: auditor.token });
    report(av.status === 200, 'audit verify', av.status === 200 ? `HTTP 200 ok=${av.json.ok} chain_rows=${av.json.chain?.rows} legacy_rows=${av.json.legacy?.rows} checkpoint=${av.json.legacy?.matches_checkpoint} denials_ok=${av.json.denials?.ok} denials_rows=${av.json.denials?.chain?.rows}` : err(av));
    const den = await call('GET', '/authorization-denials', { token: auditor.token, query: { limit: 5 } });
    report(den.status === 200, 'authorization denials (auditor)', den.status === 200 ? `HTTP 200 rows=${den.json.denials?.length}` : err(den));
    await logout(auditor);
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(`click-path aborted: ${e instanceof Error ? e.message : 'unknown error'}`);
  process.exitCode = 2;
});
