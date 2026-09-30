import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { DbContext } from '../database/db-context';

/**
 * Oversight roles: national (MINISTRY_OFFICER, SUPER_ADMIN), state and
 * district nodal officers. INSTITUTE_NODAL_OFFICER is the front-line reviewer
 * whose own refusals appear here for their supervisors; applicants see none.
 */
export const DENIAL_READER_ROLES = [
  AppRole.MINISTRY_OFFICER,
  AppRole.SUPER_ADMIN,
  AppRole.STATE_NODAL_OFFICER,
  AppRole.DISTRICT_NODAL_OFFICER,
  AppRole.AUDITOR,
] as const;

export class DenialsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Only denials that occurred before this instant (paging cursor).',
  })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({ example: 'OBJECTION_WINDOW_OPEN' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  denial_reason?: string;

  @ApiPropertyOptional({ example: 'selection' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,39}$/)
  subject_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,200}$/)
  subject_id?: string;
}

@Injectable()
export class AuthorizationDenialsService {
  constructor(private readonly db: DbContext) {}

  /**
   * Phase 2 scoping, both layers: the query runs in the caller's actor
   * transaction (DbContext), so the table's RLS policy - the established
   * officer-jurisdiction predicate - decides visibility in the database; the
   * same territorial rule is also applied here as the application-layer
   * mirror (as jurisdiction-scope.ts does for application-owned models).
   */
  async list(actor: Actor, q: DenialsQueryDto) {
    const where: Prisma.AuthorizationDenialWhereInput = {
      ...territorialScope(actor),
      ...(q.before ? { occurred_at: { lt: new Date(q.before) } } : {}),
      ...(q.denial_reason ? { denial_reason: q.denial_reason } : {}),
      ...(q.subject_type ? { subject_type: q.subject_type } : {}),
      ...(q.subject_id ? { subject_id: q.subject_id } : {}),
    };
    const denials = await this.db.client.authorizationDenial.findMany({
      where,
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: q.limit ?? 50,
    });
    // seq (the denials chain position, Phase 13B) is a BigInt, which JSON
    // cannot carry: sent as a decimal string, as the audit verifier does.
    return {
      denials: denials.map((d) => ({ ...d, seq: d.seq === null ? null : d.seq.toString() })),
    };
  }
}

/** The jurisdiction-scope rule (national / state / state+district) on the row's own columns. */
export function territorialScope(actor: Actor): Prisma.AuthorizationDenialWhereInput {
  if (actor.jurisdictionState === null) return {};
  return actor.jurisdictionDistrict === null
    ? { jurisdiction_state: actor.jurisdictionState }
    : {
        jurisdiction_state: actor.jurisdictionState,
        jurisdiction_district: actor.jurisdictionDistrict,
      };
}

@ApiTags('authorization-denials')
@ApiBearerAuth()
@Controller('api/v1/authorization-denials')
export class AuthorizationDenialsController {
  constructor(private readonly denials: AuthorizationDenialsService) {}

  @Get()
  @Roles(...DENIAL_READER_ROLES)
  @ApiOperation({ summary: 'Refused privileged actions in my jurisdiction, newest first.' })
  list(@CurrentActor() actor: Actor, @Query() query: DenialsQueryDto) {
    return this.denials.list(actor, query);
  }
}
