import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { RetentionService } from './retention.service';

export class RetentionRunDto {
  @ApiPropertyOptional({ description: 'Count only, delete nothing (default true).' })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

/** Phase 17 (C): data retention - run it now, and the recorded runs (counts only). */
@ApiTags('retention')
@ApiBearerAuth()
@Controller('api/v1/admin/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the retention purge now (SYSTEM actor; a dry run unless dry_run is false).',
  })
  run(@CurrentActor() actor: Actor, @Body() dto: RetentionRunDto) {
    return this.retention.run('MANUAL', dto.dry_run ?? true, actor.accountId);
  }

  @Get('runs')
  @Roles(AppRole.SUPER_ADMIN, AppRole.AUDITOR)
  @ApiOperation({ summary: 'Recorded retention runs, newest first (cutoffs and counts only).' })
  runs() {
    return this.retention.runs();
  }
}
