import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { SelectionListQueryDto } from './selection-review.dto';
import { SelectionReviewService } from './selection-review.service';

@ApiTags('selection-review')
@ApiBearerAuth()
@Controller('api/v1/selections')
export class SelectionReviewController {
  constructor(private readonly review: SelectionReviewService) {}

  @Get()
  @Roles(AppRole.COMMITTEE, ...REVIEWER_ROLES)
  @ApiOperation({
    summary:
      'Selections for a scheme and year in the caller’s scope: ranks, reservations, score breakdowns and objections (read-only).',
  })
  list(@Query() q: SelectionListQueryDto) {
    return this.review.list(q);
  }
}
