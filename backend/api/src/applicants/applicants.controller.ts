import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { UpdateProfileDto } from './applicants.dto';
import { ApplicantsService } from './applicants.service';

/** Phase 13D: the applicant's own profile (there is no :id - never anyone else's). */
@ApiTags('applicants')
@ApiBearerAuth()
@Controller('api/v1/applicants')
export class ApplicantsController {
  constructor(private readonly applicants: ApplicantsService) {}

  @Get('me')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({ summary: 'My profile (identifiers masked).' })
  me(@CurrentActor() actor: Actor) {
    return this.applicants.me(actor);
  }

  @Patch('me')
  @Roles(AppRole.APPLICANT)
  @ApiOperation({
    summary:
      'Change my phone number or notification language; other fields stay behind verification.',
  })
  update(@CurrentActor() actor: Actor, @Body() dto: UpdateProfileDto) {
    return this.applicants.update(actor, dto);
  }
}
