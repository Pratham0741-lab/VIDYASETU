// Phase 16 Part B: dry-run selection for every seeded scheme and academic year with approved
// applications; saved so the result after the change can be compared byte for byte.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';
const tag = process.argv[2];
const mo = await login('ministry.p11@example.org');
const pairs = psql(`SELECT s.code||'|'||a.academic_year FROM applications a JOIN schemes s ON s.id=a.scheme_id WHERE a.current_stage='MINISTRY_APPROVED' AND s.code IN ('PRE_MATRIC','POST_MATRIC','TOP_CLASS','NFST','NOS') GROUP BY 1 ORDER BY 1;`).split('\n');
pairs.push('NOS|2026-27', 'PRE_MATRIC|2026-27');
const out = {};
for (const p of pairs) {
  const [code, year] = p.split('|');
  const r = await call('POST', `/schemes/${code}/academic-years/${year}/run-selection`, { dry_run: true }, mo, { raw: true });
  const body = JSON.stringify({ status: r.status, body: r.body });
  out[p] = body;
  console.log(`${p.padEnd(22)} HTTP ${r.status} basis=${r.body?.basis ?? r.body?.policy?.basis ?? '-'} selected=${r.body?.counts?.selected ?? '-'} bytes=${body.length} sha256=${createHash('sha256').update(body).digest('hex').slice(0, 16)}`);
}
writeFileSync(`responses/p16/b-dryrun-${tag}.json`, JSON.stringify(out, null, 1));
