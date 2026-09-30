#!/usr/bin/env node
// Contrast check (no dependencies). Reads the colour tokens from
// src/tokens.css and prints WCAG 2 contrast ratios for every text/background
// pair the stylesheets use. Text needs 4.5:1; large text and UI parts
// (borders, focus ring, step underline) need 3:1. Exit 1 on any failure.
// Also counts hard-coded colours in src/*.css outside tokens.css.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'src');
const tokens = {};
for (const m of readFileSync(join(SRC, 'tokens.css'), 'utf8').matchAll(/(--c-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] ??= m[2];

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = ['--c-ink', '--c-muted', '--c-primary'];
const LIGHT_BG = ['--c-surface', '--c-page', '--c-subtle', '--c-primary-tint'];
// [foreground, background, minimum, what]
const pairs = [
  ...TEXT.flatMap((fg) => LIGHT_BG.map((bg) => [fg, bg, 4.5, 'text'])),
  ['--c-muted', '--c-track', 4.5, 'text (disabled button)'],
  ['--c-muted', '--c-warning-tint', 4.5, 'text (upload row needing action)'],
  ['--c-muted', '--c-success-tint', 4.5, 'text'],
  ['--c-success', '--c-surface', 4.5, 'text'],
  ['--c-success', '--c-success-tint', 4.5, 'text (chip, alert)'],
  ['--c-warning-text', '--c-surface', 4.5, 'text'],
  ['--c-warning-text', '--c-warning-tint', 4.5, 'text (chip, alert)'],
  ['--c-error-text', '--c-surface', 4.5, 'text'],
  ['--c-error-text', '--c-error-tint', 4.5, 'text (chip, alert)'],
  ['--c-primary', '--c-primary-tint', 4.5, 'text (chip)'],
  ['--c-on-navy', '--c-navy', 4.5, 'text (header bar, footer, buttons)'],
  ['--c-on-navy-muted', '--c-navy', 4.5, 'text (step bar, footer)'],
  ['--c-on-navy', '--c-primary', 4.5, 'text (blue button)'],
  ['--c-on-navy', '--c-primary-hover', 4.5, 'text (blue button hover)'],
  ['--c-on-navy', '--c-success', 4.5, 'text (selected banner)'],
  ['--c-on-navy', '--c-success-step', 4.5, 'text (completed step)'],
  ['--c-on-navy', '--c-error-text', 4.5, 'text (badge)'],
  ['--c-amber', '--c-navy', 3, 'UI (current-step underline)'],
  ['--c-border-strong', '--c-surface', 3, 'UI (form borders)'],
  ['--c-focus', '--c-surface', 3, 'UI (focus ring)'],
  ['--c-focus', '--c-page', 3, 'UI (focus ring)'],
];

let failed = 0;
console.log('| foreground | background | ratio | needs | result | use |\n|---|---|---|---|---|---|');
for (const [fg, bg, min, what] of pairs) {
  if (!tokens[fg] || !tokens[bg]) {
    console.log(`| ${fg} | ${bg} | missing token | ${min} | FAIL | ${what} |`);
    failed++;
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`| ${fg} ${tokens[fg]} | ${bg} ${tokens[bg]} | ${r.toFixed(2)} | ${min} | ${ok ? 'pass' : 'FAIL'} | ${what} |`);
}

const hard = [];
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.css') && f !== 'tokens.css')) {
  readFileSync(join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
    const m = line.replace(/\/\*.*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
    if (m) hard.push(`${f}:${i + 1}`);
  });
}
console.log(`\n${failed} failing pair(s). Hard-coded colours outside tokens.css: ${hard.length} line(s)${hard.length ? ` (${hard.slice(0, 8).join(', ')}${hard.length > 8 ? ', ...' : ''})` : ''}.`);
if (failed) process.exit(1);
