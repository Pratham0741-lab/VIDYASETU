import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DbContext } from '../database/db-context';
import { verifyAuditChain, VerifyReport } from './audit-chain';
import { prismaAuditSource } from './audit-source';

/**
 * The single place that knows the audit hashing rules (canonical.ts,
 * audit-chain.ts). Rows are still written by the database trigger
 * (audit_chain_append), which mirrors these rules; verification checks the
 * trigger's output against them on every row.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly db: DbContext,
    @InjectPinoLogger(AuditService.name) private readonly logger: PinoLogger,
  ) {}

  async verify(): Promise<VerifyReport> {
    const client = this.db.client;
    await client.$executeRaw`SET TRANSACTION READ ONLY`;
    const report = await verifyAuditChain(
      prismaAuditSource(client, { denials: 'verifier-function' }),
    );
    this.logger.info(
      {
        ok: report.ok,
        chain_rows: report.chain.rows,
        legacy_rows: report.legacy.rows,
        legacy_matches_checkpoint: report.legacy.matches_checkpoint,
        first_break: report.first_break?.kind ?? null,
        denials_chain_rows: report.denials.chain.rows,
        denials_ok: report.denials.ok,
        denials_first_break: report.denials.first_break?.kind ?? null,
      },
      'audit chain verified',
    );
    return report;
  }
}
