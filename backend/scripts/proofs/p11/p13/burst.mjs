// Phase 13A B4 (live): concurrent real API writes, then chain checks.
import { call, login, state, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const q = (s) => psql(`BEGIN READ ONLY; ${s} COMMIT;`, ['-At']).split('\n').filter((l) => !/^(BEGIN|COMMIT)$/.test(l)).join('\n');
const before = q(`SELECT last_seq FROM audit_chain_head;`);
const people = Object.entries(state.P).filter(([k]) => k.startsWith('U-SURGE-01-')).slice(0, 30);
const tokens = await Promise.all(people.map(([, p]) => login(p.email)));
const t0 = Date.now();
const results = await Promise.all(
  people.map(([, p], i) =>
    call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2029-30', declared: { education_level: LVL.POST_MATRIC } }, tokens[i], { raw: true }),
  ),
);
const ms = Date.now() - t0;
const ok = results.filter((r) => r.status === 201).length;
console.log(`${people.length} parallel POST /applications: ${ok} x 201 in ${ms} ms (statuses ${[...new Set(results.map((r) => r.status))].join(',')})`);
const after = q(`SELECT last_seq FROM audit_chain_head;`);
console.log(`chain head seq ${before} -> ${after}: ${Number(after) - Number(before)} audit rows written by those requests`);
console.log('distinct DB backends that wrote them: ' + q(`SELECT count(DISTINCT actor_user_id) FROM audit_logs WHERE seq > ${before};`) + ' actors; ' +
  q(`SELECT count(*) FROM audit_logs WHERE seq > ${before} AND table_name = 'applications' AND action = 'INSERT';`) + ' application inserts');
console.log('chain rows (seq not null): forks = ' + q(`SELECT count(*) FROM (SELECT prev_hash FROM audit_logs WHERE seq IS NOT NULL AND prev_hash IS NOT NULL GROUP BY 1 HAVING count(*) > 1) f;`) +
  ', seq gaps = ' + q(`SELECT count(*) FROM (SELECT seq, lag(seq) OVER (ORDER BY seq) AS p FROM audit_logs WHERE seq IS NOT NULL) x WHERE p IS NOT NULL AND seq <> p + 1;`) +
  ', broken links = ' + q(`SELECT count(*) FROM audit_logs a JOIN audit_logs b ON b.seq = a.seq - 1 WHERE a.seq IS NOT NULL AND a.prev_hash IS DISTINCT FROM b.record_hash;`) +
  ', rows ' + q(`SELECT count(*)||' (seq '||min(seq)||'-'||max(seq)||')' FROM audit_logs WHERE seq IS NOT NULL;`));
