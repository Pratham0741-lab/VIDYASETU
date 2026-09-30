import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireReason } from '../common/reason';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { T } from './vidyasetu-workflow';
import { MarkDefectiveDto, QueueQueryDto, RejectDto, ResubmitDto, VerifyDto } from './workflow.dto';
import { WorkflowService } from './workflow.service';
import { SlaSweepService } from './sla-sweep.service';
// Type and token only: resolved at run time (DeficienciesModule imports WorkflowModule).
import { DeficienciesService } from '../deficiencies/deficiencies.service';
import { RateLimit } from '../common/throttle/rate-limit';

/**
 * Workflow actions. Roles here are the coarse RBAC gate; which role may act
 * at which stage is decided by the workflow definition (403 for a role that
 * may not act at the application's stage, 409 when the stage does not allow
 * the action). Visibility is the Phase 2 jurisdiction scope + RLS: an
 * application outside the caller's jurisdiction is 404, as everywhere else.
 *
 * No /escalate: in this graph every review stage has exactly one forward
 * edge, so "escalate" would be the same transition as /verify under a
 * second name.
 */
@ApiTags('workflow')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly moduleRef: ModuleRef,
    private readonly slaSweep: SlaSweepService,
  ) {}

  @Get('queue')
  @Roles(...REVIEWER_ROLES)
  @RateLimit('SEARCH')
  @ApiOperation({ summary: 'Scrutiny queue: applications at the stage the caller’s role acts on.' })
  queue(@CurrentActor() actor: Actor, @Query() query: QueueQueryDto) {
    const flag = query.needs_eligibility_review;
    return this.workflow.queue(
      actor,
      flag === undefined ? undefined : flag === 'true',
      query.fraud,
    );
  }

  @Get('sla-breaches')
  @Roles(...REVIEWER_ROLES)
  @ApiOperation({ summary: 'Visible applications whose current stage is past its SLA due time.' })
  breaches() {
    return this.workflow.findBreached();
  }

  /**
   * Phase 14 loose ends (Part B): the breaches the scheduled sweep recorded
   * (one per stage instance), under the jurisdiction rule.
   */
  @Get('sla-breaches/recorded')
  @Roles(...REVIEWER_ROLES, AppRole.AUDITOR)
  @ApiOperation({ summary: 'SLA breaches recorded by the sweep (one per stage instance).' })
  recordedBreaches() {
    return this.slaSweep.recorded();
  }

  /** Runs the scheduled sweep now (it is idempotent: nothing is recorded twice). */
  @Post('sla-breaches/sweep')
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the SLA breach sweep now (SYSTEM actor; idempotent).' })
  sweep(@CurrentActor() actor: Actor) {
    return this.slaSweep.sweep('MANUAL', actor.accountId);
  }

  @Get(':id/sla-status')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @ApiOperation({ summary: 'Whether the application is within or past its current stage’s SLA.' })
  slaStatus(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.workflow.slaStatus(id);
  }

  @Post(':id/verify')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify and advance to the next review stage.' })
  verify(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyDto,
  ) {
    // Confirming a manual eligibility review overrides the automatic gate: a reason is required.
    const remarks = dto.eligibility_review_confirmed
      ? requireReason(dto.remarks, 'remarks')
      : dto.remarks;
    return this.workflow.act(actor, id, T.VERIFY, { ...dto, remarks });
  }

  @Post(':id/reject')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the application (final).' })
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectDto,
  ) {
    return this.workflow.act(actor, id, T.REJECT, {
      remarks: requireReason(dto.remarks, 'remarks'),
    });
  }

  @Post(':id/mark-defective')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Flag a deficiency; the application goes to DEFECTIVE.' })
  markDefective(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarkDefectiveDto,
  ) {
    return this.workflow.act(actor, id, T.MARK_DEFECTIVE, {
      remarks: requireReason(dto.remarks, 'remarks'),
      deficiency: { code: dto.code, title: dto.title, description: dto.description },
    });
  }

  @Post(':id/resubmit')
  @Roles(AppRole.APPLICANT)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Resubmit a DEFECTIVE application to the stage that flagged it. With an open itemised deficiency, the same partial re-verification as POST .../deficiencies/:id/resubmit.',
  })
  async resubmit(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResubmitDto,
  ) {
    // Phase 13D (M39): one behaviour for an application with open deficiency
    // items - the deficiency service's recheck, and the same resubmit
    // transition only when every item is cleared. Without open items:
    // exactly as before.
    const deficiencies = this.moduleRef.get(DeficienciesService, { strict: false });
    const { deficiencyId } = await deficiencies.openItemised(id);
    if (deficiencyId) return deficiencies.resubmit(actor, id, deficiencyId, dto.declared);
    return this.workflow.act(actor, id, T.RESUBMIT, { declared: dto.declared });
  }
}
