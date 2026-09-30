// Phase 11.6 A1/A2: identifier format matrix against normalizeIdentifier.
import { normalizeIdentifier, MatchField } from '../../vidyasetu/api/src/fraud/fraud-match';

const show = (s: string) =>
  JSON.stringify(s).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export const BANK_CASES: Array<[string, string]> = [
  ['colon separator', 'SBIN0004455:88002002'],
  ['no separator', 'SBIN000445588002002'],
  ['space separator', 'SBIN0004455 88002002'],
  ['spaces inside', 'SBIN 0004455 8800 2002'],
  ['space-colon-space', 'sbin0004455 : 88002002'],
  ['hyphen separator', 'SBIN0004455-88002002'],
  ['space-hyphen-space', 'sbin0004455 - 88002002'],
  ['slash separator', 'SBIN0004455/88002002'],
  ['mixed case', 'sBiN0004455:88002002'],
  ['trailing whitespace + newline', 'SBIN0004455:88002002  \n'],
  ['fullwidth digits + colon', 'SBIN0004455：８８００２００２'],
  ['fullwidth letters', 'ＳＢＩＮ0004455:88002002'],
  ['Devanagari digits in account', 'SBIN0004455:८८००२००२'],
  ['non-breaking space separator', 'SBIN0004455 88002002'],
  ['zero-width space inside', 'SBIN0004455:8800​2002'],
  ['leading zero on account (DIFFERENT)', 'SBIN0004455:088002002'],
  ['Cyrillic look-alike B in IFSC', 'SВIN0004455:88002002'],
  ['account only, no IFSC', '88002002'],
];
export const CERT_CASES: Array<[string, string]> = [
  ['hyphens', 'JH-ST-2026-555001'],
  ['no separator', 'JHST2026555001'],
  ['spaces', 'jh st 2026 555001'],
  ['slashes', 'JH/ST/2026/555001'],
  ['mixed case', 'Jh-sT-2026-555001'],
  ['trailing whitespace', 'JH-ST-2026-555001 \t'],
  ['en dash separators', 'JH–ST–2026–555001'],
  ['fullwidth digits', 'JH-ST-２０２６-555001'],
  ['Devanagari digits', 'JH-ST-२०२६-555001'],
  ['leading zero (DIFFERENT)', 'JH-ST-2026-0555001'],
];

function table(field: MatchField, base: string, cases: Array<[string, string]>) {
  const ref = normalizeIdentifier(field, base);
  console.log(`\n${field}: reference ${show(base)} -> ${show(ref)}`);
  for (const [label, v] of cases) {
    const n = normalizeIdentifier(field, v);
    console.log(`  ${n === ref ? 'MATCH' : 'MISS '}  ${label.padEnd(36)} ${show(v).padEnd(64)} -> ${show(n)}`);
  }
}

table('bank_account', 'SBIN0004455:88002002', BANK_CASES);
console.log('\n  false-collision check (two DIFFERENT accounts typed in fullwidth digits):');
for (const v of ['SBIN0004455:１１１１１１１１', 'SBIN0004455:２２２２２２２２']) {
  console.log(`    ${show(v)} -> ${show(normalizeIdentifier('bank_account', v))}`);
}
table('caste_cert_number', 'JH-ST-2026-555001', CERT_CASES);
console.log('\n  structural collision check (differ only by separator placement):');
for (const [a, b] of [
  ['JH-ST-2026-5-55001', 'JH-ST-2026-55-5001'],
  ['JHCC/2026/12/345', 'JHCC/2026/123/45'],
  ['12/3456', '1234/56'],
]) {
  const same = normalizeIdentifier('caste_cert_number', a) === normalizeIdentifier('caste_cert_number', b);
  console.log(`    ${a.padEnd(20)} vs ${b.padEnd(20)} ${same ? 'COLLIDE' : 'distinct'}`);
}
