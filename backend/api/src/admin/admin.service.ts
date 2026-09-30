import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../auth/password';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { ProvisionOfficerDto } from './admin.dto';

export interface ProvisionedOfficer {
  account_id: string;
  officer_id: string;
  email: string;
  role: string;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
  institution_code: string | null;
}

/**
 * Required jurisdiction fields per provisionable role. NULL state means
 * national scope, which only MINISTRY_OFFICER may have; every other role must
 * be pinned so it can never silently gain national access.
 */
function jurisdictionViolation(dto: ProvisionOfficerDto): string | null {
  const state = dto.jurisdiction_state ?? null;
  const district = dto.jurisdiction_district ?? null;
  switch (dto.role) {
    case AppRole.MINISTRY_OFFICER:
      return state === null && district === null ? null : 'ministry_officer_must_be_national';
    case AppRole.STATE_NODAL_OFFICER:
      return state !== null && district === null ? null : 'state_officer_needs_state_only';
    case AppRole.DISTRICT_NODAL_OFFICER:
      return state !== null && district !== null
        ? null
        : 'district_officer_needs_state_and_district';
    case AppRole.INSTITUTE_NODAL_OFFICER:
      return state !== null && district !== null && dto.institution_code
        ? null
        : 'institute_officer_needs_state_district_and_institution_code';
    // Phase 13B: pinned to a state (state-wide) or a state and district,
    // like the officers whose work they review; never national.
    case AppRole.COMMITTEE:
    case AppRole.AUDITOR:
      return state !== null && !dto.institution_code
        ? null
        : 'committee_or_auditor_needs_state_optional_district_no_institution';
    default:
      return 'role_not_provisionable';
  }
}

@Injectable()
export class AdminService {
  constructor(private readonly db: DbContext) {}

  /** Account + officer in the request's actor transaction (one unit of work). */
  async provisionOfficer(dto: ProvisionOfficerDto): Promise<ProvisionedOfficer> {
    const reason = jurisdictionViolation(dto);
    if (reason) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'jurisdiction_state', constraints: { jurisdiction: reason } }],
      });
    }

    const client = this.db.client;
    const role = await client.role.findUnique({ where: { name: dto.role }, select: { id: true } });
    if (!role) {
      // Roles are reference data seeded by scripts/seed-roles.ts.
      throw new AppError(ErrorCode.INTERNAL_ERROR, { details: { reason: 'role_not_seeded' } });
    }

    const email = dto.email.trim().toLowerCase();
    try {
      const account = await client.account.create({
        data: { email, password_hash: await hashPassword(dto.password) },
        select: { id: true },
      });
      const officer = await client.officer.create({
        data: {
          user_id: account.id,
          email,
          name: dto.name,
          phone: dto.phone,
          role_id: role.id,
          jurisdiction_state: dto.jurisdiction_state ?? null,
          jurisdiction_district: dto.jurisdiction_district ?? null,
          institution_code: dto.institution_code ?? null,
        },
      });
      return {
        account_id: account.id,
        officer_id: officer.id,
        email,
        role: dto.role,
        jurisdiction_state: officer.jurisdiction_state,
        jurisdiction_district: officer.jurisdiction_district,
        institution_code: officer.institution_code,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, { details: { field: 'email' } });
      }
      throw err;
    }
  }
}
