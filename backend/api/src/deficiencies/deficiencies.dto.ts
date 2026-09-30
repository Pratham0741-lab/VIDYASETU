import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CHECK_CODES } from './deficiency-checks';

/** Checks an officer may name on an item they add (not the two cross-document ones). */
export const OFFICER_ITEM_CHECKS = [
  'DOCUMENT_PRESENT',
  'QUALITY_GATE',
  'DOCUMENT_VALIDITY',
  'FIELD_CONFIDENCE',
  'OFFICER',
] as const satisfies readonly (typeof CHECK_CODES)[number][];
export type OfficerItemCheck = (typeof OFFICER_ITEM_CHECKS)[number];

export class OfficerItemDto {
  /** A checklist slot of the application's scheme version. */
  @ApiProperty() @IsString() @Length(1, 300) document_slot!: string;

  /**
   * FIELD_CONFIDENCE: a field the extraction marked NEEDS_REVIEW that the
   * officer finds defective (give `field`). OFFICER: a problem with no
   * automatic check (give `problem_code`). Others: the named check.
   */
  @ApiProperty({ enum: OFFICER_ITEM_CHECKS })
  @IsIn(OFFICER_ITEM_CHECKS)
  check_code!: OfficerItemCheck;

  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z_][a-z0-9_]{0,63}$/) field?: string;

  @ApiPropertyOptional({ example: 'deficiency.problem.not_attested' })
  @IsOptional()
  @Matches(/^deficiency\.problem\.[a-z_]+$/)
  problem_code?: string;
}

export class IssueDeficiencyDto {
  /** Why the application is being returned (>= 10 characters; stored, never logged). */
  @ApiProperty({ minLength: 10, maxLength: 2000 }) @IsOptional() @IsString() reason?: string;

  /** Items the officer adds (each with the shared reason). */
  @ApiPropertyOptional({ type: [OfficerItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OfficerItemDto)
  items?: OfficerItemDto[];

  /** Also generate items from every automatic check that fails now (default true). */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  include_failed_checks?: boolean;

  /** Report the items without writing anything. */
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() dry_run?: boolean;
}
