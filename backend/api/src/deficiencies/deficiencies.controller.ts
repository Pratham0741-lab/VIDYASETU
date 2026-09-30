import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { IssueDeficiencyDto } from './deficiencies.dto';
import { DeficienciesService } from './deficiencies.service';
import { LogDocumentAccess } from '../documents/document-access';

/** Phase 13C: the deficiency loop (itemised deficiencies, resubmission). */
@ApiTags('deficiencies')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class DeficienciesController {
  constructor(private readonly deficiencies: DeficienciesService) {}

  @Post(':id/deficiencies')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Return an application with itemised deficiencies: from the checks that fail and/or officer-added items (reason required); dry_run lists the items.',
  })
  issue(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueDeficiencyDto,
  ) {
    return this.deficiencies.issue(actor, id, dto);
  }

  @Get(':id/deficiencies')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES, AppRole.AUDITOR)
  @ApiOperation({
    summary: 'Deficiencies and their items (document, problem, fix, deadline, status) in scope.',
  })
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.deficiencies.list(id);
  }

  /**
   * Phase 13D: the marked region of the stored document for one item - the
   * owning applicant and officers in jurisdiction (RLS); 404 for everyone
   * else and when the item has no crop. Generated on demand, not stored,
   * not cached.
   */
  @Get(':id/deficiencies/items/:itemId/crop')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @LogDocumentAccess('CROP', 'deficiency_item_crop')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'The marked region of the document a deficiency item is about (PNG).' })
  async crop(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ): Promise<StreamableFile> {
    const png = await this.deficiencies.crop(id, itemId);
    return new StreamableFile(png, {
      type: 'image/png',
      disposition: `inline; filename="deficiency-item-${itemId}.png"`,
    });
  }

  @Post(':id/deficiencies/:deficiencyId/resubmit')
  @Roles(AppRole.APPLICANT)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Resubmit after replacing the named documents: re-runs only the checks those documents feed; returns to review when every item is cleared.',
  })
  resubmit(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('deficiencyId', new ParseUUIDPipe()) deficiencyId: string,
  ) {
    return this.deficiencies.resubmit(actor, id, deficiencyId);
  }
}
