import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Reasons: at least 10 trimmed characters (requireReason; DB CHECK). */
export class ApproveListDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class OverrideEntryDto {
  @ApiProperty({ enum: ['INCLUDE', 'EXCLUDE'] })
  @IsIn(['INCLUDE', 'EXCLUDE'])
  decision!: 'INCLUDE' | 'EXCLUDE';

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class DecideObjectionDto {
  @ApiProperty({ enum: ['UPHELD', 'DISMISSED'] })
  @IsIn(['UPHELD', 'DISMISSED'])
  outcome!: 'UPHELD' | 'DISMISSED';

  /** Sent to the applicant as the grievance resolution note. */
  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;
}

export class CloseWindowEarlyDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/) scheme?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}$/) academic_year?: string;
}
