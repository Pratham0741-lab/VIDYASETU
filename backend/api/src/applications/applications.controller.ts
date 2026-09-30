import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { CreateApplicationDto } from './applications.dto';
import { ApplicationsService, ApplicationView } from './applications.service';
import { RateLimit } from '../common/throttle/rate-limit';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES, AppRole.AUDITOR)
  @RateLimit('SEARCH')
  @ApiOperation({ summary: 'Applications visible to the caller (own / jurisdiction).' })
  list(): Promise<ApplicationView[]> {
    return this.applications.list();
  }

  @Get(':id')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES, AppRole.AUDITOR)
  @ApiOperation({
    summary:
      'One application, if visible to the caller (else 404); reviewers also see the Aadhaar authentication status.',
  })
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.applications.getForCaller(actor, id);
  }

  @Post()
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Apply to a scheme version (applicant).' })
  create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateApplicationDto,
  ): Promise<ApplicationView> {
    return this.applications.create(actor, dto);
  }

  @Post(':id/assign-to-me')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign an application in the caller’s jurisdiction to the caller.' })
  assignToMe(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApplicationView> {
    return this.applications.assignToMe(actor, id);
  }
}
