// Phase 17 (F3): `npm audit` of the PRODUCTION dependency tree, run at image
// build time (Dockerfile stage `security`). Writes security/npm-audit.txt (and
// the raw JSON). When the registry cannot be reached the result is recorded as
// NOT RUN with the reason - never a made-up "0 vulnerabilities".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'security-report';
mkdirSync(OUT, { recursive: true });
const lockSha = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', timeout: 120_000 });
writeFileSync(`${OUT}/npm-audit.json`, r.stdout || '');
const head = [`npm audit (production dependencies) at ${new Date().toISOString()}`, `package-lock.json sha256 ${lockSha}`];

let json = null;
try {
  json = JSON.parse(r.stdout);
} catch {
  /* not JSON: reported below */
}
if (!json || json.error || !json.metadata) {
  const reason =
    json?.error?.code ?? json?.error?.summary ?? (r.error ? String(r.error.message) : (r.stderr || 'no output').split('\n')[0]);
  writeFileSync(`${OUT}/npm-audit.txt`, [...head, `STATUS: NOT RUN - the registry could not be queried (${reason})`, ''].join('\n'));
  console.log(`npm audit: NOT RUN (${reason})`);
  process.exit(0);
}
const v = json.metadata.vulnerabilities ?? {};
const lines = [
  ...head,
  `STATUS: RAN - ${json.metadata.dependencies?.prod ?? '?'} production dependencies audited`,
  `vulnerabilities: critical ${v.critical ?? 0}, high ${v.high ?? 0}, moderate ${v.moderate ?? 0}, low ${v.low ?? 0}, info ${v.info ?? 0}`,
];
for (const [name, x] of Object.entries(json.vulnerabilities ?? {}).sort()) {
  const via = (x.via ?? []).map((w) => (typeof w === 'string' ? `via ${w}` : `${w.title} (${w.url ?? '-'})`)).join('; ');
  const fix = x.fixAvailable === true ? 'fix available' : x.fixAvailable ? `fix: ${x.fixAvailable.name}@${x.fixAvailable.version}${x.fixAvailable.isSemVerMajor ? ' (semver-major)' : ''}` : 'no fix available';
  lines.push(`  ${x.severity.padEnd(8)} ${name} ${x.range ?? ''} - ${via} - ${fix}`);
}
writeFileSync(`${OUT}/npm-audit.txt`, lines.join('\n') + '\n');
console.log(lines.slice(2, 4).join('\n'));
