import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditRowText, AuditSource, DenialRowText } from './audit-chain';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Reads audit_logs for the verifier. Every column comes back as exact text
 * (row_data::text, seq::text, created_at as integer microseconds), so nothing
 * passes through a float or a Date. Used by the api (actor transaction) and
 * the CLI (owner connection).
 *
 * ORDER BY names the table columns (a.seq, a.created_at, a.id), never the
 * text aliases: ordering by the alias "seq" sorts 1, 10, 11, 2 ...
 */
const COLUMNS = `id::text AS id, seq::text AS seq, hash_version, table_name, record_id::text AS record_id,
  action, actor_id::text AS actor_id, actor_user_id::text AS actor_user_id, actor_type, actor_role,
  ip_address, row_data::text AS row_data, prev_hash, record_hash, hash_input,
  ((extract(epoch FROM created_at) * 1000000)::bigint)::text AS created_at_us`;

const DENIAL_COLUMNS = `id::text AS id, seq::text AS seq, hash_version, prev_hash, record_hash, hash_input,
  ((extract(epoch FROM occurred_at) * 1000000)::bigint)::text AS occurred_at_us,
  actor_user_id::text AS actor_user_id, actor_id::text AS actor_id, actor_type, actor_role,
  action_attempted, subject_type, subject_id, denial_reason, details::text AS details,
  jurisdiction_state, jurisdiction_district, jurisdiction_source, ip_address, request_id`;

/**
 * `denials: 'verifier-function'` (the api): denial rows come through
 * audit_verifier_denial_rows(), which reads across jurisdictions for an
 * AUDITOR / SUPER_ADMIN actor only (RLS would hide other states' rows).
 * `denials: 'table'` (the CLI, owner connection): read the table directly.
 */
export function prismaAuditSource(
  client: Client,
  { denials = 'table' }: { denials?: 'table' | 'verifier-function' } = {},
): AuditSource {
  const viaFunction = denials === 'verifier-function';
  return {
    legacyRows: () =>
      client.$queryRawUnsafe<AuditRowText[]>(
        `SELECT ${COLUMNS} FROM audit_logs a WHERE a.seq IS NULL ORDER BY a.created_at, a.id`,
      ),
    chainPage: (afterSeq, limit) =>
      client.$queryRawUnsafe<AuditRowText[]>(
        `SELECT ${COLUMNS} FROM audit_logs a WHERE a.seq > $1::bigint ORDER BY a.seq LIMIT $2`,
        afterSeq,
        limit,
      ),
    head: async () => {
      const rows = await client.$queryRawUnsafe<
        Array<{ last_seq: string; last_hash: string | null }>
      >(`SELECT last_seq::text AS last_seq, last_hash FROM audit_chain_head WHERE id`);
      return rows[0] ?? null;
    },
    denialLegacyRows: () =>
      viaFunction
        ? client.$queryRawUnsafe<DenialRowText[]>(
            `SELECT * FROM audit_verifier_denial_rows('legacy', NULL, NULL)`,
          )
        : client.$queryRawUnsafe<DenialRowText[]>(
            `SELECT ${DENIAL_COLUMNS} FROM authorization_denials d WHERE d.seq IS NULL ORDER BY d.occurred_at, d.id`,
          ),
    denialChainPage: (afterSeq, limit) =>
      viaFunction
        ? client.$queryRawUnsafe<DenialRowText[]>(
            `SELECT * FROM audit_verifier_denial_rows('chain', $1::bigint, $2::integer)`,
            afterSeq,
            limit,
          )
        : client.$queryRawUnsafe<DenialRowText[]>(
            `SELECT ${DENIAL_COLUMNS} FROM authorization_denials d WHERE d.seq > $1::bigint ORDER BY d.seq LIMIT $2`,
            afterSeq,
            limit,
          ),
    denialHead: async () => {
      const rows = await client.$queryRawUnsafe<
        Array<{ last_seq: string; last_hash: string | null }>
      >(
        `SELECT last_seq::text AS last_seq, last_hash FROM authorization_denial_chain_head WHERE id`,
      );
      return rows[0] ?? null;
    },
  };
}
