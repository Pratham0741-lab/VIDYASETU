import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

export class SelectionListQueryDto {
  @ApiProperty({ example: 'NOS' })
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'scheme must be a scheme code' })
  scheme!: string;

  @ApiProperty({ example: '2026-27' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'academic_year must look like 2026-27' })
  academic_year!: string;

  @ApiPropertyOptional({ enum: ['PROVISIONAL', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN'] })
  @IsOptional()
  @IsIn(['PROVISIONAL', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN'])
  status?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/, { message: 'page must be a positive integer' })
  page?: string;

  @ApiPropertyOptional({ example: '50', description: 'At most 100.' })
  @IsOptional()
  @Matches(/^(100|[1-9]\d?)$/, { message: 'page_size must be 1-100' })
  page_size?: string;
}
