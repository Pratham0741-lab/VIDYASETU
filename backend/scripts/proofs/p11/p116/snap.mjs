import { writeFileSync } from 'node:fs';
import { psql } from '../psql.mjs';
const tag = process.argv[2];
const flags = psql(`SELECT id||'|'||flag_type||'|'||severity||'|'||status||'|'||coalesce(reviewed_by_officer_id::text,'-')||'|'||coalesce(reviewed_at::text,'-')||'|'||coalesce(md5(review_notes),'-')||'|'||dedup_key FROM fraud_flags ORDER BY id;`);
writeFileSync(`p116/flags-${tag}.txt`, flags + '\n');
console.log(`[${tag}] flags: ${flags.split('\n').length}`);
console.log(psql(`SELECT field, source, count(*) AS rows, count(DISTINCT match_hmac) AS distinct_hashes FROM pii_match_index GROUP BY 1,2 ORDER BY 1,2;`, ['-P', 'pager=off']));
console.log(psql(`SELECT 'dispositioned flags: '||count(*)||' ('||string_agg(DISTINCT status, ',')||')' FROM fraud_flags WHERE status <> 'OPEN';`));
