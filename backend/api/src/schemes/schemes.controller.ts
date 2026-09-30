import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { EligibilityService } from './eligibility.service';
import { ActiveSchemesDto, SchemeCatalogueService } from './scheme-catalogue';
import { CheckEligibilityDto } from './schemes.dto';

/**
 * Public scheme discovery. Reverse eligibility and form schemas are meant to
 * help people BEFORE they register, so they need no account. They are
 * throttled per client IP and validate the profile strictly
 * (sanitizeProfile). Nothing a visitor submits here is stored: evaluations
 * are computed, returned and discarded (no rule_evaluations or audit rows).
 */
@ApiTags('schemes')
@Controller('api/v1/schemes')
export class SchemesController {
  constructor(
    private readonly eligibility: EligibilityService,
    private readonly catalogue: SchemeCatalogueService,
  ) {}

  /** Phase 17.2: the schemes open to applications (public, throttled per client IP). */
  @Get()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Active scheme versions (code, name, version, dates). Public.' })
  @ApiOkResponse({ type: ActiveSchemesDto })
  active(): Promise<ActiveSchemesDto> {
    return this.catalogue.active();
  }

  @Post('check-eligibility')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse eligibility: every active scheme version vs. a profile.' })
  checkAll(@Body() dto: CheckEligibilityDto) {
    return this.eligibility.checkAllActive(dto.applicant);
  }

  @Post(':code/versions/:version/check-eligibility')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'One scheme version (any status) vs. a profile.' })
  checkOne(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: CheckEligibilityDto,
  ) {
    return this.eligibility.checkVersion(code, version, dto.applicant);
  }

  @Get(':code/versions/:version/form-schema')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Form fields and document checklist derived from the rules.' })
  formSchema(@Param('code') code: string, @Param('version', ParseIntPipe) version: number) {
    return this.eligibility.formSchema(code, version);
  }
}
