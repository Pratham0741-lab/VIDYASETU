import { createHash } from 'node:crypto';
import { canonicalize, JsonNumber, JsonValue, parseJson } from './canonical';

/**
 * Chain verification (Phase 13A; denials chain added in 13B). Pure: the rows
 * come from an AuditSource (Prisma in the api and the CLI, an in-memory list
 * in tests), so the endpoint and the CLI run exactly this code.
 *
 * Both chains (audit_logs and authorization_denials), hash_version 2:
 *   record_hash = sha256(hash_input)
 *   hash_input  = canonical JSON of the row's envelope (stored verbatim)
 *   prev_hash   = record_hash of seq - 1 (NULL for seq 1)
 * Legacy rows (seq NULL) are not recomputable; CHECKPOINT rows in the audit
 * chain anchor their count, time range and digest: kind LEGACY_CHECKPOINT
 * (audit_logs, at seq 1) and kind DENIALS_LEGACY_CHECKPOINT.
 */
export const HASH_VERSION = 2;

/** Columns every chain row has. */
export interface ChainRow {
  id: string;
  seq: string | null;
  hash_version: number | null;
  prev_hash: string | null;
  record_hash: string;
  hash_input: string | null;
}

/** One audit_logs row as the source returns it (text columns, exact). */
export interface AuditRowText extends ChainRow {
  table_name: string;
  record_id: string;
  action: string;
  actor_id: string | null;
  actor_user_id: string | null;
  actor_type: string | null;
  actor_role: string | null;
  ip_address: string | null;
  row_data: string; // row_data::text
  created_at_us: string; // integer microseconds since the epoch, as text
}

/** One authorization_denials row as the source returns it (text columns, exact). */
export interface DenialRowText extends ChainRow {
  occurred_at_us: string;
  actor_user_id: string | null;
  actor_id: string | null;
  actor_type: string | null;
  actor_role: string | null;
  action_attempted: string;
  subject_type: string | null;
  subject_id: string | null;
  denial_reason: string;
  details: string; // details::text
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
  jurisdiction_source: string | null;
  ip_address: string | null;
  request_id: string | null;
}

type Head = { last_seq: string; last_hash: string | null } | null;

export interface AuditSource {
  /** Legacy rows (seq IS NULL) ordered by (created_at, id). */
  legacyRows(): Promise<AuditRowText[]>;
  /** Chain rows with seq > afterSeq, ordered by seq, at most `limit`. */
  chainPage(afterSeq: string, limit: number): Promise<AuditRowText[]>;
  head(): Promise<Head>;
  /** Legacy denial rows (seq IS NULL) ordered by (occurred_at, id). */
  denialLegacyRows(): Promise<DenialRowText[]>;
  denialChainPage(afterSeq: string, limit: number): Promise<DenialRowText[]>;
  denialHead(): Promise<Head>;
}

export type BreakKind =
  | 'CHECKPOINT_MISSING'
  | 'SEQUENCE_GAP'
  | 'BAD_VERSION'
  | 'HASH_MISMATCH'
  | 'NOT_CANONICAL'
  | 'CONTENT_MISMATCH'
  | 'LINK_MISMATCH'
  | 'HEAD_MISMATCH';

export interface ChainBreak {
  kind: BreakKind;
  record_id: string | null; // the chain row's id
  seq: string | null;
  detail: string;
  fields?: string[];
}

interface LegacyReport {
  rows: number;
  digest: string;
  checkpoint_rows: number | null;
  checkpoint_digest: string | null;
  matches_checkpoint: boolean;
  vouches_for: string;
  cannot_vouch_for: string;
}
interface ChainReport {
  rows: number;
  first_seq: string | null;
  last_seq: string | null;
  last_hash: string | null;
  head_seq: string | null;
  head_hash: string | null;
  vouches_for: string;
  cannot_vouch_for: string;
}

export interface VerifyReport {
  ok: boolean;
  checked_at: string;
  legacy: LegacyReport & { first_created_at_us: string | null; last_created_at_us: string | null };
  chain: ChainReport;
  first_break: ChainBreak | null;
  /** Phase 13B: the authorization-denials chain, verified by the same rules. */
  denials: {
    ok: boolean;
    legacy: LegacyReport & {
      first_occurred_at_us: string | null;
      last_occurred_at_us: string | null;
    };
    chain: ChainReport;
    first_break: ChainBreak | null;
  };
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const num = (s: string) => new JsonNumber(s);

/** The hashed envelope of an audit_logs chain row, rebuilt from its columns. */
export function envelopeOf(r: AuditRowText): JsonValue {
  return {
    action: r.action,
    actor_id: r.actor_id,
    actor_role: r.actor_role,
    actor_type: r.actor_type,
    actor_user_id: r.actor_user_id,
    created_at_us: num(r.created_at_us),
    hash_version: num(String(r.hash_version)),
    id: r.id,
    ip_address: r.ip_address,
    prev_hash: r.prev_hash,
    record_id: r.record_id,
    row_data: parseJson(r.row_data),
    seq: r.seq === null ? null : num(r.seq),
    table_name: r.table_name,
  };
}

function denialFields(r: DenialRowText): Record<string, JsonValue> {
  return {
    action_attempted: r.action_attempted,
    actor_id: r.actor_id,
    actor_role: r.actor_role,
    actor_type: r.actor_type,
    actor_user_id: r.actor_user_id,
    denial_reason: r.denial_reason,
    details: parseJson(r.details),
    id: r.id,
    ip_address: r.ip_address,
    jurisdiction_district: r.jurisdiction_district,
    jurisdiction_source: r.jurisdiction_source,
    jurisdiction_state: r.jurisdiction_state,
    occurred_at_us: num(r.occurred_at_us),
    prev_hash: r.prev_hash,
    request_id: r.request_id,
    subject_id: r.subject_id,
    subject_type: r.subject_type,
  };
}

/** The hashed envelope of an authorization_denials chain row. */
export function denialEnvelopeOf(r: DenialRowText): JsonValue {
  return {
    ...denialFields(r),
    hash_version: num(String(r.hash_version)),
    seq: r.seq === null ? null : num(r.seq),
  };
}

/** A legacy audit row's canonical line (all stored columns). */
export function legacyLineOf(r: AuditRowText): string {
  return canonicalize({
    action: r.action,
    actor_id: r.actor_id,
    actor_role: r.actor_role,
    actor_type: r.actor_type,
    actor_user_id: r.actor_user_id,
    created_at_us: num(r.created_at_us),
    id: r.id,
    ip_address: r.ip_address,
    prev_hash: r.prev_hash,
    record_hash: r.record_hash,
    record_id: r.record_id,
    row_data: parseJson(r.row_data),
    table_name: r.table_name,
  });
}

/** A legacy denial row's canonical line (all stored columns). */
export function denialLegacyLineOf(r: DenialRowText): string {
  return canonicalize({ ...denialFields(r), record_hash: r.record_hash });
}

export function legacyDigest(rows: AuditRowText[]): string {
  return sha256(rows.map(legacyLineOf).join('\n'));
}

export function denialLegacyDigest(rows: DenialRowText[]): string {
  return sha256(rows.map(denialLegacyLineOf).join('\n'));
}

function differingFields(a: JsonValue, b: JsonValue): string[] {
  const x = a as Record<string, JsonValue>;
  const y = (b ?? {}) as Record<string, JsonValue>;
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  return keys.filter((k) => {
    const ca = k in x ? canonicalize(x[k]) : undefined;
    const cb = k in y ? canonicalize(y[k]) : undefined;
    return ca !== cb;
  });
}

/** Checks one chain row against its expected seq and predecessor hash. */
export function checkRow<R extends ChainRow>(
  r: R,
  expectedSeq: bigint,
  expectedPrev: string | null,
  envelope: (row: R) => JsonValue = envelopeOf as unknown as (row: R) => JsonValue,
): ChainBreak | null {
  const at = { record_id: r.id, seq: r.seq };
  if (r.seq === null || BigInt(r.seq) !== expectedSeq) {
    return {
      kind: 'SEQUENCE_GAP',
      ...at,
      detail: `expected seq ${expectedSeq}, found ${r.seq ?? 'NULL'}`,
    };
  }
  if (r.hash_version !== HASH_VERSION || r.hash_input === null) {
    return {
      kind: 'BAD_VERSION',
      ...at,
      detail: `hash_version ${r.hash_version}, hash_input ${r.hash_input === null ? 'missing' : 'present'}`,
    };
  }
  const recomputed = sha256(r.hash_input);
  if (recomputed !== r.record_hash) {
    return {
      kind: 'HASH_MISMATCH',
      ...at,
      detail: `sha256(hash_input) = ${recomputed}, stored record_hash = ${r.record_hash}`,
    };
  }
  let stored: JsonValue;
  try {
    stored = parseJson(r.hash_input);
  } catch {
    // No parser message: it can quote the row's text, and reports are summaries.
    return { kind: 'NOT_CANONICAL', ...at, detail: 'hash_input is not JSON' };
  }
  if (canonicalize(stored) !== r.hash_input) {
    return {
      kind: 'NOT_CANONICAL',
      ...at,
      detail: 'hash_input is not in canonical form (writer and verifier rules disagree)',
    };
  }
  const env = envelope(r);
  if (canonicalize(env) !== r.hash_input) {
    return {
      kind: 'CONTENT_MISMATCH',
      ...at,
      detail: 'the row no longer matches the content that was hashed',
      fields: differingFields(env, stored),
    };
  }
  if (r.prev_hash !== expectedPrev) {
    return {
      kind: 'LINK_MISMATCH',
      ...at,
      detail: `prev_hash ${r.prev_hash ?? 'NULL'} does not equal the record_hash of seq ${expectedSeq - 1n} (${expectedPrev ?? 'NULL'})`,
    };
  }
  return null;
}

/** Walks one chain from seq 1; stops at the first break; checks the head. */
async function walkChain<R extends ChainRow>(
  page: (after: string, limit: number) => Promise<R[]>,
  envelope: (row: R) => JsonValue,
  head: () => Promise<Head>,
  headName: string,
  pageSize: number,
  onRow: (row: R) => ChainBreak | null,
) {
  let firstBreak: ChainBreak | null = null;
  let expected = 1n;
  let prevHash: string | null = null;
  let rows = 0;
  let firstSeq: string | null = null;
  let after = '0';
  walk: for (;;) {
    const batch = await page(after, pageSize);
    if (batch.length === 0) break;
    for (const r of batch) {
      if (rows === 0) firstSeq = r.seq;
      const b = checkRow(r, expected, prevHash, envelope) ?? onRow(r);
      if (b) {
        firstBreak = b;
        break walk;
      }
      rows++;
      prevHash = r.record_hash;
      expected++;
      after = r.seq!;
    }
  }
  const lastSeq = rows > 0 ? (expected - 1n).toString() : null;
  const h = await head();
  if (
    !firstBreak &&
    ((h?.last_seq ?? '0') !== (lastSeq ?? '0') || (h?.last_hash ?? null) !== prevHash)
  ) {
    firstBreak = {
      kind: 'HEAD_MISMATCH',
      record_id: null,
      seq: lastSeq,
      detail: `chain ends at seq ${lastSeq} (${prevHash}); ${headName} says seq ${h?.last_seq ?? 'none'} (${h?.last_hash ?? 'none'})`,
    };
  }
  return { rows, firstSeq, lastSeq, prevHash, head: h, firstBreak };
}

const checkpointFacts = (cp: JsonValue) => {
  const o = (cp ?? {}) as Record<string, JsonValue>;
  return {
    rows: o.legacy_rows instanceof JsonNumber ? Number(o.legacy_rows.lexeme) : null,
    digest: typeof o.legacy_digest === 'string' ? o.legacy_digest : null,
  };
};

export async function verifyAuditChain(
  source: AuditSource,
  opts: { pageSize?: number; now?: () => Date } = {},
): Promise<VerifyReport> {
  const pageSize = opts.pageSize ?? 1000;

  // ---- audit_logs ----
  let checkpoint: JsonValue = null;
  let denialsCheckpoint: JsonValue = null;
  const audit = await walkChain(
    (a, l) => source.chainPage(a, l),
    envelopeOf,
    () => source.head(),
    'audit_chain_head',
    pageSize,
    (r) => {
      if (r.seq === '1') {
        checkpoint = r.action === 'CHECKPOINT' ? parseJson(r.row_data) : null;
        if (!checkpoint) {
          return {
            kind: 'CHECKPOINT_MISSING',
            record_id: r.id,
            seq: r.seq,
            detail: `seq 1 is a ${r.action} row, not the legacy CHECKPOINT`,
          };
        }
      } else if (r.action === 'CHECKPOINT') {
        const data = parseJson(r.row_data) as Record<string, JsonValue>;
        if (data?.kind === 'DENIALS_LEGACY_CHECKPOINT') denialsCheckpoint = data;
      }
      return null;
    },
  );
  let auditBreak = audit.firstBreak;
  if (!auditBreak && audit.rows === 0) {
    auditBreak = {
      kind: 'CHECKPOINT_MISSING',
      record_id: null,
      seq: null,
      detail: 'no chain rows',
    };
  }
  const legacy = await source.legacyRows();
  const digest = legacyDigest(legacy);
  const cp = checkpointFacts(checkpoint);
  const matches = cp.rows === legacy.length && cp.digest === digest;

  // ---- authorization_denials ----
  const den = await walkChain(
    (a, l) => source.denialChainPage(a, l),
    denialEnvelopeOf,
    () => source.denialHead(),
    'authorization_denial_chain_head',
    pageSize,
    () => null,
  );
  const dLegacy = await source.denialLegacyRows();
  const dDigest = denialLegacyDigest(dLegacy);
  const dcp = checkpointFacts(denialsCheckpoint);
  const dMatches = dcp.rows === dLegacy.length && dcp.digest === dDigest;
  const denialsOk = den.firstBreak === null && dMatches;

  return {
    ok: auditBreak === null && matches && denialsOk,
    checked_at: (opts.now ?? (() => new Date()))().toISOString(),
    legacy: {
      rows: legacy.length,
      first_created_at_us: legacy[0]?.created_at_us ?? null,
      last_created_at_us: legacy[legacy.length - 1]?.created_at_us ?? null,
      digest,
      checkpoint_rows: cp.rows,
      checkpoint_digest: cp.digest,
      matches_checkpoint: matches,
      vouches_for:
        'the legacy rows are exactly those present when the checkpoint was written (same count, same content)',
      cannot_vouch_for:
        'anything about legacy rows before the checkpoint: their own hashes cannot be recomputed, their order forks, and an edit made before the checkpoint is undetectable',
    },
    chain: {
      rows: audit.rows,
      first_seq: audit.firstSeq,
      last_seq: audit.lastSeq,
      last_hash: audit.prevHash,
      head_seq: audit.head?.last_seq ?? null,
      head_hash: audit.head?.last_hash ?? null,
      vouches_for:
        'every row from the checkpoint on: content unchanged since it was written, one predecessor each, no gap, no insertion, no reordering, ending at the stored head',
      cannot_vouch_for:
        'removal of the newest rows together with a matching rewrite of audit_chain_head by the database owner (keep an external copy of the head); what the database owner does outside the chain',
    },
    first_break: auditBreak,
    denials: {
      ok: denialsOk,
      legacy: {
        rows: dLegacy.length,
        first_occurred_at_us: dLegacy[0]?.occurred_at_us ?? null,
        last_occurred_at_us: dLegacy[dLegacy.length - 1]?.occurred_at_us ?? null,
        digest: dDigest,
        checkpoint_rows: dcp.rows,
        checkpoint_digest: dcp.digest,
        matches_checkpoint: dMatches,
        vouches_for:
          'the legacy denial rows are exactly those present when the denials checkpoint (in the audit chain) was written',
        cannot_vouch_for:
          'the order of legacy denial rows and anything done to them before the checkpoint',
      },
      chain: {
        rows: den.rows,
        first_seq: den.firstSeq,
        last_seq: den.lastSeq,
        last_hash: den.prevHash,
        head_seq: den.head?.last_seq ?? null,
        head_hash: den.head?.last_hash ?? null,
        vouches_for:
          'every denial row from the checkpoint on: unchanged, one predecessor each, no gap, no insertion, no reordering, ending at the stored head',
        cannot_vouch_for:
          'removal of the newest denial rows together with a matching rewrite of authorization_denial_chain_head by the database owner',
      },
      first_break: den.firstBreak,
    },
  };
}
