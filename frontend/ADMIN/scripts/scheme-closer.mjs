#!/usr/bin/env node
/**
 * Scheme Studio "demo closer" proof: drives the same API calls the Studio
 * makes, end to end, against the local backend.
 *
 *   a. log in as the ministry officer (E2E_MINISTRY_EMAIL / E2E_MINISTRY_PASSWORD
 *      from .env.local; never printed)
 *   b. create scheme CLOSER_TEST_<timestamp> and a draft, then try one
 *      deliberately invalid config (the server refuses it with a message key)
 *   c. fix it, validate, publish
 *   d. PUBLIC routes: the scheme is in GET /schemes and in
 *      POST /schemes/check-eligibility, and its form schema is not empty
 *   e. try to edit the published version (refused)
 *   f. retire it; it is gone from the public list
 *
 * Runs only when .env.local contains ALLOW_WRITE=1. Prints statuses, codes
 * and counts only (no bodies, no credentials).
 *
 *   node scripts/scheme-closer.mjs
 */
import { readFileSync } from 'node:fs';

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
/** The seeded version whose config is copied for the new scheme. */
const SOURCE = { code: 'POST_MATRIC', version: null };

let passed = 0;
let failed = 0;
function report(ok, step, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(58)} ${detail}`);
}

let token = null;
async function call(method, path, body, auth = true) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
const errInfo = (r) => {
  const d = r.json?.details;
  const reason = d && !Array.isArray(d) ? d.reason : undefined;
  const keys = Array.isArray(d) ? [...new Set(d.map((x) => x?.message_key).filter(Boolean))] : [];
  return `HTTP ${r.status}${r.json?.code ? ` ${r.json.code}` : ''}${reason ? ` reason=${reason}` : ''}${keys.length ? ` message_keys=${keys.join(',')}` : ''}${Array.isArray(d) ? ` issues=${d.length}` : ''}`;
};
const inPublicList = (json, code) => (json?.schemes ?? []).some((s) => s.code === code || s.scheme_code === code);
const inEligibility = (json, code) => ['eligible', 'not_eligible', 'indeterminate'].some((k) => (json?.[k] ?? []).some((s) => s.scheme_code === code));

async function main() {
  if (env.ALLOW_WRITE !== '1') {
    console.log('SKIP  ALLOW_WRITE=1 is not set in .env.local: this script writes (creates, publishes and retires a scheme).');
    return;
  }
  if (!env.E2E_MINISTRY_EMAIL || !env.E2E_MINISTRY_PASSWORD) {
    console.log('SKIP  E2E_MINISTRY_EMAIL / E2E_MINISTRY_PASSWORD are not set in .env.local.');
    return;
  }
  console.log(`API ${BASE}`);

  // a. login
  const login = await call('POST', '/auth/login', { email: env.E2E_MINISTRY_EMAIL, password: env.E2E_MINISTRY_PASSWORD }, false);
  if (login.status !== 200) return report(false, 'a. login as ministry officer', errInfo(login));
  token = login.json.access_token;
  const me = await call('GET', '/auth/me');
  report(me.json?.role === 'MINISTRY_OFFICER', 'a. login as ministry officer', `HTTP ${login.status}, /auth/me role=${me.json?.role}`);

  // b. scheme, draft, one invalid config
  const code = `CLOSER_TEST_${Date.now()}`;
  const created = await call('POST', '/admin/schemes', { code, name: `Closer test ${code} (synthetic)`, department: 'Portal click-path test (synthetic)', type: 'CENTRAL_SECTOR', disbursement_mode: 'SCHEDULED_BY_PLATFORM' });
  report(created.status === 201, 'b. create scheme', `HTTP ${created.status} code=${code}`);
  if (created.status !== 201) return;
  const list = await call('GET', '/admin/schemes');
  const src = (list.json?.schemes ?? []).find((s) => s.code === SOURCE.code);
  SOURCE.version = (src?.versions ?? []).find((v) => v.status === 'active')?.version_no ?? null;
  const source = SOURCE.version ? await call('GET', `/admin/schemes/${SOURCE.code}/versions/${SOURCE.version}`) : { status: 0 };
  const config = source.json?.version?.config;
  report(!!config, 'b. read the config to copy', `${SOURCE.code} v${SOURCE.version} HTTP ${source.status} rules=${config?.rules?.length ?? 0}`);
  if (!config) return;
  const draft = await call('POST', `/admin/schemes/${code}/versions`, { config });
  const v = draft.json?.version_no;
  report(draft.status === 201 && draft.json?.status === 'draft', 'b. create draft (copy)', `HTTP ${draft.status} version=${v} status=${draft.json?.status}`);
  if (draft.status !== 201) return;
  const broken = structuredClone(config);
  const ruleWithParam = broken.rules.find((r) => /params\.(\w+)/.test(r.expr));
  const readKey = ruleWithParam?.expr.match(/params\.(\w+)/)?.[1];
  if (ruleWithParam && readKey) delete ruleWithParam.params[readKey];
  broken.workflow = 'no-such-workflow/v0';
  const bad = await call('PATCH', `/admin/schemes/${code}/versions/${v}`, { config: broken });
  const keys = Array.isArray(bad.json?.details) ? bad.json.details.map((d) => d.message_key) : [];
  report(bad.status === 400 && keys.length > 0, 'b. invalid config refused (param removed, unknown workflow)', errInfo(bad));
  const stored = await call('GET', `/admin/schemes/${code}/versions/${v}`);
  report(stored.json?.version?.config?.workflow === undefined, 'b. nothing was stored', `GET HTTP ${stored.status} workflow=${stored.json?.version?.config?.workflow ?? 'unset'}`);

  // c. fix, validate, publish
  const fixed = structuredClone(config);
  const ceilingRule = fixed.rules.find((r) => r.params && typeof r.params.income_ceiling === 'number');
  if (ceilingRule) ceilingRule.params.income_ceiling = ceilingRule.params.income_ceiling + 50000;
  const ok = await call('PATCH', `/admin/schemes/${code}/versions/${v}`, { config: fixed });
  report(ok.status === 200, 'c. fixed config saved (income ceiling + 50,000)', `HTTP ${ok.status}${ceilingRule ? ` income_ceiling=${ceilingRule.params.income_ceiling}` : ''}`);
  const val = await call('POST', `/admin/schemes/${code}/versions/${v}/validate`);
  report(val.status === 200 && val.json?.valid === true, 'c. validate', val.status === 200 ? `HTTP 200 valid=${val.json.valid} form_fields=${val.json.form_fields?.length} checklist=${val.json.document_checklist?.length}` : errInfo(val));
  const pub = await call('POST', `/admin/schemes/${code}/versions/${v}/publish`, {});
  report(pub.status === 200 && pub.json?.version?.status === 'active', 'c. publish', pub.status === 200 ? `HTTP 200 status=${pub.json.version.status} superseded=${pub.json.superseded?.length ?? 0}` : errInfo(pub));

  // d. public routes
  const pubList = await call('GET', '/schemes', undefined, false);
  report(pubList.status === 200 && inPublicList(pubList.json, code), 'd. public GET /schemes lists it', `HTTP ${pubList.status} active_versions=${pubList.json?.schemes?.length ?? 0} contains=${inPublicList(pubList.json, code)}`);
  const elig = await call('POST', '/schemes/check-eligibility', { applicant: {} }, false);
  report(elig.status === 200 && inEligibility(elig.json, code), 'd. public check-eligibility evaluates it', `HTTP ${elig.status} schemes_evaluated=${elig.json?.schemes_evaluated} contains=${inEligibility(elig.json, code)}`);
  const form = await call('GET', `/schemes/${code}/versions/${v}/form-schema`, undefined, false);
  report(form.status === 200 && (form.json?.fields?.length ?? 0) > 0, 'd. public form-schema is not empty', `HTTP ${form.status} fields=${form.json?.fields?.length ?? 0} checklist=${form.json?.documents?.checklist?.length ?? 0}`);

  // e. published versions are immutable
  const edit = await call('PATCH', `/admin/schemes/${code}/versions/${v}`, { config: fixed });
  report(edit.status === 409, 'e. edit of the published version refused', errInfo(edit));

  // f. retire
  const ret = await call('POST', `/admin/schemes/${code}/versions/${v}/retire`);
  report(ret.status === 200 && ret.json?.status === 'archived', 'f. retire', `HTTP ${ret.status} status=${ret.json?.status}`);
  const after = await call('GET', '/schemes', undefined, false);
  report(after.status === 200 && !inPublicList(after.json, code), 'f. gone from public GET /schemes', `HTTP ${after.status} active_versions=${after.json?.schemes?.length ?? 0} contains=${inPublicList(after.json, code)}`);
  const elig2 = await call('POST', '/schemes/check-eligibility', { applicant: {} }, false);
  report(elig2.status === 200 && !inEligibility(elig2.json, code), 'f. gone from public check-eligibility', `HTTP ${elig2.status} schemes_evaluated=${elig2.json?.schemes_evaluated} contains=${inEligibility(elig2.json, code)}`);

  await call('POST', '/auth/logout', { refresh_token: login.json.refresh_token }, false);
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed > 0 ? 1 : 0;
  })
  .catch((e) => {
    console.error(`scheme-closer aborted: ${e instanceof Error ? e.message : 'unknown error'}`);
    process.exitCode = 2;
  });
