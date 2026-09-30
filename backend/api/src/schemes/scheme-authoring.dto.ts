import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export const SCHEME_TYPES = ['CENTRALLY_SPONSORED', 'CENTRAL_SECTOR'] as const;
export const DISBURSEMENT_MODES = ['SCHEDULED_BY_PLATFORM', 'FORWARDED_TO_STATE'] as const;

export class CreateSchemeDto {
  @ApiProperty({ example: 'TRIBAL_ARTS', description: 'Upper-case code, unique and permanent.' })
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/)
  code!: string;

  @ApiProperty() @IsString() @Length(1, 300) name!: string;
  @ApiProperty() @IsString() @Length(1, 300) department!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) description?: string;

  @ApiProperty({ enum: SCHEME_TYPES })
  @IsIn(SCHEME_TYPES)
  type!: (typeof SCHEME_TYPES)[number];

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) portal_url?: string;

  @ApiPropertyOptional({ enum: DISBURSEMENT_MODES, default: 'SCHEDULED_BY_PLATFORM' })
  @IsOptional()
  @IsIn(DISBURSEMENT_MODES)
  disbursement_mode?: (typeof DISBURSEMENT_MODES)[number];
}

class VersionSourceFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) source_document?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) source_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 4000) extraction_notes?: string;
}

export class CreateDraftDto extends VersionSourceFields {
  /**
   * The version's config (rules, benefits, required_documents,
   * fund_sharing_ratio, optional workflow / disbursement_schedule),
   * validated against schemas/scheme-config.schema.json and the rules engine.
   * Omit it to start from a copy of based_on_version.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Copy this version’s config as the starting point.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  based_on_version?: number;
}

export class UpdateDraftDto extends VersionSourceFields {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class PublishVersionDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Default: today (UTC).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effective_from?: string;
}

export class PreviewVersionDto {
  /** An applicant-shaped profile, as for POST /schemes/check-eligibility. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  applicant!: Record<string, unknown>;
}

export class DiffQueryDto {
  @ApiProperty() @Matches(/^[1-9]\d{0,5}$/) from!: string;
  @ApiProperty() @Matches(/^[1-9]\d{0,5}$/) to!: string;
}
