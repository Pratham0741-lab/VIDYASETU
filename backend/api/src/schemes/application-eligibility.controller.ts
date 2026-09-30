import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { EligibilityService } from './eligibility.service';
import { EvaluateEligibilityDto } from './schemes.dto';

@ApiTags('schemes')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class ApplicationEligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  /**
   * Same audience as reading the application: its applicant, or a reviewer
   * whose jurisdiction covers it (DbContext scope + RLS; otherwise 404).
   * Runs in the Phase 2 actor transaction; writes rule_evaluations.
   */
  @Post(':id/evaluate-eligibility')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Evaluate an application against its frozen scheme version.' })
  evaluate(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: EvaluateEligibilityDto) {
    return this.eligibility.evaluateApplication(id, dto.declared);
  }
}
