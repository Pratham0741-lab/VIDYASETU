import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class CheckEligibilityDto {
  /**
   * Applicant-shaped profile, e.g. { "category": "ST", "family_income_annual":
   * 180000, "age": 29, "degree_enrolled": "PhD" }. Field names are those
   * returned by the form-schema endpoint. Validated by sanitizeProfile.
   */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  applicant!: Record<string, unknown>;
}

export class EvaluateEligibilityDto {
  /**
   * Self-declared inputs not stored in the applicant/application records
   * (e.g. education_level, degree_enrolled, tenure_years, exam scores).
   * Recorded fields (category, income, age, domicile, ...) come from the
   * database and cannot be overridden here.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declared?: Record<string, unknown>;
}
