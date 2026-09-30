/**
 * Small-count protection for analytics breakdowns (by district, institution
 * or deficiency code). Counts from 1 to SMALL_COUNT_THRESHOLD - 1 are
 * replaced by SUPPRESSED; 0 is shown (it identifies nobody).
 *
 * A row whose applicant count is suppressed is masked entirely (every count
 * and amount in it), and secondary suppression stops a masked cell being
 * recovered by subtraction: within each group that is published with a
 * total, a column with exactly one masked cell also masks its smallest
 * other non-zero cell - marked SECONDARY_SUPPRESSED ("suppressed"), never
 * "<5", because its true value may be any size.
 */
export const SMALL_COUNT_THRESHOLD = 5;
/** Primary: the true count is 1-4. */
export const SUPPRESSED = '<5' as const;
/** Secondary: the true count may be any size; hidden so a '<5' cell cannot be derived. */
export const SECONDARY_SUPPRESSED = 'suppressed' as const;
export type Masked = number | typeof SUPPRESSED | typeof SECONDARY_SUPPRESSED | null;

export function maskCount(n: number): number | typeof SUPPRESSED {
  return n > 0 && n < SMALL_COUNT_THRESHOLD ? SUPPRESSED : n;
}

type Row = Record<string, unknown>;

/**
 * Masks `countKeys` (and `amountKeys` when the row's applicant count is
 * masked) in place-copied rows; applies secondary suppression per group.
 */
export function suppressRows<T extends Row>(
  rows: T[],
  opts: {
    applicantKey: string;
    countKeys: string[];
    amountKeys?: string[];
    groupKey?: (row: T) => string;
  },
): Array<Record<string, unknown>> {
  const out = rows.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    const applicants = Number(r[opts.applicantKey] ?? 0);
    const wholeRow = applicants > 0 && applicants < SMALL_COUNT_THRESHOLD;
    for (const k of opts.countKeys) {
      const n = Number(r[k] ?? 0);
      copy[k] = wholeRow && n > 0 ? SUPPRESSED : maskCount(n);
    }
    for (const k of opts.amountKeys ?? []) {
      // An amount is not a count: its marker never claims "<5".
      if (wholeRow) copy[k] = r[k] === null ? null : SECONDARY_SUPPRESSED;
    }
    return copy;
  });

  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const g = opts.groupKey ? opts.groupKey(r) : '';
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });
  for (const idx of groups.values()) {
    for (const k of opts.countKeys) {
      const masked = idx.filter(
        (i) => out[i][k] === SUPPRESSED || out[i][k] === SECONDARY_SUPPRESSED,
      );
      if (masked.length !== 1) continue;
      const next = idx
        .filter((i) => typeof out[i][k] === 'number' && out[i][k] > 0)
        .sort((a, b) => (out[a][k] as number) - (out[b][k] as number))[0];
      if (next !== undefined) out[next][k] = SECONDARY_SUPPRESSED;
    }
  }
  return out;
}
