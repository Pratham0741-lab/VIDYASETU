import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { REVIEWER_ROLES } from '../auth/roles';
import { BulkActionDto } from './bulk-actions.dto';
import { BulkActionsService } from './bulk-actions.service';
import { RateLimit } from '../common/throttle/rate-limit';

@ApiTags('workflow')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class BulkActionsController {
  constructor(private readonly bulk: BulkActionsService) {}

  @Post('bulk-actions')
  @Roles(...REVIEWER_ROLES)
  @RateLimit('BULK')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Act on up to 25 applications with one action (VERIFY, MARK_DEFECTIVE, ISSUE_DEFICIENCY or RESOLVE_DEFICIENCY), with dry_run; item-by-item results. Never rejects or releases fraud holds.',
  })
  run(@CurrentActor() actor: Actor, @Body() dto: BulkActionDto) {
    return this.bulk.run(actor, dto);
  }
}
