import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { jurisdictionScopeExtension } from '../database/jurisdiction.extension';
import { piiEncryptionExtension } from '../lib/crypto/pii-extension';

type BasePrismaClient = PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>;

/**
 * Applies every application-wide Prisma client extension, in order. All are
 * `query` extensions, and interactive-transaction clients created from the
 * result inherit them.
 */
function applyExtensions(client: BasePrismaClient) {
  return client.$extends(piiEncryptionExtension).$extends(jurisdictionScopeExtension);
}

/** Exact type of the client PrismaService hands out. */
export type ExtendedPrismaClient = ReturnType<typeof applyExtensions>;

/**
 * Shared Prisma client. Connects eagerly on startup, but a database that is
 * down only degrades readiness: Prisma reconnects lazily on the next query,
 * so the process keeps running.
 *
 * The instance Nest injects is the *extended* client: the constructor returns
 * `$extends(...)` instead of `this`, so there is no un-extended handle to
 * bypass the PII extension. Applicant writes are encrypted and reads
 * decrypted transparently (src/lib/crypto/pii-extension.ts).
 *
 * The extended client forwards unknown properties to the base instance, so
 * this class's own members (onModuleInit, onModuleDestroy, ping, logger)
 * keep working. The static type stays `PrismaService`: that is accurate
 * while all extensions are `query`-only, because query extensions add no
 * members and change no model types. If a later extension adds `model`,
 * `result` or `client` members, type consumers as ExtendedPrismaClient.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    config: AppConfigService,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      datasourceUrl: config.database.url,
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    // $on must be registered on the base client: extended clients do not expose it.
    this.$on('warn', (e) => this.logger.warn({ target: e.target }, e.message));
    this.$on('error', (e) => this.logger.error({ target: e.target }, e.message));

    return applyExtensions(this) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.info('Connected to PostgreSQL');
    } catch (err) {
      this.logger.error({ err }, 'PostgreSQL unavailable at startup; will retry on demand');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness probe: a trivial round trip to the database. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
