import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requiredSeats } from './allocator';
import { reservationTagsFor, SelectionPolicyError, selectionPolicyFor } from './selection-policies';

type SeedVersion = {
  scheme_code: string;
  version_no: number;
  effective_to: string | null;
  config: { rules: Array<Record<string, unknown>> };
};
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];
const active = SEED.filter((v) => v.effective_to === null || v.effective_to === undefined);
const config = (code: string) => active.find((v) => v.scheme_code === code)!.config;

describe('selection policies from the real seeded active versions', () => {
  it('maps each active version to exactly one explicit basis', () => {
    expect(
      Object.fromEntries(
        active.map((v) => [
          `${v.scheme_code} v${v.version_no}`,
          selectionPolicyFor(v.config).basis,
        ]),
      ),
    ).toEqual({
      'PRE_MATRIC v4': 'NO_COMPETITION',
      'POST_MATRIC v2': 'NO_COMPETITION',
      'TOP_CLASS v3': 'NO_COMPETITION',
      'NFST v5': 'RANKED_NO_CAP', // v5 (Phase 12, M16): same rules as v4, working stipend rates added
      'NOS v2': 'QUOTA',
    });
  });

  it('NOS v2: real seat counts, 30% female per pool rounded half up (5 of 17, 1 of 3), QS rank ascending', () => {
    const policy = selectionPolicyFor(config('NOS'));
    if (policy.basis !== 'QUOTA') throw new Error('expected QUOTA');
    expect(policy.merit).toMatchObject({
      ruleId: 'nos_selection_priority_rules',
      direction: 'LOWER_IS_BETTER',
      operandPath: 'applicant.university_qs_ranking',
    });
    expect(
      policy.pools.map((p) => [
        p.key,
        p.seats,
        p.eligibleTags,
        p.reservations.map((r) => [r.key, r.minimum, requiredSeats(r.minimum, p.seats)]),
      ]),
    ).toEqual([
      ['ST_OTHERS', 17, ['ST'], [['FEMALE', { percentage: 30, rounding: 'HALF_UP' }, 5]]],
      ['PVTG', 3, ['PVTG'], [['FEMALE', { percentage: 30, rounding: 'HALF_UP' }, 1]]],
    ]);
  });

  it('a version stating its own rounding rule overrides the default (data, not code)', () => {
    const cfg = JSON.parse(JSON.stringify(config('NOS'))) as SeedVersion['config'];
    const slots = cfg.rules.find((r) => r.id === 'nos_slots_allocation')!;
    (slots.params as Record<string, unknown>).female_earmark_rounding = 'FLOOR';
    const policy = selectionPolicyFor(cfg);
    if (policy.basis !== 'QUOTA') throw new Error('expected QUOTA');
    expect(requiredSeats(policy.pools[1].reservations[0].minimum, 3)).toBe(0);
  });

  it('NFST v4: ranked by its COMPUTED merit score, no cap, limitation stated', () => {
    const policy = selectionPolicyFor(config('NFST'));
    if (policy.basis !== 'RANKED_NO_CAP') throw new Error('expected RANKED_NO_CAP');
    expect(policy.merit).toMatchObject({
      ruleId: 'nfst_selection_criteria',
      direction: 'HIGHER_IS_BETTER',
      read: 'RESULT_VALUE',
    });
    expect(policy.limitation).toContain('no verified seat cap');
  });

  it('refuses a version with an unrecognised operational rule instead of guessing', () => {
    const cfg = { rules: [{ id: 'mystery_score', type: 'operational', params: {} }] };
    expect(() => selectionPolicyFor(cfg)).toThrow(SelectionPolicyError);
  });

  it('only a recorded FEMALE gender qualifies for the female reservation', () => {
    expect(reservationTagsFor({ gender: 'FEMALE' })).toEqual(['FEMALE']);
    expect(reservationTagsFor({ gender: 'MALE' })).toEqual([]);
    expect(reservationTagsFor({ gender: null })).toEqual([]);
  });
});
