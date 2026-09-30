// Phase 16: snapshot every existing CSV export (to compare before / after the controller refactor).
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { login } from '../lib.mjs';
const tag = process.argv[2];
const who = { sa: 'admin.p11@example.org', mo: 'ministry.p11@example.org' };
const out = {};
for (const [k, email] of Object.entries(who)) {
  const t = await login(email);
  for (const v of ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction', 'jurisdiction?group_by=institution&x=1']) {
    const [view, extra] = v.split('?');
    const fx = k === 'sa' ? '&include_fixtures=true' : '';
    const url = `http://127.0.0.1:3000/api/v1/analytics/${view}/export.csv?from=2026-01-01&to=2027-01-01${fx}${extra ? '&' + extra.replace('&x=1', '') : ''}`;
    const body = await (await fetch(url, { headers: { Authorization: `Bearer ${t}` } })).text();
    out[`${k} ${v}`] = body;
  }
  const t2 = await login(email);
  const f = await (await fetch(`http://127.0.0.1:3000/api/v1/analytics/fairness/export.csv?scheme=TOP_CLASS&academic_year=2026-27${k === 'sa' ? '&include_fixtures=true' : ''}`, { headers: { Authorization: `Bearer ${t2}` } })).text();
  out[`${k} fairness`] = f;
}
writeFileSync(`responses/p16/csv-${tag}.json`, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(52)} ${String(v.length).padStart(6)} bytes sha256 ${createHash('sha256').update(v).digest('hex').slice(0, 16)}`);
