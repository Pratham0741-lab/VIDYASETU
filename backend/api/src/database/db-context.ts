import { Injectable } from '@nestjs/common';
import { RequestContext } from '../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { DbClient } from './db-client';

/**
 * "The current request's database client". Inject this, not PrismaService.
 *
 * Inside an authenticated request it returns that request's actor transaction
 * (app.actor_id / app.actor_role set, jurisdiction scope active). Outside one
 * it returns the base client, which carries no actor: on RLS-protected tables
 * that means zero rows, i.e. it fails closed rather than acting as anyone.
 */
@Injectable()
export class DbContext {
  constructor(private readonly prisma: PrismaService) {}

  get client(): DbClient {
    return RequestContext.db() ?? this.prisma;
  }

  get inActorTransaction(): boolean {
    return RequestContext.db() !== undefined;
  }
}
