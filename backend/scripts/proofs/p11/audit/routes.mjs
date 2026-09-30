// Audit: every route and its allowed roles, from the RBAC matrix e2e spec (which fails if a route lacks a row).
import { readFileSync } from 'node:fs';

const src = readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/test/rbac-matrix.e2e-spec.ts', 'utf8');
const rows = [...src.matchAll(/^\s{2}'((?:GET|POST|PUT|PATCH|DELETE) [^']+)':\s*\{([\s\S]*?)\n\s{2}\},/gm)];
const out = {};
for (const [, key, body] of rows) {
  const [method, path] = key.split(' ');
  const module = path.replace('/api/v1/', '').split('/')[0].replace(/:.*/, '');
  const pub = /public:\s*true/.test(body) || /matrix:\s*PUBLIC/.test(body);
  const allowed = [...body.matchAll(/(\w+):\s*A\b/g)].map((m) => m[1]);
  const special = [...body.matchAll(/(\w+):\s*(?!A\b|D\b)(\w+)/g)].filter((m) => /^[A-Z_]+$/.test(m[1]) && !['method', 'path', 'okStatus'].includes(m[1])).map((m) => `${m[1]}=${m[2]}`);
  (out[module] ??= []).push(`${method.padEnd(6)} ${path.padEnd(58)} ${pub ? 'PUBLIC' : allowed.join(',') || '(see spec)'}${special.length ? ' ' + special.join(',') : ''}`);
}
let n = 0;
for (const [m, list] of Object.entries(out).sort()) {
  console.log(`\n[${m}] ${list.length}`);
  for (const l of list) { console.log('  ' + l); n++; }
}
console.log(`\nTOTAL routes in RBAC matrix: ${n}`);
const unmatched = (src.match(/^\s{2}'(GET|POST|PUT|PATCH|DELETE) /gm) ?? []).length;
console.log(`matrix keys counted by a looser pattern: ${unmatched}`);
