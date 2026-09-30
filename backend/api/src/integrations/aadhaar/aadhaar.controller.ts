import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsString, Length } from 'class-validator';
import type { Actor } from '../../auth/actor';
import { CurrentActor, Roles } from '../../auth/decorators';
import { AppRole } from '../../auth/roles';
import { AadhaarAuthenticationService } from './aadhaar-authentication.service';

export class AadhaarAuthenticationDto {
  /** 12 digits; spaces and dashes allowed. Never stored, returned or logged. */
  @ApiProperty({ example: '0999 0000 0017' })
  @IsString()
  @Length(12, 20)
  aadhaar_number!: string;

  /** The holder's explicit consent to authenticate with UIDAI (must be true). */
  @ApiProperty() @IsBoolean() consent!: boolean;
}

/** Phase 14 loose ends (Part E): the applicant authenticates their own Aadhaar number. */
@ApiTags('integrations')
@ApiBearerAuth()
@Controller('api/v1/applicants/me/aadhaar-authentication')
export class AadhaarController {
  constructor(private readonly aadhaar: AadhaarAuthenticationService) {}

  @Post()
  @Roles(AppRole.APPLICANT)
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate my Aadhaar number (AADHAAR_MODE; mock by default).' })
  authenticate(@CurrentActor() actor: Actor, @Body() dto: AadhaarAuthenticationDto) {
    return this.aadhaar.authenticate(actor, dto.aadhaar_number, dto.consent);
  }

  @Get()
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'My latest Aadhaar authentication (outcome and masked number only).' })
  latest(@CurrentActor() actor: Actor) {
    return this.aadhaar.latest(actor);
  }
}
