// Phase 17.2 Part 0: after merging fix-denials-bigint, GET /authorization-denials returns 200 with
// rows for every allowed role (DENIAL_READER_ROLES), 403 for the others, 401 without a token.
import { login, req, line } from './h.mjs';
for (const [role, email] of [
  ['MINISTRY_OFFICER', 'ministry.p11@example.org'], ['SUPER_ADMIN', 'admin.p11@example.org'],
  ['STATE_NODAL_OFFICER', 'sno.jharkhand.p11@example.org'], ['DISTRICT_NODAL_OFFICER', 'dno.ranchi.p11@example.org'],
  ['AUDITOR', 'auditor.jharkhand.p11@example.org'],
]) {
  const r = await req('GET', '/authorization-denials?limit=5', { token: await login(email) });
  const d = r.body?.denials ?? [];
  line(`${role} (${email})`, r, ` rows=${d.length} seq types=${[...new Set(d.map((x) => typeof x.seq))].join(',')} reasons=${[...new Set(d.map((x) => x.denial_reason))].join(',')}`);
}
for (const [role, email] of [['INSTITUTE_NODAL_OFFICER', 'ino.ranchi.p11@example.org'], ['COMMITTEE', 'committee.ranchi.p11@example.org']]) {
  line(`${role} (not a reader)`, await req('GET', '/authorization-denials', { token: await login(email) }));
}
line('no token', await req('GET', '/authorization-denials'));
