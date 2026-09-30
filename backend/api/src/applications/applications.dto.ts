import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() scheme_version_id!: string;

  @ApiProperty({ example: '2026-27' })
  @Matches(/^\d{4}-\d{2}$/)
  academic_year!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) institution_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) institution_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) course_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) course_year?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_hosteller?: boolean;

  /**
   * Self-declared inputs for the automatic eligibility gate that runs on
   * submission (education_level, degree_enrolled, ...). Same rules as
   * POST /applications/:id/evaluate-eligibility: recorded fields (category,
   * income, domicile, ...) come from the database and cannot be declared.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declared?: Record<string, unknown>;
}

/**
 * Phase 14 loose ends (Part C): an application draft. Every field of
 * CreateApplicationDto, all optional: a draft may be incomplete. Submitting
 * it needs scheme_version_id and academic_year, then follows the unchanged
 * submit path (POST /applications).
 */
export class SaveApplicationDraftDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() scheme_version_id?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  academic_year?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) institution_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) institution_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) course_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) course_year?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_hosteller?: boolean;

  /** Self-declared gate inputs; recorded and sensitive fields are refused. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declared?: Record<string, unknown>;
}

/** POST /application-drafts/:id/submit (body optional). */
export class SubmitDraftDto {
  /**
   * true (the student portal): the application waits in SUBMITTED until its
   * required documents are uploaded and scanned; the automatic eligibility
   * gate runs then (POST /applications/:id/documents/complete). Default
   * false: the gate runs now, as for POST /applications.
   */
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() await_documents?: boolean;
}
