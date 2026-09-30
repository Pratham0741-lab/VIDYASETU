import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UploadDocumentDto {
  /** The checklist slot this file is for (one of the scheme version's required documents). */
  @ApiProperty({ example: 'Family Income Certificate' })
  @IsString()
  @Length(1, 300)
  document_type!: string;

  /**
   * Phase 10: instead of a file, the DigiLocker URI of an issued document the
   * applicant has shared with VIDYASETU. Exactly one of file / reference.
   */
  @ApiPropertyOptional({ example: 'in.gov.jharkhand.edistrict-INCER-JH2026000451' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{8,200}$/)
  digilocker_reference?: string;
}

export class ConfirmDocumentDto {
  /** Corrected values by field name, e.g. { "certificate_number": "JH-INC-2026-0042" }. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  corrections?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) remarks?: string;
}
