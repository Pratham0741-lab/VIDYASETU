// Phase 13B A: provision the new roles through the API and exercise their routes.
import { call, login, state, PW } from '../lib.mjs';

const admin = await login('admin.p11@example.org');
const line = (s, r, extra = '') => console.log(`${s.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);

console.log('=== provisioning (POST /admin/officers as SUPER_ADMIN)');
for (const [email, role, st, di, inst, label] of [
  ['committee.ranchi.p11@example.org', 'COMMITTEE', 'Jharkhand', 'Ranchi', null, 'COMMITTEE Jharkhand/Ranchi'],
  ['committee.dumka.p11@example.org', 'COMMITTEE', 'Jharkhand', 'Dumka', null, 'COMMITTEE Jharkhand/Dumka'],
  ['auditor.jharkhand.p11@example.org', 'AUDITOR', 'Jharkhand', null, null, 'AUDITOR Jharkhand (state-wide)'],
  ['auditor.national.p11@example.org', 'AUDITOR', null, null, null, 'AUDITOR with no state (must be refused)'],
  ['committee.inst.p11@example.org', 'COMMITTEE', 'Jharkhand', 'Ranchi', 'U-0421', 'COMMITTEE with an institution (must be refused)'],
]) {
  const r = await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin, { raw: true });
  line(label, r, r.status >= 400 ? ' ' + JSON.stringify(r.body.details) : ` officer=${r.body.officer_id ?? r.body.id ?? ''}`);
}

const aud = await login('auditor.jharkhand.p11@example.org');
const com = await login('committee.ranchi.p11@example.org');
const comD = await login('committee.dumka.p11@example.org');
const me = await call('GET', '/auth/me', undefined, aud, { raw: true });
console.log(`\nAUDITOR /auth/me: role=${me.body.role} jurisdiction=${me.body.jurisdiction_state}/${me.body.jurisdiction_district}`);

console.log('\n=== AUDITOR reads (Jharkhand)');
const apps = await call('GET', '/applications', undefined, aud, { raw: true });
line('GET /applications', apps, ` ${apps.body.length} visible, districts ${JSON.stringify([...new Set(apps.body.map((a) => a.jurisdiction_district))])}`);
line('GET /applications/:id/fraud-flags (B2, Dumka)', await call('GET', `/applications/${state.P.B2.applicationId}/fraud-flags`, undefined, aud, { raw: true }));
const v = await call('GET', '/audit/verify', undefined, aud, { raw: true });
line('GET /audit/verify', v, ` ok=${v.body.ok} chain=${v.body.chain?.rows}`);
line('GET /analytics/funnel', await call('GET', '/analytics/funnel?from=2026-06-01&to=2027-06-01', undefined, aud, { raw: true }));
line('GET /authorization-denials', await call('GET', '/authorization-denials', undefined, aud, { raw: true }));

console.log('\n=== AUDITOR writes (all must be 403)');
const id = state.P.D2.applicationId;
for (const [label, m, p, b] of [
  ['POST /applications/:id/verify', 'POST', `/applications/${id}/verify`, { remarks: 'auditor tries to verify' }],
  ['POST /applications/:id/reject', 'POST', `/applications/${id}/reject`, { remarks: 'auditor tries to reject this' }],
  ['POST /applications/:id/fraud-checks', 'POST', `/applications/${id}/fraud-checks`, undefined],
  ['POST /fraud/backfill', 'POST', '/fraud/backfill', undefined],
  ['POST /notifications/:id/read', 'POST', '/notifications/00000000-0000-4000-8000-000000000000/read', undefined],
  ['POST /schemes/NOS/academic-years/2031-32/run-selection', 'POST', '/schemes/NOS/academic-years/2031-32/run-selection', { dry_run: true }],
  ['POST /admin/officers', 'POST', '/admin/officers', { email: 'x.p11@example.org', password: PW, name: 'x', role: 'AUDITOR', jurisdiction_state: 'Jharkhand' }],
]) line(`AUDITOR ${label}`, await call(m, p, b, aud, { raw: true }));

console.log('\n=== COMMITTEE reads');
for (const [who, t] of [['COMMITTEE Ranchi', com], ['COMMITTEE Dumka', comD]]) {
  for (const [scheme, year] of [['TOP_CLASS', '2028-29'], ['NFST', '2027-28'], ['POST_MATRIC', '2026-27']]) {
    const r = await call('GET', `/selections?scheme=${scheme}&academic_year=${year}`, undefined, t, { raw: true });
    line(`${who} GET /selections ${scheme} ${year}`, r, ` total=${r.body.total} ranks=${JSON.stringify(r.body.selections?.map((x) => x.merit_rank))} score=${JSON.stringify(r.body.selections?.[0]?.score?.breakdown ? Object.keys(r.body.selections[0].score.breakdown) : null)} objections=${r.body.objections?.length}`);
  }
}
line('COMMITTEE GET /applications', await call('GET', '/applications', undefined, com, { raw: true }));
line('COMMITTEE POST /selections/:id/confirm', await call('POST', `/selections/${state.P12.P12N1.selectionId}/confirm`, { override_reason: 'committee tries to confirm' }, com, { raw: true }));
