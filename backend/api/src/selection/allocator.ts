/**
 * Generic merit / quota allocation.
 *
 * Knows nothing about VIDYASETU: candidates, vertical seat pools and
 * horizontal reservations arrive as plain data (see selection-policies.ts
 * for the concrete instance), mirroring src/rules-engine and src/workflow.
 *
 * Two allocation modes, deliberately separate functions:
 *   rankAllNoCap  - a real merit ranking but no capacity limit: everyone is
 *                   ranked and everyone is selected.
 *   allocateQuota - vertical pools with seat counts and horizontal
 *                   reservations inside each pool (compartment method).
 * (Selection without any ranking at all is not an allocation and is not in
 * this module: see SelectionService.)
 *
 * Determinism: every ordering here is total and explicit. Candidates are
 * ranked by (score by direction, submittedAtMs ascending, tieKey ascending,
 * id ascending) with plain code-unit string comparison; pools and
 * reservations are processed in their array order. Input order, database
 * row order and object key order never affect the result.
 */

export type ScoreDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
export type RoundingRule = 'HALF_UP' | 'FLOOR' | 'CEIL';

export interface Candidate {
  /** Unique id (final tie-break). */
  id: string;
  /** The merit value; null = no ranking value (cannot be ranked). */
  score: number | null;
  /** First tie-break: earlier submission ranks higher. */
  submittedAtMs: number;
  /** Second tie-break (e.g. an application number), ascending. */
  tieKey: string;
  /** Vertical tags: which pools the candidate may take a seat in. */
  verticalTags: readonly string[];
  /** Horizontal reservations the candidate qualifies for. */
  reservationTags: readonly string[];
}

export type ReservationMinimum = { count: number } | { percentage: number; rounding: RoundingRule };

export interface HorizontalReservation {
  key: string;
  minimum: ReservationMinimum;
}

export interface SeatPool {
  key: string;
  seats: number;
  /** A candidate is eligible for the pool if any of its verticalTags is listed. */
  eligibleTags: readonly string[];
  reservations: readonly HorizontalReservation[];
}

export interface RankedCandidate {
  candidate: Candidate;
  /** 1-based merit rank; null when the candidate has no ranking value. */
  rank: number | null;
}

export interface SelectedSeat {
  candidateId: string;
  rank: number | null;
  /** Pool key (QUOTA) or null (no-cap ranking has no pools). */
  pool: string | null;
  /** Reservation the candidate was seated UNDER; null = general / merit seat. */
  selectedUnder: string | null;
}

export type NotSelectedReason =
  'RANK_CUTOFF' | 'DISPLACED_BY_RESERVATION' | 'NO_ELIGIBLE_POOL' | 'NO_RANKING_VALUE';

export interface NotSelected {
  candidateId: string;
  rank: number | null;
  reason: NotSelectedReason;
  /** The pool the candidate competed in, if any. */
  pool: string | null;
}

export interface ReservationOutcome {
  pool: string;
  reservation: string;
  required: number;
  /** Qualifying candidates seated in the pool (merit + reserved seats). */
  achieved: number;
  seatedOnMerit: number;
  seatedUnderReservation: number;
  shortfall: number;
  shortfallReason: string | null;
}

export interface PoolOutcome {
  pool: string;
  seats: number;
  filled: number;
  unfilled: number;
}

export interface AllocationResult {
  selected: SelectedSeat[];
  notSelected: NotSelected[];
  pools: PoolOutcome[];
  reservations: ReservationOutcome[];
}

export class AllocationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationInputError';
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total order: score by direction, then submittedAtMs, tieKey, id (all ascending). */
export function compareCandidates(a: Candidate, b: Candidate, direction: ScoreDirection): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    const byScore = direction === 'HIGHER_IS_BETTER' ? b.score - a.score : a.score - b.score;
    if (byScore !== 0) return byScore;
  }
  if (a.submittedAtMs !== b.submittedAtMs) return a.submittedAtMs - b.submittedAtMs;
  return compareStrings(a.tieKey, b.tieKey) || compareStrings(a.id, b.id);
}

function validateCandidates(candidates: readonly Candidate[]): void {
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) throw new AllocationInputError(`duplicate candidate id "${c.id}"`);
    seen.add(c.id);
    if (c.score !== null && !Number.isFinite(c.score)) {
      throw new AllocationInputError(`candidate "${c.id}" has a non-finite score`);
    }
    if (!Number.isFinite(c.submittedAtMs)) {
      throw new AllocationInputError(`candidate "${c.id}" has no valid submission time`);
    }
  }
}

/** Ranks candidates; those without a score come last with rank null. */
export function rankCandidates(
  candidates: readonly Candidate[],
  direction: ScoreDirection,
): RankedCandidate[] {
  validateCandidates(candidates);
  const sorted = [...candidates].sort((a, b) => compareCandidates(a, b, direction));
  let next = 1;
  return sorted.map((candidate) => ({
    candidate,
    rank: candidate.score === null ? null : next++,
  }));
}

/** Seats a reservation minimum requires in a pool of `seats`, per its rounding rule. */
export function requiredSeats(minimum: ReservationMinimum, seats: number): number {
  if ('count' in minimum) return Math.min(minimum.count, seats);
  // Exact percentage x seats / 100 as a fraction, rounded without float drift
  // (percentages are scaled to integers first).
  const scale = 1e6;
  const numerator = Math.round(minimum.percentage * scale) * seats;
  const denominator = 100 * scale;
  const floor = Math.floor(numerator / denominator);
  const remainder = numerator - floor * denominator;
  let value: number;
  switch (minimum.rounding) {
    case 'FLOOR':
      value = floor;
      break;
    case 'CEIL':
      value = remainder > 0 ? floor + 1 : floor;
      break;
    case 'HALF_UP':
      value = remainder * 2 >= denominator ? floor + 1 : floor;
      break;
    default:
      throw new AllocationInputError(`unknown rounding rule "${String(minimum.rounding)}"`);
  }
  return Math.min(value, seats);
}

/**
 * Real merit ranking, no capacity limit: every candidate is selected, in
 * merit order. Candidates without a ranking value are still selected (no
 * cap to compete for) but unranked, after the ranked ones.
 */
export function rankAllNoCap(
  candidates: readonly Candidate[],
  direction: ScoreDirection,
): AllocationResult {
  return {
    selected: rankCandidates(candidates, direction).map(({ candidate, rank }) => ({
      candidateId: candidate.id,
      rank,
      pool: null,
      selectedUnder: null,
    })),
    notSelected: [],
    pools: [],
    reservations: [],
  };
}

function validatePools(pools: readonly SeatPool[]): void {
  const keys = new Set<string>();
  for (const pool of pools) {
    if (keys.has(pool.key)) throw new AllocationInputError(`duplicate pool "${pool.key}"`);
    keys.add(pool.key);
    if (!Number.isInteger(pool.seats) || pool.seats < 0) {
      throw new AllocationInputError(`pool "${pool.key}" has an invalid seat count`);
    }
    const rKeys = new Set<string>();
    for (const r of pool.reservations) {
      if (rKeys.has(r.key)) {
        throw new AllocationInputError(`duplicate reservation "${r.key}" in "${pool.key}"`);
      }
      rKeys.add(r.key);
      const m = r.minimum;
      const bad =
        'count' in m
          ? !Number.isInteger(m.count) || m.count < 0
          : !Number.isFinite(m.percentage) || m.percentage < 0 || m.percentage > 100;
      if (bad) throw new AllocationInputError(`reservation "${r.key}" in "${pool.key}" is invalid`);
    }
  }
}

interface Seat {
  ranked: RankedCandidate;
  under: string | null;
}

/**
 * Compartment method, per pool in array order:
 *   1. fill the pool's seats by pure merit from the not-yet-selected
 *      candidates eligible for it;
 *   2. for each horizontal reservation in order, count seated candidates who
 *      qualify (merit winners count, and stay recorded as general seats);
 *   3. while short: replace the lowest-ranked seated candidate who is on a
 *      general seat, does not qualify for this reservation and whose removal
 *      would not break an earlier reservation, with the highest-ranked
 *      unseated eligible candidate who qualifies - seated UNDER the
 *      reservation;
 *   4. stop when met, or report the shortfall if no qualifying candidate or
 *      no displaceable seat is left.
 * Candidates without a ranking value never take a quota seat.
 */
export function allocateQuota(
  candidates: readonly Candidate[],
  direction: ScoreDirection,
  pools: readonly SeatPool[],
): AllocationResult {
  validatePools(pools);
  const ranked = rankCandidates(candidates, direction);
  const taken = new Set<string>();
  const displaced = new Map<string, string>(); // candidate id -> pool
  const competedIn = new Map<string, string>(); // first pool a candidate was eligible for
  const selected: SelectedSeat[] = [];
  const poolOutcomes: PoolOutcome[] = [];
  const reservationOutcomes: ReservationOutcome[] = [];

  for (const pool of pools) {
    const eligible = ranked.filter(
      (r) =>
        r.rank !== null &&
        !taken.has(r.candidate.id) &&
        r.candidate.verticalTags.some((t) => pool.eligibleTags.includes(t)),
    );
    for (const r of eligible) {
      if (!competedIn.has(r.candidate.id)) competedIn.set(r.candidate.id, pool.key);
    }

    const seats: Seat[] = eligible.slice(0, pool.seats).map((r) => ({ ranked: r, under: null }));
    const seated = (id: string) => seats.some((s) => s.ranked.candidate.id === id);
    const qualifies = (s: Seat | RankedCandidate, key: string) =>
      ('ranked' in s ? s.ranked : s).candidate.reservationTags.includes(key);
    const count = (key: string) => seats.filter((s) => qualifies(s, key)).length;
    const required = new Map(
      pool.reservations.map((r) => [r.key, requiredSeats(r.minimum, pool.seats)] as const),
    );

    const processed: string[] = [];
    for (const reservation of pool.reservations) {
      const need = required.get(reservation.key)!;
      let shortfallReason: string | null = null;

      while (count(reservation.key) < need) {
        const incoming = eligible.find(
          (r) => !seated(r.candidate.id) && qualifies(r, reservation.key),
        );
        if (!incoming) {
          shortfallReason = 'not enough qualifying candidates';
          break;
        }
        if (seats.length < pool.seats) {
          seats.push({ ranked: incoming, under: reservation.key });
          continue;
        }
        // Lowest-ranked displaceable general seat.
        let outIndex = -1;
        for (let i = seats.length - 1; i >= 0; i--) {
          const s = seats[i];
          if (s.under !== null || qualifies(s, reservation.key)) continue;
          const breaksEarlier = processed.some(
            (k) => qualifies(s, k) && count(k) - 1 < required.get(k)!,
          );
          if (!breaksEarlier) {
            outIndex = i;
            break;
          }
        }
        if (outIndex === -1) {
          shortfallReason = 'no displaceable general seat left';
          break;
        }
        displaced.set(seats[outIndex].ranked.candidate.id, pool.key);
        seats.splice(outIndex, 1);
        seats.push({ ranked: incoming, under: reservation.key });
      }

      const achieved = count(reservation.key);
      const underIt = seats.filter((s) => s.under === reservation.key).length;
      reservationOutcomes.push({
        pool: pool.key,
        reservation: reservation.key,
        required: need,
        achieved,
        seatedOnMerit: achieved - underIt,
        seatedUnderReservation: underIt,
        shortfall: Math.max(0, need - achieved),
        shortfallReason: achieved < need ? shortfallReason : null,
      });
      processed.push(reservation.key);
    }

    seats.sort((a, b) => a.ranked.rank! - b.ranked.rank!);
    for (const s of seats) {
      taken.add(s.ranked.candidate.id);
      displaced.delete(s.ranked.candidate.id);
      selected.push({
        candidateId: s.ranked.candidate.id,
        rank: s.ranked.rank,
        pool: pool.key,
        selectedUnder: s.under,
      });
    }
    poolOutcomes.push({
      pool: pool.key,
      seats: pool.seats,
      filled: seats.length,
      unfilled: pool.seats - seats.length,
    });
  }

  const notSelected: NotSelected[] = ranked
    .filter((r) => !taken.has(r.candidate.id))
    .map((r) => {
      const id = r.candidate.id;
      const pool = competedIn.get(id) ?? null;
      const reason: NotSelectedReason =
        r.rank === null
          ? 'NO_RANKING_VALUE'
          : displaced.has(id)
            ? 'DISPLACED_BY_RESERVATION'
            : pool === null
              ? 'NO_ELIGIBLE_POOL'
              : 'RANK_CUTOFF';
      return { candidateId: id, rank: r.rank, reason, pool };
    });

  return { selected, notSelected, pools: poolOutcomes, reservations: reservationOutcomes };
}
