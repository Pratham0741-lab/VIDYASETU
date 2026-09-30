/**
 * Fuzzy identity scoring for FUZZY_IDENTITY_MATCH (Phase 11).
 *
 * UNCALIBRATED: no labelled duplicate / look-alike data exists (Group C's
 * generator has produced none), so the weights and cut-offs below are set
 * against hand-constructed cases only. Hence advisory: a match is LOW or
 * MEDIUM, never HIGH, and never holds an application.
 */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'shree', 'smt', 'km', 'dr']);

export interface IdentityRecord {
  first_name: string;
  last_name: string;
  dob: string | null; // YYYY-MM-DD
  domicile_district: string | null;
}

export type TokenRelation = 'SAME' | 'TRANSLITERATION' | 'INITIAL' | 'ONE_EDIT' | 'DIFFERENT';
export type DobRelation = 'EXACT' | 'DAY_MONTH_SWAP' | 'ONE_DIGIT' | 'DIFFERENT';

export interface IdentityScore {
  score: number;
  name_relation: TokenRelation;
  dob_relation: DobRelation;
  district_match: boolean;
  severity: 'LOW' | 'MEDIUM' | null;
}

const NAME_WEIGHT = 0.5;
const DOB_WEIGHT = 0.3;
const DISTRICT_WEIGHT = 0.2;
const RELATION_SCORE: Record<TokenRelation, number> = {
  SAME: 1,
  TRANSLITERATION: 0.9,
  INITIAL: 0.8,
  ONE_EDIT: 0.8,
  DIFFERENT: 0,
};
const DOB_SCORE: Record<DobRelation, number> = {
  EXACT: 1,
  DAY_MONTH_SWAP: 0.8,
  ONE_DIGIT: 0.7,
  DIFFERENT: 0,
};
export const MEDIUM_AT = 0.9;
export const LOW_AT = 0.75;

function tokens(first: string, last: string): string[] {
  const t = `${first} ${last}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (t.length > 1 && TITLES.has(t[0])) t.shift();
  return t;
}

/** Common Indian romanisation variants folded together (Laxmi / Lakshmi, Suneeta / Sunita, Vikas / Bikash). */
export function transliterationKey(token: string): string {
  return token
    .replace(/ksh/g, 'k')
    .replace(/x/g, 'k')
    .replace(/sh/g, 's')
    .replace(/(th|dh|ph|bh|kh|gh|ch|jh)/g, (m) => m[0])
    .replace(/w/g, 'v')
    .replace(/b/g, 'v')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/(.)\1+/g, '$1')
    .replace(/y$/, 'i');
}

function oneEdit(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length === 1) return true;
    return (
      diff.length === 2 &&
      diff[1] === diff[0] + 1 &&
      a[diff[0]] === b[diff[1]] &&
      a[diff[1]] === b[diff[0]]
    );
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

export function tokenRelation(a: string, b: string): TokenRelation {
  if (a === b) return 'SAME';
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 'INITIAL';
  if (transliterationKey(a) === transliterationKey(b)) return 'TRANSLITERATION';
  if (oneEdit(a, b)) return 'ONE_EDIT';
  return 'DIFFERENT';
}

const ORDER: TokenRelation[] = ['DIFFERENT', 'INITIAL', 'ONE_EDIT', 'TRANSLITERATION', 'SAME'];
const worst = (rels: TokenRelation[]) =>
  rels.reduce(
    (w, r) =>
      RELATION_SCORE[r] < RELATION_SCORE[w] ||
      (RELATION_SCORE[r] === RELATION_SCORE[w] && ORDER.indexOf(r) < ORDER.indexOf(w))
        ? r
        : w,
    'SAME' as TokenRelation,
  );

/** Given name and surname must each correspond; a middle name may be dropped or initialled. */
export function nameRelation(a: IdentityRecord, b: IdentityRecord): TokenRelation {
  const ta = tokens(a.first_name, a.last_name);
  const tb = tokens(b.first_name, b.last_name);
  if (ta.length === 0 || tb.length === 0) return 'DIFFERENT';
  if ([...ta].sort().join(' ') === [...tb].sort().join(' ')) return 'SAME'; // word order only
  const rels = [tokenRelation(ta[0], tb[0]), tokenRelation(ta[ta.length - 1], tb[tb.length - 1])];
  const ma = ta.slice(1, -1);
  const mb = tb.slice(1, -1);
  if (ma.length > 0 && ma.length === mb.length)
    ma.forEach((m, i) => rels.push(tokenRelation(m, mb[i])));
  return worst(rels);
}

export function dobRelation(a: string | null, b: string | null): DobRelation {
  if (!a || !b) return 'DIFFERENT';
  if (a === b) return 'EXACT';
  const [ya, ma, da] = a.split('-');
  const [yb, mb, db] = b.split('-');
  if (ya === yb && ma === db && da === mb && Number(ma) <= 12 && Number(da) <= 12)
    return 'DAY_MONTH_SWAP';
  const diffs = [...a].filter((c, i) => c !== b[i]).length;
  if (a.length === b.length && diffs === 1) return 'ONE_DIGIT';
  return 'DIFFERENT';
}

export function scoreIdentityPair(a: IdentityRecord, b: IdentityRecord): IdentityScore {
  const name = nameRelation(a, b);
  const dob = dobRelation(a.dob, b.dob);
  const district =
    !!a.domicile_district &&
    !!b.domicile_district &&
    a.domicile_district.trim().toLowerCase() === b.domicile_district.trim().toLowerCase();
  const nameScore = RELATION_SCORE[name];
  const dobScore = DOB_SCORE[dob];
  const score =
    Math.round(
      (NAME_WEIGHT * nameScore + DOB_WEIGHT * dobScore + DISTRICT_WEIGHT * (district ? 1 : 0)) *
        1000,
    ) / 1000;
  // A candidate needs a corresponding name AND a corresponding date of birth.
  const candidate = nameScore >= 0.8 && dobScore >= 0.7;
  const severity = !candidate
    ? null
    : score >= MEDIUM_AT
      ? 'MEDIUM'
      : score >= LOW_AT
        ? 'LOW'
        : null;
  return { score, name_relation: name, dob_relation: dob, district_match: district, severity };
}
