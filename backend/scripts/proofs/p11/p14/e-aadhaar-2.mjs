// Phase 14 Part E proof, continued (the first run stopped on a closed keep-alive socket
// before E.3's HTTP checks; the harness now retries such a request once).
import { call, login, state } from '../lib.mjs';
const line = (label, r, extra = '') => console.log(`${label.padEnd(64)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
let r = await call('POST', '/applicants/me/aadhaar-authentication', { aadhaar_number: '2363 4717 1230', consent: true }, await login(state.P14.aa.AA2.email), { raw: true });
line('a realistic-looking number with a VALID checksum (2363 4717 1230)', r, ` ${JSON.stringify(r.body.details)}`);
for (const who of ['ino.ranchi.p11@example.org', 'auditor.jharkhand.p11@example.org', 'admin.p11@example.org']) {
  r = await call('GET', '/applicants/me/aadhaar-authentication', undefined, await login(who), { raw: true });
  line(`GET /applicants/me/aadhaar-authentication as ${who.split('.p11')[0]}`, r);
}
