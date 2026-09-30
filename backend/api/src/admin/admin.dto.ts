import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, Validate } from 'class-validator';
import { PasswordPolicyConstraint } from '../auth/dto';
import { PROVISIONABLE_ROLES } from '../auth/roles';

export class ProvisionOfficerDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;

  /** Initial password; same policy as registration. */
  @ApiProperty() @IsString() @Validate(PasswordPolicyConstraint) password!: string;

  @ApiProperty() @IsString() @Length(1, 200) name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 20) phone?: string;

  @ApiProperty({ enum: PROVISIONABLE_ROLES })
  @IsIn(PROVISIONABLE_ROLES as string[])
  role!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) jurisdiction_state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) jurisdiction_district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) institution_code?: string;
}
