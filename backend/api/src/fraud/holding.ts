/**
 * A HIGH flag holds its application until an officer marks it FALSE_POSITIVE.
 * Read by the fraud hold guard (via FraudDetectionService.holdingFlags), the
 * review API and Phase 6's selection candidate pool.
 */
export const HOLDING_STATUSES = ['OPEN', 'NEEDS_MORE_INFO', 'CONFIRMED'] as const;
