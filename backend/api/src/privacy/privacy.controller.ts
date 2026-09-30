import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { CORRECTABLE_FIELDS, CorrectableField, PrivacyService } from './privacy.service';
import { RateLimit } from '../common/throttle/rate-limit';

export class ConsentDto {
  @ApiProperty({ example: 'application_processing' })
  @Matches(/^[a-z][a-z_]{2,40}$/)
  purpose!: string;

  @ApiProperty({ enum: ['GIVEN', 'WITHDRAWN'] })
  @IsIn(['GIVEN', 'WITHDRAWN'])
  status!: 'GIVEN' | 'WITHDRAWN';

  @ApiProperty({ example: '2026-10-v1' })
  @Matches(/^[A-Za-z0-9._-]{1,40}$/)
  notice_version!: string;

  @ApiProperty({ example: 'hi' })
  @Matches(/^[a-z]{2,3}$/)
  language!: string;
}

export class CorrectionRequestDto {
  @ApiProperty({ enum: CORRECTABLE_FIELDS })
  @IsIn(CORRECTABLE_FIELDS)
  field!: CorrectableField;

  @ApiProperty({ description: 'The corrected value.' })
  @IsString()
  @Length(1, 100)
  value!: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  reason!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'One of your uploaded documents.' })
  @IsOptional()
  @IsUUID()
  supporting_document_id?: string;
}

export class CorrectionDecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  reason!: string;
}

export class CorrectionQueueDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'APPROVED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['OPEN', 'APPROVED', 'REJECTED'])
  status?: string;
}

/** Phase 17 (Part B): consent and the applicant's DPDP requests. */
@ApiTags('privacy')
@ApiBearerAuth()
@Controller('api/v1')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('applicants/me/consents')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'Consent notices (in my language), my current consents and history.' })
  consents(@CurrentActor() actor: Actor) {
    return this.privacy.consents(actor);
  }

  @Post('applicants/me/consents')
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Give or withdraw consent for a purpose (a new record each time).' })
  consent(@CurrentActor() actor: Actor, @Body() dto: ConsentDto) {
    return this.privacy.recordConsent(actor, dto);
  }

  @Get('applicants/me/data-export')
  @Roles(AppRole.APPLICANT)
  @RateLimit('DATA_EXPORT')
  @ApiOperation({ summary: 'All my data, structured (identifiers masked).' })
  dataExport(@CurrentActor() actor: Actor) {
    return this.privacy.dataExport(actor);
  }

  @Post('applicants/me/correction-requests')
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Ask for a correction of a field I cannot edit myself.' })
  fileCorrection(@CurrentActor() actor: Actor, @Body() dto: CorrectionRequestDto) {
    return this.privacy.fileCorrection(actor, dto);
  }

  @Get('applicants/me/correction-requests')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'My correction requests and their decisions.' })
  myCorrections(@CurrentActor() actor: Actor) {
    return this.privacy.corrections(actor);
  }

  @Post('applicants/me/erasure-requests')
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Ask for erasure (recorded; nothing is deleted in this build).' })
  erasure(@CurrentActor() actor: Actor) {
    return this.privacy.requestErasure(actor);
  }

  @Get('applicants/me/erasure-requests')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'My erasure requests.' })
  myErasure(@CurrentActor() actor: Actor) {
    return this.privacy.erasureRequests(actor);
  }

  @Get('correction-requests')
  @Roles(...REVIEWER_ROLES, AppRole.AUDITOR)
  @ApiOperation({ summary: 'Correction requests in my jurisdiction.' })
  queue(@Query() q: CorrectionQueueDto) {
    return this.privacy.correctionQueue(q.status);
  }

  @Post('correction-requests/:id/decide')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve (applied through the verified change path) or reject, with a reason.',
  })
  decide(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CorrectionDecisionDto,
  ) {
    return this.privacy.decideCorrection(actor, id, dto.decision, dto.reason);
  }
}
