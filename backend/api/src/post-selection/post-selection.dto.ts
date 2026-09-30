import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConfirmSelectionDto {
  /** Required while the objection window is open: why confirm early. Audited. */
  // Minimum length (10 trimmed) is checked by requireReason (REASON_REQUIRED), Phase 13C.
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) override_reason?: string;
}

/** Phase 14 loose ends (D2): the audit-chain reference printed on the order. */
export class AuditChainRefDto {
  @ApiProperty({ example: '2114' }) @Matches(/^[1-9][0-9]{0,18}$/) seq!: string;
  @ApiProperty() @Matches(/^[0-9a-f]{64}$/) record_hash!: string;
}

export class VerifySanctionOrderDto {
  /** The sanction order's data exactly as issued (GET /sanction-orders/:id -> content). */
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() content!: Record<
    string,
    unknown
  >;

  /** The audit chain record printed on the PDF (and in its QR code). */
  @ApiPropertyOptional({ type: AuditChainRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuditChainRefDto)
  audit_chain?: AuditChainRefDto;
}

export class SubmitRenewalDto {
  @ApiProperty({ example: '2027-28' }) @Matches(/^\d{4}-\d{2}$/) academic_year!: string;
  @ApiProperty({ minimum: 2, maximum: 10 }) @IsInt() @Min(2) @Max(10) academic_year_number!: number;
  @ApiProperty() @IsBoolean() passed_previous_year!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) percentage_obtained?: number;
  @ApiProperty() @IsString() @Length(1, 5000) progress_report!: string;
}

export class EndorseRenewalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) remarks?: string;
}

export class DecideRenewalDto {
  @ApiProperty({ enum: ['APPROVE', 'DISCONTINUE'] })
  @IsIn(['APPROVE', 'DISCONTINUE'])
  decision!: 'APPROVE' | 'DISCONTINUE';

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) remarks?: string;
}

export class RaiseGrievanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() application_id!: string;

  @ApiProperty({ enum: ['APPLICATION', 'SELECTION', 'DISBURSEMENT', 'SELECTION_OBJECTION'] })
  @IsIn(['APPLICATION', 'SELECTION', 'DISBURSEMENT', 'SELECTION_OBJECTION'])
  subject_type!: 'APPLICATION' | 'SELECTION' | 'DISBURSEMENT' | 'SELECTION_OBJECTION';

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() selection_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() disbursement_id?: string;
  /** For SELECTION_OBJECTION: the run reference from the non-selection notice. */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() selection_run_id?: string;
  @ApiProperty() @IsString() @Length(1, 4000) description!: string;
}

export class ResolveGrievanceDto {
  @ApiProperty({ enum: ['RESOLVED', 'REJECTED'] })
  @IsIn(['RESOLVED', 'REJECTED'])
  outcome!: 'RESOLVED' | 'REJECTED';

  /** The officer's reason (>= 10 characters, REASON_REQUIRED otherwise); sent to the applicant. */
  @ApiProperty({ minLength: 10, maxLength: 4000 }) @IsOptional() @IsString() note?: string;
}

export class GrievanceQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
}
