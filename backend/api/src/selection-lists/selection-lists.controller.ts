import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../common/throttle/rate-limit';
import { ListObjectionsDto, SelectionResultDto } from './selection-lists.responses';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import {
  ApproveListDto,
  CloseWindowEarlyDto,
  DecideObjectionDto,
  ListQueryDto,
  OverrideEntryDto,
} from './selection-lists.dto';
import { SelectionListsService } from './selection-lists.service';

const uuid = new ParseUUIDPipe();
const READERS = [AppRole.COMMITTEE, ...REVIEWER_ROLES, AppRole.AUDITOR] as const;

/**
 * Phase 13E: committee review and publication of selection lists. Which role
 * may do what in which list state is SELECTION_LIST_WORKFLOW; the roles here
 * are the coarse gate. Entries are read through row-level security.
 */
@ApiTags('selection-lists')
@ApiBearerAuth()
@Controller('api/v1/selection-lists')
export class SelectionListsController {
  constructor(private readonly lists: SelectionListsService) {}

  @Get()
  @Roles(...READERS)
  @ApiOperation({ summary: 'Selection lists (one per selection run) with their status.' })
  index(@Query() q: ListQueryDto) {
    return this.lists.lists(q);
  }

  @Get(':id')
  @Roles(...READERS)
  @ApiOperation({
    summary:
      'A list: computed outcome and rank per candidate in scope, the committee decision beside it, and the final outcome.',
  })
  get(@Param('id', uuid) id: string) {
    return this.lists.get(id);
  }

  /** Phase 17.2: objections to this list's run, in the caller's scope (grievance RLS). */
  @Get(':id/objections')
  @Roles(...READERS)
  @RateLimit('READ')
  @ApiOperation({
    summary: 'Objections raised against the list: ids, status and dates only (no names, no text).',
  })
  @ApiOkResponse({ type: ListObjectionsDto })
  objections(@Param('id', uuid) id: string): Promise<ListObjectionsDto> {
    return this.lists.objections(id);
  }

  @Post(':id/approve')
  @Roles(AppRole.COMMITTEE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Committee approval of the provisional (DRAFT) list.' })
  approve(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: ApproveListDto,
  ) {
    return this.lists.approve(actor, id, dto.reason);
  }

  @Post(':id/entries/:entryId/override')
  @Roles(AppRole.COMMITTEE)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Committee override of one row (INCLUDE / EXCLUDE) with a reason; the computed rank is kept.',
  })
  override(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Body() dto: OverrideEntryDto,
  ) {
    return this.lists.override(actor, id, entryId, dto.decision, dto.reason);
  }

  @Post(':id/publish-provisional')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the approved provisional list; opens the objection window.' })
  publishProvisional(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.lists.publishProvisional(actor, id);
  }

  @Post(':id/objections/:grievanceId/decide')
  @Roles(AppRole.COMMITTEE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Committee decision on an objection (UPHELD / DISMISSED) with a reason.',
  })
  decideObjection(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Param('grievanceId', uuid) grievanceId: string,
    @Body() dto: DecideObjectionDto,
  ) {
    return this.lists.decideObjection(actor, id, grievanceId, dto.outcome, dto.reason);
  }

  @Post(':id/close-objection-window')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close the objection window once it has elapsed and every objection is decided.',
  })
  close(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.lists.closeWindow(actor, id, false);
  }

  @Post(':id/close-objection-window-early')
  @Roles(AppRole.COMMITTEE)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Committee: close the objection window before it elapses, with a reason (all objections decided).',
  })
  closeEarly(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body() dto: CloseWindowEarlyDto,
  ) {
    return this.lists.closeWindow(actor, id, true, dto.reason);
  }

  @Post(':id/publish-final')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the final list; it is frozen from then on.' })
  publishFinal(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.lists.publishFinal(actor, id);
  }
}

/** Phase 13E: one application's selection result (its own, for an applicant). */
@ApiTags('selection-lists')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class SelectionResultController {
  constructor(private readonly lists: SelectionListsService) {}

  @Get(':id/selection-result')
  @Roles(AppRole.APPLICANT, ...READERS)
  @ApiOperation({
    summary:
      'The application’s outcome and rank in its latest published list, with the score breakdown.',
  })
  @ApiOkResponse({ type: SelectionResultDto })
  result(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.lists.result(actor, id);
  }
}
