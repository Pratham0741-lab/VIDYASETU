import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CANONICAL_DOCUMENT_TYPES, CanonicalDocumentType } from '../documents/document-types';

/** Checks an officer may issue in bulk (the cross-document ones are per application). */
export const BULK_ITEM_CHECKS = [
  'DOCUMENT_PRESENT',
  'QUALITY_GATE',
  'DOCUMENT_VALIDITY',
  'OFFICER',
] as const;

/** One request may clear at most this many items (it runs in one transaction). */
export const BULK_MAX_ITEMS = 25;
export const BULK_ACTIONS = [
  'VERIFY',
  'MARK_DEFECTIVE',
  'ISSUE_DEFICIENCY',
  'RESOLVE_DEFICIENCY',
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export class BulkDeficiencyDto {
  @ApiProperty({ example: 'DEF_INCOME_EXPIRED' })
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/, { message: 'code must be UPPER_SNAKE_CASE (3-64 chars)' })
  code!: string;

  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) description!: string;
}

/** Phase 13C: the one deficiency item issued to every application in the batch. */
export class BulkDeficiencyItemDto {
  @ApiProperty({ enum: BULK_ITEM_CHECKS })
  @IsIn(BULK_ITEM_CHECKS)
  check_code!: (typeof BULK_ITEM_CHECKS)[number];

  /** Canonical document type; each application's matching checklist slot is used. */
  @ApiProperty({ enum: CANONICAL_DOCUMENT_TYPES })
  @IsIn(CANONICAL_DOCUMENT_TYPES)
  document_type!: CanonicalDocumentType;

  /** OFFICER items only. */
  @ApiPropertyOptional({ example: 'deficiency.problem.not_attested' })
  @IsOptional()
  @Matches(/^deficiency\.problem\.[a-z_]+$/)
  problem_code?: string;
}

export class BulkActionDto {
  /**
   * VERIFY: accept as-is and advance (only items needing no individual
   * eligibility review). MARK_DEFECTIVE: one shared deficiency and reason.
   * ISSUE_DEFICIENCY (Phase 13C): the same itemised deficiency item and
   * reason to every application. RESOLVE_DEFICIENCY: re-check each
   * application's open itemised deficiency and resolve the items whose
   * replaced documents now pass. There is no bulk reject and no bulk
   * release of a fraud hold.
   */
  @ApiProperty({ enum: BULK_ACTIONS })
  @IsIn(BULK_ACTIONS)
  action!: BulkAction;

  @ApiProperty({ type: [String], maxItems: BULK_MAX_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_ITEMS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  application_ids!: string[];

  /** Required for MARK_DEFECTIVE (>= 10 characters); optional remarks for VERIFY. */
  @ApiPropertyOptional({ minLength: 10, maxLength: 2000 })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ type: BulkDeficiencyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkDeficiencyDto)
  deficiency?: BulkDeficiencyDto;

  @ApiPropertyOptional({ type: BulkDeficiencyItemDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkDeficiencyItemDto)
  deficiency_item?: BulkDeficiencyItemDto;

  /** Report what would change without writing anything (no detection run either). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}
