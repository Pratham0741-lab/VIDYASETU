import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireReason } from '../common/reason';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { ALL_ROLES, AppRole, REVIEWER_ROLES } from '../auth/roles';
import { DisbursementService } from './disbursement.service';
import { GrievanceService } from './grievance.service';
import {
  ConfirmSelectionDto,
  DecideRenewalDto,
  EndorseRenewalDto,
  GrievanceQueryDto,
  RaiseGrievanceDto,
  ResolveGrievanceDto,
  SubmitRenewalDto,
  VerifySanctionOrderDto,
} from './post-selection.dto';
import { RenewalService } from './renewal.service';
import { SanctionService } from './sanction.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { LogDocumentAccess } from '../documents/document-access';

const uuid = new ParseUUIDPipe();

/**
 * Selection confirmation, sanction orders and disbursements. MINISTRY_OFFICER
 * acts (the only role acting at MINISTRY_APPROVED, national scope); reads
 * follow the usual audience, scoped by Phase 2's jurisdiction scope + RLS.
 */
@ApiTags('post-selection')
@ApiBearerAuth()
@Controller('api/v1')
export class SanctionController {
  constructor(
    private readonly sanction: SanctionService,
    private readonly disbursements: DisbursementService,
  ) {}

  @Post('selections/:id/confirm')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm a PROVISIONAL selection (objection window, or override with reason).',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: ConfirmSelectionDto,
  ) {
    return this.sanction.confirm(actor, id, dto.override_reason);
  }

  @Post('selections/:id/sanction-order')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate the sanction order (CONFIRMED selections only).' })
  generate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.sanction.generate(actor, id);
  }

  @Get('sanction-orders/:id')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @LogDocumentAccess('VIEW', 'sanction_order')
  @ApiOperation({ summary: 'A sanction order: canonical content and stored SHA-256.' })
  getOrder(@Param('id', uuid) id: string) {
    return this.sanction.get(id);
  }

  @Get('sanction-orders/:id/pdf')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @LogDocumentAccess('DOWNLOAD', 'sanction_order_pdf')
  @ApiOperation({ summary: 'The sanction order PDF.' })
  async pdf(@Param('id', uuid) id: string): Promise<StreamableFile> {
    const bytes = await this.sanction.pdf(id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `inline; filename="sanction-order-${id}.pdf"`,
    });
  }

  @Post('sanction-orders/verify')
  @Roles(...ALL_ROLES)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recompute the SHA-256 of supplied order data and compare with the stored hash.',
  })
  verify(@Body() dto: VerifySanctionOrderDto) {
    return this.sanction.verify(dto.content, dto.audit_chain);
  }

  @Post('selections/:id/disbursements')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create the disbursement schedule from the sanction order.' })
  schedule(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.disbursements.createSchedule(actor, id);
  }

  @Get('applications/:id/disbursements')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @ApiOperation({ summary: 'Disbursements of an application.' })
  listDisbursements(@Param('id', uuid) id: string) {
    return this.disbursements.list(id);
  }

  @Post('disbursements/:id/initiate')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit an instalment to the PFMS stand-in.' })
  initiate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.disbursements.initiate(actor, id);
  }

  @Post('disbursements/:id/reconcile')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reconcile the PFMS status; first success moves the application to DISBURSED.',
  })
  reconcile(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.disbursements.reconcile(actor, id);
  }
}

/** Renewal cycle: NFST and NOS only; other schemes are refused on every route. */
@ApiTags('post-selection')
@ApiBearerAuth()
@Controller('api/v1')
export class RenewalController {
  constructor(private readonly renewals: RenewalService) {}

  @Get('applications/:id/renewals')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @ApiOperation({ summary: 'Renewals of an application (renewable schemes only).' })
  list(@Param('id', uuid) id: string) {
    return this.renewals.listForApplication(id);
  }

  @Post('applications/:id/renewals')
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit a progress report for a renewal year.' })
  submit(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: SubmitRenewalDto,
  ) {
    return this.renewals.submit(actor, id, dto);
  }

  @Post('renewals/:id/endorse')
  @Roles(AppRole.INSTITUTE_NODAL_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Institute endorsement of the progress report.' })
  endorse(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: EndorseRenewalDto,
  ) {
    return this.renewals.endorse(actor, id, dto.remarks);
  }

  @Post('renewals/:id/continuation-check')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-check the tenure rule of the FROZEN scheme version.' })
  check(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.renewals.continuationCheck(actor, id);
  }

  @Post('renewals/:id/decide')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve (after a PASS check) or discontinue a renewal.' })
  decide(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: DecideRenewalDto,
  ) {
    // Discontinuing is an adverse decision: a reason is required. Approval
    // is only possible after a PASS continuation check (not an override).
    const remarks =
      dto.decision === 'DISCONTINUE' ? requireReason(dto.remarks, 'remarks') : dto.remarks;
    return this.renewals.decide(actor, id, dto.decision, remarks);
  }
}

@ApiTags('post-selection')
@ApiBearerAuth()
@Controller('api/v1/grievances')
export class GrievanceController {
  constructor(private readonly grievances: GrievanceService) {}

  @Post()
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Raise a grievance (or an objection to a non-selection).' })
  raise(@CurrentActor() actor: Actor, @Body() dto: RaiseGrievanceDto) {
    return this.grievances.raise(actor, dto);
  }

  @Get()
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @ApiOperation({ summary: 'Grievances visible to the caller (own / jurisdiction).' })
  list(@Query() query: GrievanceQueryDto) {
    return this.grievances.list(query.status);
  }

  @Get(':id')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES, AppRole.COMMITTEE)
  @ApiOperation({
    summary: 'One grievance (COMMITTEE: selection objections only, others are not found).',
  })
  async get(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    const g = await this.grievances.get(id);
    // Phase 13B: the selection committee reads objections, not other grievances.
    if (actor.role === AppRole.COMMITTEE && g.subject_type !== 'SELECTION_OBJECTION') {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    return g;
  }

  @Post(':id/start')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Start examining a grievance.' })
  start(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.grievances.start(actor, id);
  }

  @Post(':id/resolve')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve or reject a grievance with a note.' })
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: ResolveGrievanceDto,
  ) {
    return this.grievances.resolve(actor, id, dto.outcome, requireReason(dto.note, 'note', 4000));
  }
}
