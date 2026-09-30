import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { ExportFormat, exportView } from '../analytics/exports';
import { FairnessQueryDto } from './fairness.dto';
import { FairnessService } from './fairness.service';
import { RateLimit } from '../common/throttle/rate-limit';

/** The analytics readers, plus the committee that reviews the lists. */
const FAIRNESS_ROLES = [...REVIEWER_ROLES, AppRole.SUPER_ADMIN, AppRole.AUDITOR, AppRole.COMMITTEE];

/** Phase 13E: fairness data (aggregates only; the analytics rules). */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('api/v1/analytics')
export class FairnessController {
  constructor(private readonly fairness: FairnessService) {}

  @Get('fairness')
  @Roles(...FAIRNESS_ROLES)
  @ApiOperation({
    summary:
      'Applied vs selected by category, gender, PwD status, district and institution type, with selection rates; small counts suppressed.',
  })
  report(@CurrentActor() actor: Actor, @Query() q: FairnessQueryDto) {
    return this.fairness.report(actor, q);
  }

  @Get('fairness/export.csv')
  @Roles(...FAIRNESS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Fairness data as CSV (same scope and suppression as the JSON view).' })
  async csv(@CurrentActor() actor: Actor, @Query() q: FairnessQueryDto) {
    return new StreamableFile(Buffer.from(await this.fairness.csv(actor, q), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="vidyasetu-fairness.csv"',
    });
  }

  private async out(format: ExportFormat, actor: Actor, q: FairnessQueryDto) {
    const { meta, table } = await this.fairness.table(actor, q);
    return exportView(format, 'fairness', 'Fairness: applied vs selected', meta, table, actor.role);
  }

  @Get('fairness/export.xlsx')
  @Roles(...FAIRNESS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Fairness data as XLSX (Phase 16; data and metadata sheets).' })
  xlsx(@CurrentActor() actor: Actor, @Query() q: FairnessQueryDto) {
    return this.out('xlsx', actor, q);
  }

  @Get('fairness/export.pdf')
  @Roles(...FAIRNESS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Fairness data as PDF (Phase 16; footer with scope and threshold).' })
  pdf(@CurrentActor() actor: Actor, @Query() q: FairnessQueryDto) {
    return this.out('pdf', actor, q);
  }
}
