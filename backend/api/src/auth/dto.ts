import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { passwordPolicyViolation, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password';

@ValidatorConstraint({ name: 'passwordPolicy' })
export class PasswordPolicyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && passwordPolicyViolation(value) === null;
  }

  defaultMessage(): string {
    return `password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters, contain a letter and a digit, and not be one repeated character`;
  }
}

export const APPLICANT_GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const;

export class RegisterDto {
  @ApiProperty({ example: 'asha.munda@example.org' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Validate(PasswordPolicyConstraint)
  password!: string;

  @ApiProperty() @IsString() @Length(1, 100) first_name!: string;
  @ApiProperty() @IsString() @Length(1, 100) last_name!: string;

  @ApiProperty({ enum: ['ST', 'PVTG'] })
  @IsIn(['ST', 'PVTG'])
  category!: string;

  @ApiProperty() @IsString() @Length(1, 100) domicile_state!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) domicile_district?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 20) phone?: string;

  /** PII: stored AES-256-GCM encrypted. */
  @ApiProperty() @IsString() @Length(1, 64) caste_cert_number!: string;

  /** PII: annual family income in rupees, e.g. "185000.00". Stored encrypted. */
  @ApiProperty({ example: '185000.00' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  annual_income!: string;

  /** PII: e.g. "SBIN0001234:30012345678". Stored encrypted. */
  @ApiProperty() @IsString() @Length(1, 64) bank_account!: string;

  // Optional (Phase 6). Used for eligibility (age) and horizontal
  // reservations; an applicant who leaves them out is simply not considered
  // for the reservation that needs them.
  @ApiPropertyOptional({ enum: APPLICANT_GENDERS })
  @IsOptional()
  @IsIn(APPLICANT_GENDERS)
  gender?: string;

  /** Date of birth, YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2000-04-17' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob must be a date in YYYY-MM-DD format' })
  dob?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_disabled?: boolean;

  /** Only with is_disabled: true. */
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  disability_percentage?: number;

  /** Phase 13C: the language notices are sent in (ISO 639 code; default "en"). */
  @ApiPropertyOptional({ example: 'hi', default: 'en' })
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/, { message: 'preferred_language must be an ISO 639 code, e.g. "hi"' })
  preferred_language?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;

  /** No policy check at login; only a length cap (hashing cost bound). */
  @ApiProperty() @IsString() @Length(1, PASSWORD_MAX_LENGTH) password!: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() @Length(20, 200) refresh_token!: string;
}
