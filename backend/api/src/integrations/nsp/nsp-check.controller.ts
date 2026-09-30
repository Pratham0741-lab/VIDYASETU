import { Controller, Get, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { REVIEWER_ROLES } from '../../auth/roles';
import { Roles } from '../../auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code.enum';
import { DbContext } from '../../database/db-context';
import { NspAdapter } from './nsp.adapter';

/**
 * The NSP duplicate-scholarship check, for reviewing officers. Advisory, not
 * a workflow gate: a name + date-of-birth match needs human judgment (NSP's
 * own key, Aadhaar, is not available here), so the reviewer acts on it with
 * the existing Phase 4 actions (mark defective / reject, with remarks).
 * Available to every reviewing level (INO -> MINISTRY) at any stage: each
 * level may need it, and it changes nothing. Not persisted: the result names
 * other people's scholarship records.
 */
@Injectable()
export class NspCheckService {
  constructor(
    private readonly db: DbContext,
    private readonly nsp: NspAdapter,
  ) {}

  async check(applicationId: string) {
    // The caller's actor transaction: RLS + jurisdiction scope decide
    // visibility (out of jurisdiction == not found, the Phase 2 precedent).
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: {
        id: true,
        application_no: true,
        // Non-sensitive columns only: nothing here is decrypted.
        applicant: { select: { first_name: true, last_name: true, dob: true, gender: true } },
      },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    const a = app.applicant;
    if (!a.dob) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'The applicant has no date of birth on record, which the NSP check needs.',
        details: { reason: 'dob_missing' },
      });
    }
    const result = await this.nsp.checkDuplicateScholarship({
      full_name: `${a.first_name} ${a.last_name}`,
      dob: a.dob.toISOString().slice(0, 10),
      gender: a.gender,
    });
    const availability = await this.nsp.checkAvailability();
    return {
      application_id: app.id,
      application_no: app.application_no,
      nsp_mode: availability.mode,
      ...result,
    };
  }
}

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('api/v1/applications')
export class NspCheckController {
  constructor(private readonly checks: NspCheckService) {}

  @Get(':id/nsp-duplicate-check')
  @Roles(...REVIEWER_ROLES)
  @ApiOperation({
    summary: 'Check NSP for an existing scholarship to this applicant (name + date of birth).',
  })
  check(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.checks.check(id);
  }
}
