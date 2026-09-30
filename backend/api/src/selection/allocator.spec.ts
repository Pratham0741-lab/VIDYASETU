import {
  AllocationInputError,
  allocateQuota,
  Candidate,
  rankAllNoCap,
  rankCandidates,
  requiredSeats,
  SeatPool,
} from './allocator';

// Synthetic, hand-computed cases. Names are deliberately generic: the
// allocator must not depend on any VIDYASETU vocabulary.
let clock = 0;
function c(
  id: string,
  score: number | null,
  vertical: string[] = ['A'],
  reservations: string[] = [],
  submittedAtMs?: number,
): Candidate {
  return {
    id,
    score,
    submittedAtMs: submittedAtMs ?? ++clock,
    tieKey: `K-${id}`,
    verticalTags: vertical,
    reservationTags: reservations,
  };
}

const pool = (seats: number, reservations: SeatPool['reservations'] = [], key = 'A'): SeatPool => ({
  key,
  seats,
  eligibleTags: [key],
  reservations,
});
const pct = (key: string, percentage: number) => ({
  key,
  minimum: { percentage, rounding: 'HALF_UP' as const },
});

const summary = (r: ReturnType<typeof allocateQuota>) => ({
  selected: r.selected.map(
    (s) => `${s.candidateId}#${s.rank}${s.selectedUnder ? `:${s.selectedUnder}` : ''}`,
  ),
  notSelected: r.notSelected.map((n) => `${n.candidateId}:${n.reason}`),
});

describe('ranking order is total and explicit', () => {
  it('orders by score, then submission time, then tieKey, then id; unscored last', () => {
    const cs = [
      c('late', 90, ['A'], [], 20),
      c('early', 90, ['A'], [], 10),
      { ...c('keyB', 90, ['A'], [], 10), tieKey: 'K-z' },
      c('top', 95),
      c('none', null),
    ];
    const ranked = rankCandidates(cs, 'HIGHER_IS_BETTER').map((r) => `${r.candidate.id}#${r.rank}`);
    expect(ranked).toEqual(['top#1', 'early#2', 'keyB#3', 'late#4', 'none#null']);
  });

  it('is independent of input order', () => {
    const cs = [c('a', 5), c('b', 5, ['A'], [], clock), c('d', 7), c('e', 1)];
    const forward = allocateQuota(cs, 'HIGHER_IS_BETTER', [pool(2, [pct('F', 50)])]);
    const reversed = allocateQuota([...cs].reverse(), 'HIGHER_IS_BETTER', [
      pool(2, [pct('F', 50)]),
    ]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it('LOWER_IS_BETTER ranks the smallest value first (e.g. a published rank)', () => {
    const ranked = rankCandidates([c('x', 300), c('y', 12), c('z', 1500)], 'LOWER_IS_BETTER');
    expect(ranked.map((r) => r.candidate.id)).toEqual(['y', 'x', 'z']);
  });

  it('rejects duplicate candidate ids', () => {
    expect(() => rankCandidates([c('a', 1), c('a', 2)], 'HIGHER_IS_BETTER')).toThrow(
      AllocationInputError,
    );
  });
});

describe('requiredSeats rounding (rule comes from data)', () => {
  it.each([
    [30, 17, 'HALF_UP', 5], // 5.1
    [30, 3, 'HALF_UP', 1], // 0.9
    [50, 3, 'HALF_UP', 2], // 1.5 -> 2
    [30, 3, 'FLOOR', 0],
    [30, 17, 'CEIL', 6],
    [33.3, 3, 'HALF_UP', 1], // 0.999
  ] as const)('%d%% of %d seats, %s -> %d', (percentage, seats, rounding, expected) => {
    expect(requiredSeats({ percentage, rounding }, seats)).toBe(expected);
  });

  it('a count minimum is capped at the pool size', () => {
    expect(requiredSeats({ count: 9 }, 4)).toBe(4);
  });
});

describe('ranked, no capacity limit', () => {
  it('selects everyone in merit order; unscored are selected but unranked', () => {
    const r = rankAllNoCap(
      [c('m', 70), c('n', 88), c('o', null), c('p', 70.5)],
      'HIGHER_IS_BETTER',
    );
    expect(r.selected.map((s) => `${s.candidateId}#${s.rank}`)).toEqual([
      'n#1',
      'p#2',
      'm#3',
      'o#null',
    ]);
    expect(r.notSelected).toEqual([]);
    expect(r.selected.every((s) => s.pool === null && s.selectedUnder === null)).toBe(true);
  });
});

describe('quota with horizontal reservations (compartment method)', () => {
  // Case 1: merit fill alone satisfies the reservation.
  it('no swap needed when merit already meets the minimum', () => {
    const cs = [c('a1', 99, ['A'], ['F']), c('a2', 90), c('a3', 80), c('a4', 70, ['A'], ['F'])];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', [pool(3, [pct('F', 30)])]); // need 1
    expect(summary(r)).toEqual({
      selected: ['a1#1', 'a2#2', 'a3#3'],
      notSelected: ['a4:RANK_CUTOFF'],
    });
    expect(r.reservations[0]).toMatchObject({
      required: 1,
      achieved: 1,
      seatedOnMerit: 1,
      seatedUnderReservation: 0,
      shortfall: 0,
    });
  });

  // Case 2: a reserved candidate outside the top-N is pulled in.
  it('swaps in a qualifying candidate ranked outside the merit cutoff', () => {
    // Merit top 3: b1,b2,b3 (no F). Need 1 F (30% of 3 = 0.9 -> 1).
    // Lowest general non-F seat b3 is displaced by the best F, b5 (rank 5).
    const cs = [c('b1', 95), c('b2', 90), c('b3', 85), c('b4', 80), c('b5', 75, ['A'], ['F'])];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', [pool(3, [pct('F', 30)])]);
    expect(summary(r)).toEqual({
      selected: ['b1#1', 'b2#2', 'b5#5:F'],
      notSelected: ['b3:DISPLACED_BY_RESERVATION', 'b4:RANK_CUTOFF'],
    });
  });

  // Case 3: a reservation-eligible candidate high enough for a general seat.
  it('records a qualifying candidate who won on merit as general, not reserved', () => {
    // Need 2 F in 4 seats (50%). c1 (F, rank 1) counts on merit and stays
    // general; one more F is needed: c6 (rank 6) replaces c4 (rank 4).
    const cs = [
      c('c1', 99, ['A'], ['F']),
      c('c2', 90),
      c('c3', 85),
      c('c4', 80),
      c('c5', 75),
      c('c6', 70, ['A'], ['F']),
    ];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', [pool(4, [pct('F', 50)])]);
    expect(summary(r).selected).toEqual(['c1#1', 'c2#2', 'c3#3', 'c6#6:F']);
    expect(r.selected.find((s) => s.candidateId === 'c1')!.selectedUnder).toBeNull();
    expect(r.reservations[0]).toMatchObject({ seatedOnMerit: 1, seatedUnderReservation: 1 });
  });

  // Case 4: vertical AND horizontal at the same time.
  it('records both the vertical pool and the horizontal reservation for one candidate', () => {
    // Pools: MAIN (2 seats, 50% F) and MINOR (2 seats, 50% F). d4 is MINOR
    // (vertical) and F (horizontal), ranked below both other MINOR members.
    const pools: SeatPool[] = [
      { key: 'MAIN', seats: 2, eligibleTags: ['main'], reservations: [pct('F', 50)] },
      { key: 'MINOR', seats: 2, eligibleTags: ['minor'], reservations: [pct('F', 50)] },
    ];
    const cs = [
      c('d1', 99, ['main'], ['F']),
      c('d2', 95, ['main']),
      c('d3', 90, ['minor']),
      c('d5', 88, ['minor']),
      c('d4', 60, ['minor'], ['F']),
    ];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', pools);
    expect(r.selected).toEqual([
      { candidateId: 'd1', rank: 1, pool: 'MAIN', selectedUnder: null },
      { candidateId: 'd2', rank: 2, pool: 'MAIN', selectedUnder: null },
      { candidateId: 'd3', rank: 3, pool: 'MINOR', selectedUnder: null },
      { candidateId: 'd4', rank: 5, pool: 'MINOR', selectedUnder: 'F' },
    ]);
    expect(r.notSelected).toEqual([
      { candidateId: 'd5', rank: 4, reason: 'DISPLACED_BY_RESERVATION', pool: 'MINOR' },
    ]);
  });

  // Case 5: not enough qualifying candidates.
  it('reports a shortfall gracefully when too few candidates qualify', () => {
    // Need 3 F of 5 seats (60%); only one F candidate exists, ranked 7th.
    const cs = [
      c('e1', 99),
      c('e2', 98),
      c('e3', 97),
      c('e4', 96),
      c('e5', 95),
      c('e6', 94),
      c('e7', 93, ['A'], ['F']),
    ];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', [pool(5, [pct('F', 60)])]);
    expect(summary(r)).toEqual({
      selected: ['e1#1', 'e2#2', 'e3#3', 'e4#4', 'e7#7:F'],
      notSelected: ['e5:DISPLACED_BY_RESERVATION', 'e6:RANK_CUTOFF'],
    });
    expect(r.reservations[0]).toEqual({
      pool: 'A',
      reservation: 'F',
      required: 3,
      achieved: 1,
      seatedOnMerit: 0,
      seatedUnderReservation: 1,
      shortfall: 2,
      shortfallReason: 'not enough qualifying candidates',
    });
  });

  it('a candidate without the data for a reservation is simply not considered for it', () => {
    // g2 has no reservation tags (e.g. did not state gender): no error,
    // just not eligible for F; the shortfall is reported.
    const r = allocateQuota([c('g1', 90), c('g2', 80)], 'HIGHER_IS_BETTER', [
      pool(2, [pct('F', 50)]),
    ]);
    expect(summary(r).selected).toEqual(['g1#1', 'g2#2']);
    expect(r.reservations[0]).toMatchObject({ required: 1, achieved: 0, shortfall: 1 });
  });

  it('under-filled pool: unfilled seats reported, nobody cut off', () => {
    const r = allocateQuota([c('h1', 50)], 'HIGHER_IS_BETTER', [pool(3)]);
    expect(r.pools).toEqual([{ pool: 'A', seats: 3, filled: 1, unfilled: 2 }]);
  });

  it('a later reservation never displaces a seat an earlier reservation depends on', () => {
    // Need 1 F and 1 P in 2 seats. Merit: k1 (F), k2. For P, the only
    // displaceable seat is k2 (k1 is the pool's only F).
    const cs = [c('k1', 99, ['A'], ['F']), c('k2', 90), c('k3', 10, ['A'], ['P'])];
    const r = allocateQuota(cs, 'HIGHER_IS_BETTER', [
      pool(2, [
        { key: 'F', minimum: { count: 1 } },
        { key: 'P', minimum: { count: 1 } },
      ]),
    ]);
    expect(summary(r).selected).toEqual(['k1#1', 'k3#3:P']);
  });

  it('candidates without a ranking value never take a quota seat', () => {
    const r = allocateQuota([c('n1', null), c('n2', 10)], 'HIGHER_IS_BETTER', [pool(2)]);
    expect(summary(r)).toEqual({ selected: ['n2#1'], notSelected: ['n1:NO_RANKING_VALUE'] });
  });

  it('rejects invalid pool data instead of guessing', () => {
    expect(() => allocateQuota([], 'HIGHER_IS_BETTER', [pool(-1)])).toThrow(AllocationInputError);
    expect(() => allocateQuota([], 'HIGHER_IS_BETTER', [pool(2, [pct('F', 130)])])).toThrow(
      AllocationInputError,
    );
  });
});
