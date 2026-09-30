// Phase 17 (F3): licence inventory of the PRODUCTION dependency tree (offline:
// reads each installed package.json). Writes security/licences.csv and
// security/licences.txt; flags copyleft and unknown licences.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'security-report';
mkdirSync(OUT, { recursive: true });

const PERMISSIVE = new Set(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'Zlib', 'CC-BY-4.0', 'CC-BY-3.0', 'WTFPL', 'BSD', 'Artistic-2.0']);
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|CC-BY-SA|SSPL)\b/i;

export function classify(expr) {
  if (!expr || /UNLICENSED|SEE LICEN[CS]E/i.test(expr)) return 'UNKNOWN';
  const e = expr.replace(/[()]/g, ' ').trim();
  if (/\bOR\b/.test(e)) {
    const parts = e.split(/\bOR\b/).map((p) => classify(p.trim()));
    return parts.includes('PERMISSIVE') ? 'PERMISSIVE' : parts.includes('COPYLEFT') ? 'COPYLEFT' : 'UNKNOWN';
  }
  if (/\bAND\b/.test(e)) {
    const parts = e.split(/\bAND\b/).map((p) => classify(p.trim()));
    return parts.includes('COPYLEFT') ? 'COPYLEFT' : parts.every((p) => p === 'PERMISSIVE') ? 'PERMISSIVE' : 'UNKNOWN';
  }
  if (COPYLEFT.test(e)) return 'COPYLEFT';
  return PERMISSIVE.has(e) ? 'PERMISSIVE' : 'UNKNOWN';
}

const ls = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const dirs = [...new Set(ls.stdout.split('\n').filter((l) => l.includes('node_modules')))];
const rows = [];
for (const d of dirs) {
  const pj = join(d, 'package.json');
  if (!existsSync(pj)) continue;
  const p = JSON.parse(readFileSync(pj, 'utf8'));
  let lic = typeof p.license === 'string' ? p.license : p.license?.type;
  if (!lic && Array.isArray(p.licenses)) lic = p.licenses.map((l) => l.type ?? l).join(' OR ');
  rows.push({ name: p.name, version: p.version, licence: lic ?? '', class: classify(lic ?? '') });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const uniq = rows.filter((r, i) => i === 0 || r.name !== rows[i - 1].name || r.version !== rows[i - 1].version);
writeFileSync(`${OUT}/licences.csv`, ['name,version,licence,class', ...uniq.map((r) => `${r.name},${r.version},"${r.licence}",${r.class}`)].join('\n') + '\n');
const count = (c) => uniq.filter((r) => r.class === c).length;
const flagged = uniq.filter((r) => r.class !== 'PERMISSIVE');
const byLicence = Object.entries(uniq.reduce((m, r) => ({ ...m, [r.licence || '(none)']: (m[r.licence || '(none)'] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
const txt = [
  `npm production dependencies: ${uniq.length} packages - permissive ${count('PERMISSIVE')}, copyleft ${count('COPYLEFT')}, unknown ${count('UNKNOWN')}`,
  `by licence: ${byLicence.map(([l, n]) => `${l} ${n}`).join(', ')}`,
  'flagged (copyleft or unknown):',
  ...(flagged.length ? flagged.map((r) => `  ${r.class.padEnd(9)} ${r.name}@${r.version} "${r.licence}"`) : ['  none']),
];
writeFileSync(`${OUT}/licences.txt`, txt.join('\n') + '\n');
console.log(txt.join('\n'));
