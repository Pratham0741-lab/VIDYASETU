import { execFileSync } from 'node:child_process';
/** Runs SQL as the DB owner via stdin (no shell quoting). */
export const psql = (sql, flags = ['-At']) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -q ${flags.join(' ')}`],
    { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql }).toString().trim();
