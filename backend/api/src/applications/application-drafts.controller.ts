import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { ApplicationDraftsService } from './application-drafts.service';
import { SaveApplicationDraftDto } from './applications.dto';

/** Phase 14 loose ends (Part C): the applicant's own drafts; nobody else has a route. */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('api/v1/application-drafts')
export class ApplicationDraftsController {
  constructor(private readonly drafts: ApplicationDraftsService) {}

  @Post()
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({ summary: 'Save a new application draft (may be incomplete).' })
  create(@CurrentActor() actor: Actor, @Body() dto: SaveApplicationDraftDto) {
    return this.drafts.create(actor, dto);
  }

  @Get()
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'My application drafts.' })
  list() {
    return this.drafts.list();
  }

  @Get(':id')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'Resume one of my drafts.' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.drafts.get(id);
  }

  @Patch(':id')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'Edit a draft (a submitted draft: 409).' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SaveApplicationDraftDto) {
    return this.drafts.update(id, dto);
  }

  @Post(':id/submit')
  @Roles(AppRole.APPLICANT)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Submit a draft through the unchanged submit path (POST /applications).',
  })
  submit(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.drafts.submit(actor, id);
  }
}
