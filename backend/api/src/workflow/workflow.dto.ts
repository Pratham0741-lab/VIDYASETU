import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) remarks?: string;

  /**
   * Required (true) to verify an application flagged needs_eligibility_review:
   * the officer confirms they reviewed eligibility manually.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() eligibility_review_confirmed?: boolean;
}

export class RejectDto {
  /** Why the application is rejected (>= 10 characters, REASON_REQUIRED otherwise); recorded on the decision record. */
  @ApiProperty({ minLength: 10, maxLength: 2000 }) @IsOptional() @IsString() remarks?: string;
}

export class MarkDefectiveDto {
  @ApiProperty({ example: 'DEF_INCOME_EXPIRED' })
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/, { message: 'code must be UPPER_SNAKE_CASE (3-64 chars)' })
  code!: string;

  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) description!: string;
  /** The reason (>= 10 characters, REASON_REQUIRED otherwise), recorded on the decision record. */
  @ApiProperty({ minLength: 10, maxLength: 2000 }) @IsOptional() @IsString() remarks?: string;
}

export class ResubmitDto {
  /**
   * Self-declared inputs for the automatic eligibility gate, used only when
   * the application returns to SUBMITTED (the gate had flagged it).
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declared?: Record<string, unknown>;
}

export class QueueQueryDto {
  /** Only applications that do (true) or do not (false) need a manual eligibility review. */
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  needs_eligibility_review?: 'true' | 'false';

  /**
   * Phase 11: only applications with fraud flags - HIGH: held by a HIGH flag
   * not yet marked false positive; ANY: any flag not yet marked false positive.
   */
  @ApiPropertyOptional({ enum: ['HIGH', 'ANY'] })
  @IsOptional()
  @IsIn(['HIGH', 'ANY'])
  fraud?: 'HIGH' | 'ANY';
}
