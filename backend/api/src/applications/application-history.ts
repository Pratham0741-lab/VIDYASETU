import { Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { RateLimit } from '../common/throttle/rate-limit';
import { DbContext } from '../database/db-context';

/** One stage change: the four public facts, never who did it or why. */
export class HistoryEntryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'INO_VERIFIED',
    description: 'Stage before (null for the first entry).',
  })
  from_stage!: string | null;

  @ApiProperty({ example: 'DNO_VERIFIED' })
  to_stage!: string;

  @ApiProperty({
    example: 'verify',
    description: 'What moved it; label keys history.action.<trigger_action> (English and Hindi).',
  })
  trigger_action!: string;

  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export class ApplicationHistoryDto {
  @ApiProperty({ format: 'uuid' })
  application_id!: string;

  @ApiProperty({ type: [HistoryEntryDto], description: 'Oldest first.' })
  history!: HistoryEntryDto[];
}

interface HistoryRow {
  from_stage: string | null;
  to_stage: string;
  trigger_action: string;
  at: Date;
}

/**
 * Phase 17.2: an application's stage history for the portals. Read from the
 * application_history view (migration 20261004090000), which exposes only
 * from_stage / to_stage / trigger_action / at and applies the caller's
 * row-level security on applications (security_invoker): the owner sees
 * their own application's history, reviewers those in jurisdiction. Officer
 * identities, remarks and reasons are not in the view at all.
 */
@Injectable()
export class ApplicationHistoryService {
  constructor(private readonly db: DbContext) {}

  async history(applicationId: string): Promise<ApplicationHistoryDto> {
    const client = this.db.client;
    // Visibility first (RLS): an application outside the caller's scope is 404, as everywhere.
    const app = await client.application.findFirst({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    const rows = await client.$queryRaw<HistoryRow[]>`
      SELECT from_stage, to_stage, trigger_action, at
        FROM application_history
       WHERE application_id = ${app.id}::uuid
       ORDER BY at, id`;
    return {
      application_id: app.id,
      history: rows.map((r) => ({
        from_stage: r.from_stage,
        to_stage: r.to_stage,
        trigger_action: r.trigger_action,
        at: r.at.toISOString(),
      })),
    };
  }
}

@ApiTags('applications')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class ApplicationHistoryController {
  constructor(private readonly historyService: ApplicationHistoryService) {}

  @Get(':id/history')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @RateLimit('READ')
  @ApiOperation({
    summary: 'The stage history of an application (stages, action, time; no officer or reason).',
  })
  @ApiOkResponse({ type: ApplicationHistoryDto })
  history(@Param('id', new ParseUUIDPipe()) id: string): Promise<ApplicationHistoryDto> {
    return this.historyService.history(id);
  }
}
