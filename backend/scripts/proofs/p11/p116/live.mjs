import { writeFileSync } from 'node:fs';
import { call, login } from '../lib.mjs';
import { applicant } from '../setup.mjs';
import { psql } from '../psql.mjs';
const rec = (label, r) => { writeFileSync(`responses/p116-${label}.json`, JSON.stringify(r, null, 1)); return r; };
// key, first, last, dob, gender, district, bank, caste cert, institution
const groups = {
  'bank account (no ":" in M11B)': [
    ['M11A', 'Hiralal', 'Kujur', '2000-01-11', 'MALE', 'Ranchi', 'SBIN0004455:66007007', 'JH-ST-2026-661101', null],
    ['M11B', 'Pushpa', 'Xalxo', '2001-02-12', 'FEMALE', 'Ranchi', 'SBIN000445566007007', 'JH-ST-2026-661102', null],
    ['M11C', 'Rajesh', 'Horo', '2002-03-13', 'MALE', 'Ranchi', 'sbin0004455-６６００７００７', 'JH-ST-2026-661103', null],
  ],
  'declared caste certificate': [
    ['M11D', 'Sarita', 'Lugun', '1999-04-14', 'FEMALE', 'Ranchi', 'SBIN0004455:66008001', 'JH-ST-2026-661001', null],
    ['M11E', 'Mahesh', 'Bodra', '1998-05-15', 'MALE', 'Ranchi', 'SBIN0004455:66008002', 'jh/st/2026/661001', null],
    ['M11F', 'Lalita', 'Purty', '1997-06-16', 'FEMALE', 'Ranchi', 'SBIN0004455:66008003', 'JHST2026661001', null],
  ],
};
const ino = await login('ino.ranchi.p11@example.org');
for (const [g, people] of Object.entries(groups)) {
  console.log(`=== ${g}`);
  for (const p of people) {
    const a = await applicant(p);
    console.log(`  ${p[0]} registered with ${JSON.stringify(p[g.startsWith('bank') ? 6 : 7]).replace(/[^\x20-\x7e]/g, (c) => String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16))} -> ${a.application_no}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
  for (const p of people) {
    const a = (await import('../lib.mjs')).state.P[p[0]];
    const f = psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status||' related='||cardinality(related_application_ids)||' sources='||coalesce(evidence->>'sources','-'), '; ') FROM fraud_flags WHERE application_id='${a.applicationId}';`);
    const v = rec(`verify-${p[0]}`, await call('POST', `/applications/${a.applicationId}/verify`, { remarks: 'verify' }, ino, { raw: true }));
    console.log(`  ${p[0]} flags: ${f || '(none)'}`);
    console.log(`     verify -> HTTP ${v.status} ${v.body.code ?? ''} flag_types=${JSON.stringify(v.body.details?.flag_types ?? null)}`);
  }
}
const ev = psql(`SELECT evidence::text FROM fraud_flags f JOIN applications a ON a.id=f.application_id JOIN applicants p ON p.id=a.applicant_id JOIN accounts acc ON acc.id=p.user_id WHERE acc.email LIKE 'm11b.%' AND f.flag_type='SHARED_BANK_ACCOUNT';`);
console.log(`\nM11B flag evidence keys: ${Object.keys(JSON.parse(ev)).join(', ')}`);
console.log(`M11B flag evidence: ${ev}`);
