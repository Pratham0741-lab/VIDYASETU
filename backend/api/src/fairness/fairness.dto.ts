import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

/** Phase 13E: one scheme and academic year (a bounded cohort). */
export class FairnessQueryDto {
  @ApiProperty({ example: 'NFST' })
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'scheme must be a scheme code' })
  scheme!: string;

  @ApiProperty({ example: '2026-27' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'academic_year must look like 2026-27' })
  academic_year!: string;

  /** Demo only (SUPER_ADMIN): include rows registered in test_fixtures. Default: excluded. */
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  include_fixtures?: 'true' | 'false';
}
