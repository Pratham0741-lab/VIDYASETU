import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/**
 * Phase 13D: the profile fields an applicant may change themselves. Every
 * other field - name, date of birth, gender, category, district, disability,
 * income, caste certificate and bank account - decides eligibility or
 * identity and stays behind the existing verification (registration and
 * officer review); it is shown, not edited.
 */
export const EDITABLE_PROFILE_FIELDS = ['phone', 'preferred_language'] as const;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9][0-9 -]{5,19}$/, {
    message: 'phone must be 6-20 digits (spaces, - and a leading + allowed)',
  })
  phone?: string;

  /** One of SUPPORTED_LANGUAGES (checked by the service). */
  @ApiPropertyOptional({ example: 'hi' })
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/, { message: 'preferred_language must be an ISO 639 code, e.g. "hi"' })
  preferred_language?: string;
}
