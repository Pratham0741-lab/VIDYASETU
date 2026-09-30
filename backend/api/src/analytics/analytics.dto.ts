import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every analytics view: the cohort of applications submitted in [from, to). */
export class AnalyticsQueryDto {
  @ApiProperty({ example: '2026-04-01', description: 'Start date (inclusive, UTC).' })
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from!: string;

  @ApiProperty({
    example: '2027-04-01',
    description: 'End date (exclusive, UTC); at most 366 days after from.',
  })
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to!: string;

  @ApiPropertyOptional({ example: 'NFST' })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'scheme must be a scheme code' })
  scheme?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'academic_year must look like 2026-27' })
  academic_year?: string;

  /** Demo only (SUPER_ADMIN): include rows registered in test_fixtures. Default: excluded. */
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  include_fixtures?: 'true' | 'false';
}

export class JurisdictionQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['district', 'institution'], default: 'district' })
  @IsOptional()
  @IsIn(['district', 'institution'])
  group_by?: 'district' | 'institution';

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/, { message: 'page must be a positive integer' })
  page?: string;

  @ApiPropertyOptional({ example: '50', description: 'At most 100.' })
  @IsOptional()
  @Matches(/^(100|[1-9]\d?)$/, { message: 'page_size must be 1-100' })
  page_size?: string;
}
