#!/usr/bin/env node
// Type audit (no dependencies). Counts every font size in src, grouped by
// value, and lists where anything below 14px is used.
//   node scripts/type-audit.mjs            human-readable report
//   node scripts/type-audit.mjs --check    exit 1 if a size < 13px exists, or
//                                          a size < 14px outside a caption
// Sources scanned: Tailwind text-[..] and text-xs/sm/.. classes in .ts/.tsx,
// fontSize in inline styles, and font-size / font / --fs-* declarations in CSS.
// CSS custom properties are resolved (var(--fs-sm) -> 0.875rem) and clamp()
// is audited by its minimum. 1rem = 16px.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const TW = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48 };
// Tokens a size may be below 14px only for (non-essential hints).
const CAPTION_TOKENS = new Set(['--fs-caption']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => /\.(css|tsx?|mjs)$/.test(f) && !f.endsWith('schema.ts'));

const vars = {};
for (const f of files.filter((f) => f.endsWith('.css'))) {
  // First definition wins (the English base; the :lang(hi) overrides add 1px).
  for (const m of readFileSync(f, 'utf8').matchAll(/(--fs-[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] ??= m[2].trim();
}

function toPx(value, seen = new Set()) {
  value = value.trim();
  const v = value.match(/^var\((--[\w-]+)\)$/);
  if (v) return vars[v[1]] && !seen.has(v[1]) ? toPx(vars[v[1]], new Set([...seen, v[1]])) : null;
  const k = value.match(/^calc\(([\d.]+(?:px|rem))\s*\+\s*([\d.]+(?:px|rem))\)$/);
  if (k) return toPx(k[1]) + toPx(k[2]);
  const c = value.match(/^clamp\((calc\([^)]*\)|[^,]+),/);
  if (c) return toPx(c[1], seen);
  const n = value.match(/^(-?[\d.]+)(px|rem|em)$/);
  if (!n) return null;
  return n[2] === 'px' ? Number(n[1]) : Number(n[1]) * 16;
}
function tokenOf(value) {
  return value.match(/^var\((--[\w-]+)\)$/)?.[1] ?? null;
}

const uses = []; // { px, raw, where, token }
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  if (f.endsWith('.css')) {
    // Strip comments, then walk rule blocks.
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      for (const d of m[2].matchAll(/(?:^|;)\s*(font-size|font)\s*:\s*([^;]+)/g)) {
        let raw = d[2].trim();
        if (d[1] === 'font') {
          if (raw === 'inherit') continue;
          raw = raw.split(/\s+/).find((w) => /^(var\(--fs|[\d.]+(px|rem))/.test(w))?.split('/')[0] ?? raw;
        }
        uses.push({ px: toPx(raw), raw, where: `${rel}: ${selector}`, token: tokenOf(raw) });
      }
    }
  } else {
    for (const m of text.matchAll(/\btext-\[([\d.]+(?:px|rem))\]/g)) uses.push({ px: toPx(m[1]), raw: m[0], where: rel, token: null });
    for (const m of text.matchAll(/\btext-(xs|sm|base|lg|xl|[2-5]xl)\b/g)) uses.push({ px: TW[m[1]], raw: m[0], where: rel, token: null });
    for (const m of text.matchAll(/fontSize\s*:\s*['"]?([\d.]+(?:px|rem)?)/g)) uses.push({ px: toPx(/\d$/.test(m[1]) ? `${m[1]}px` : m[1]), raw: m[0], where: rel, token: null });
  }
}

const groups = new Map();
for (const u of uses) {
  const key = u.px === null ? `unresolved ${u.raw}` : `${u.px}px`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const sorted = [...groups].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]));
const below13 = uses.filter((u) => u.px !== null && u.px < 13);
const below14 = uses.filter((u) => u.px !== null && u.px < 14 && !CAPTION_TOKENS.has(u.token));
const captions = uses.filter((u) => u.px !== null && u.px < 14 && CAPTION_TOKENS.has(u.token));
const unresolved = uses.filter((u) => u.px === null);

console.log(`Font sizes in src: ${uses.length} declarations\n`);
console.log('| size | count |\n|---|---|');
for (const [k, n] of sorted) console.log(`| ${k} | ${n} |`);
console.log(`\nBelow 13px: ${below13.length}`);
for (const u of below13) console.log(`  ${u.px}px  ${u.where}`);
console.log(`Below 14px (essential, not a caption token): ${below14.length}`);
for (const u of below14.filter((u) => u.px >= 13)) console.log(`  ${u.px}px  ${u.where}`);
console.log(`Caption (13px, non-essential hints): ${captions.length}`);
for (const u of captions) console.log(`  ${u.where}`);
if (unresolved.length) {
  console.log(`Unresolved: ${unresolved.length}`);
  for (const u of unresolved) console.log(`  ${u.raw}  ${u.where}`);
}
if (process.argv.includes('--check') && (below13.length || below14.length || unresolved.length)) process.exit(1);
