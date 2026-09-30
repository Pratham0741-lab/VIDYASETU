import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { OFFICER_ROLES } from '../auth/roles';
import {
  CreateDraftDto,
  CreateSchemeDto,
  DiffQueryDto,
  PreviewVersionDto,
  PublishVersionDto,
  UpdateDraftDto,
} from './scheme-authoring.dto';
import { SchemeAuthoringService } from './scheme-authoring.service';
import { SchemeAdmin } from './scheme-role.guard';

/**
 * Scheme authoring (Phase 14 loose ends, Part A; plan Phase 4). Reads: every
 * officer role (AUDITOR included - read-only). Writes: the roles configured
 * in SCHEME_AUTHOR_ROLES (create, draft, edit, validate, preview) and
 * SCHEME_PUBLISHER_ROLES (publish, retire); both default SUPER_ADMIN and
 * MINISTRY_OFFICER.
 */
@ApiTags('scheme-authoring')
@ApiBearerAuth()
@Controller('api/v1/admin/schemes')
export class SchemeAuthoringController {
  constructor(private readonly authoring: SchemeAuthoringService) {}

  @Get()
  @Roles(...OFFICER_ROLES)
  @ApiOperation({ summary: 'Schemes with their versions (status, dates).' })
  list() {
    return this.authoring.list();
  }

  @Post()
  @SchemeAdmin('author')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a scheme (no version yet).' })
  create(@Body() dto: CreateSchemeDto) {
    return this.authoring.createScheme(dto);
  }

  @Get(':code/diff')
  @Roles(...OFFICER_ROLES)
  @ApiOperation({ summary: 'Config changes between two versions of a scheme.' })
  diff(@Param('code') code: string, @Query() q: DiffQueryDto) {
    return this.authoring.diff(code, Number(q.from), Number(q.to));
  }

  @Get(':code/versions/:version')
  @Roles(...OFFICER_ROLES)
  @ApiOperation({ summary: 'One version with its full config (drafts included).' })
  get(@Param('code') code: string, @Param('version', ParseIntPipe) version: number) {
    return this.authoring.getVersion(code, version);
  }

  @Post(':code/versions')
  @SchemeAdmin('author')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a DRAFT version (validated before it is saved).' })
  draft(@Param('code') code: string, @Body() dto: CreateDraftDto) {
    return this.authoring.createDraft(code, dto);
  }

  @Patch(':code/versions/:version')
  @SchemeAdmin('author')
  @ApiOperation({ summary: 'Edit a DRAFT version (a published one: 409).' })
  edit(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.authoring.updateDraft(code, version, dto);
  }

  @Post(':code/versions/:version/validate')
  @SchemeAdmin('author')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a version’s config (200 summary, or 400 with every issue).' })
  validate(@Param('code') code: string, @Param('version', ParseIntPipe) version: number) {
    return this.authoring.validate(code, version);
  }

  @Post(':code/versions/:version/preview')
  @SchemeAdmin('author')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Evaluate a profile and derive the form for any version (nothing stored).',
  })
  preview(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: PreviewVersionDto,
  ) {
    return this.authoring.preview(code, version, dto.applicant);
  }

  @Post(':code/versions/:version/publish')
  @SchemeAdmin('publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a DRAFT: it becomes immutable and supersedes the active one.' })
  publish(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: PublishVersionDto,
  ) {
    return this.authoring.publish(code, version, dto);
  }

  @Post(':code/versions/:version/retire')
  @SchemeAdmin('publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retire an active version (no new applications; existing ones keep it).',
  })
  retire(@Param('code') code: string, @Param('version', ParseIntPipe) version: number) {
    return this.authoring.retire(code, version);
  }
}
