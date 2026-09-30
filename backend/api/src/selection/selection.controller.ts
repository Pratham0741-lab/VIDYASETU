import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { RunSelectionDto } from './selection.dto';
import { SelectionService } from './selection.service';

const SCHEME_CODE = /^[A-Z][A-Z0-9_]{1,49}$/;
const ACADEMIC_YEAR = /^\d{4}-\d{2}$/;

@ApiTags('selection')
@ApiBearerAuth()
@Controller('api/v1/schemes')
export class SelectionController {
  constructor(private readonly selection: SelectionService) {}

  /**
   * MINISTRY_OFFICER only: in the Phase 4 graph the only role that acts on
   * MINISTRY_APPROVED applications, with national scope. Runs in the
   * request's actor transaction. Refuses (409) if a PROVISIONAL or CONFIRMED
   * selection already exists for the scheme and year; dry_run never writes.
   */
  @Post(':code/academic-years/:year/run-selection')
  @Roles(AppRole.MINISTRY_OFFICER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Run merit / quota selection for a scheme and academic year.' })
  run(@Param('code') code: string, @Param('year') year: string, @Body() dto: RunSelectionDto) {
    if (!SCHEME_CODE.test(code) || !ACADEMIC_YEAR.test(year)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          { field: SCHEME_CODE.test(code) ? 'year' : 'code', constraints: { format: 'invalid' } },
        ],
      });
    }
    return this.selection.run(code, year, dto.dry_run === true);
  }
}
