// Phase 17 A3 (M60): failed writes carrying distinctive marker values no longer put the value in
// the Postgres log. Four failures: a literal CHECK violation, a bound-parameter CHECK violation,
// a unique violation (whose DETAIL names the key value) and an invalid-input error.
import { spawnSync, execFileSync } from 'node:child_process';
import { psql } from '../psql.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const off = psql(`SELECT o.id FROM officers o JOIN accounts a ON a.id=o.user_id WHERE a.email='dno.ranchi.p11@example.org';`);
const acc = psql(`SELECT email FROM accounts WHERE email='dno.ranchi.p11@example.org';`);
console.log('settings: ' + psql(`SELECT string_agg(name||'='||setting, ', ' ORDER BY name) FROM pg_settings WHERE name IN ('log_min_error_statement','log_statement','log_error_verbosity','log_parameter_max_length_on_error','log_parameter_max_length','log_min_messages','log_destination','logging_collector');`));
const M = { literal: 'P17-MARKER-LITERAL', bound: 'P17-MARKER-BOUND', unique: acc, input: 'P17-MARKER-NOT-A-UUID' };
const since = new Date().toISOString();
const input = `INSERT INTO officer_preferences (officer_id, preferred_language, updated_by_account_id) VALUES ('${off}', '${M.literal}', '${off}');
INSERT INTO officer_preferences (officer_id, preferred_language, updated_by_account_id) VALUES ($1, $2, $3) \\bind '${off}' '${M.bound}' '${off}' \\g
INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') \\bind '${M.unique}' \\g
SELECT * FROM applications WHERE id = $1 \\bind '${M.input}' \\g
`;
const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input });
console.log('the client still gets the full error (psql, not the log):\n  ' + r.stderr.toString().trim().split('\n').join('\n  '));
await sleep(1500);
const lines = execFileSync('docker', ['compose', 'logs', '--no-color', '--since', since, 'postgres'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter(Boolean);
console.log('postgres log for those four failures:');
for (const l of lines) console.log('  ' + l.replace(/^postgres-1\s+\|\s+/, '').slice(0, 300));
const all = lines.join('\n');
for (const [k, v] of Object.entries(M)) console.log(`  marker ${k.padEnd(8)} ${JSON.stringify(v).padEnd(40)} in the log: ${all.includes(v)}`);
console.log(`  STATEMENT lines: ${lines.filter((l) => l.includes('STATEMENT:')).length}; DETAIL lines: ${lines.filter((l) => l.includes('DETAIL:')).length}`);
