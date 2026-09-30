import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { requireReason } from '../common/reason';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { RequestContext } from '../common/context/request-context';
import { DbContext } from '../database/db-context';
import { FraudDetectionService } from './fraud-detection.service';

export const DISPOSITIONS = ['CONFIRMED', 'FALSE_POSITIVE', 'NEEDS_MORE_INFO'] as const;

export class DispositionDto {
  @ApiProperty({ enum: DISPOSITIONS })
  @IsIn(DISPOSITIONS)
  status!: (typeof DISPOSITIONS)[number];

  @ApiProperty({
    description: 'Why: what was checked and found (>= 10 characters, REASON_REQUIRED otherwise).',
    minLength: 10,
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

const FLAG_SELECT = {
  id: true,
  created_at: true,
  flag_type: true,
  severity: true,
  status: true,
  subject_type: true,
  application_id: true,
  institution_code: true,
  related_application_ids: true,
  related_document_ids: true,
  confidence: true,
  summary: true,
  evidence: true,
  detector: true,
  reviewed_by_officer_id: true,
  reviewed_at: true,
  review_notes: true,
} as const;

/**
 * Officer-facing fraud review. Every read and write runs in the caller's
 * actor transaction, so fraud_flags' RLS (the flag's own jurisdiction)
 * decides what exists for them; the application itself is checked the same
 * way (out of jurisdiction == not found, the Phase 2 precedent).
 */
@Injectable()
export class FraudReviewService {
  constructor(
    private readonly db: DbContext,
    private readonly detection: FraudDetectionService,
  ) {}

  private async visibleApplication(id: string) {
    const app = await this.db.client.application.findFirst({
      where: { id },
      select: { id: true, application_no: true, institution_code: true, current_stage: true },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    return app;
  }

  async flagsFor(applicationId: string) {
    const app = await this.visibleApplication(applicationId);
    const flags = await this.db.client.fraudFlag.findMany({
      where: {
        OR: [
          { application_id: app.id },
          ...(app.institution_code
            ? [{ subject_type: 'INSTITUTION', institution_code: app.institution_code }]
            : []),
        ],
      },
      select: FLAG_SELECT,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    const holding = flags.filter(
      (f) => f.application_id === app.id && f.severity === 'HIGH' && f.status !== 'FALSE_POSITIVE',
    );
    return {
      application_id: app.id,
      application_no: app.application_no,
      current_stage: app.current_stage,
      held: holding.length > 0,
      holding_flag_ids: holding.map((f) => f.id),
      flags,
    };
  }

  async runChecks(applicationId: string) {
    await this.visibleApplication(applicationId);
    const run = await this.detection.runForApplication(
      applicationId,
      RequestContext.requestId() ?? '',
    );
    return { run, ...(await this.flagsFor(applicationId)) };
  }

  async disposition(actor: Actor, flagId: string, dto: DispositionDto) {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    const now = new Date();
    const updated = await this.db.client.fraudFlag.updateMany({
      where: { id: flagId },
      data: {
        status: dto.status,
        reviewed_by_officer_id: actor.officerId,
        reviewed_at: now,
        review_notes: dto.notes,
        updated_at: now,
      },
    });
    if (updated.count !== 1) throw new AppError(ErrorCode.NOT_FOUND);
    return this.db.client.fraudFlag.findFirst({ where: { id: flagId }, select: FLAG_SELECT });
  }
}

@ApiTags('fraud')
@ApiBearerAuth()
@Controller('api/v1')
export class FraudController {
  constructor(
    private readonly review: FraudReviewService,
    private readonly detection: FraudDetectionService,
  ) {}

  @Post('fraud/backfill')
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run fraud detection over every existing application (one-time backfill).',
  })
  backfill() {
    return this.detection.backfill(RequestContext.requestId() ?? '');
  }

  @Get('applications/:id/fraud-flags')
  @Roles(...REVIEWER_ROLES, AppRole.AUDITOR)
  @ApiOperation({ summary: 'Fraud / duplicate flags for an application (and its institution).' })
  flags(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.review.flagsFor(id);
  }

  @Post('applications/:id/fraud-checks')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the fraud / duplicate detectors for an application now.' })
  check(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.review.runChecks(id);
  }

  @Post('fraud-flags/:id/disposition')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a reviewer disposition: CONFIRMED, FALSE_POSITIVE or NEEDS_MORE_INFO.',
  })
  disposition(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DispositionDto,
  ) {
    return this.review.disposition(actor, id, { ...dto, notes: requireReason(dto.notes, 'notes') });
  }
}
