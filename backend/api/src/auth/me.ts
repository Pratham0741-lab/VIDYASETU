import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DbContext } from '../database/db-context';
import type { Actor } from './actor';

/** GET /auth/me: the caller as the api sees it. */
export class MeDto {
  @ApiProperty({ format: 'uuid' }) accountId!: string;
  @ApiProperty({ example: 'INSTITUTE_NODAL_OFFICER' }) role!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) officerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) jurisdictionState!: string | null;
  @ApiProperty({ nullable: true, type: String }) jurisdictionDistrict!: string | null;

  @ApiPropertyOptional({ description: 'Phase 17.2, officers only: the officer’s name.' })
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Phase 17.2, officers only: the institution code (institute officers), else null.',
  })
  institution_code?: string | null;
}

/**
 * Phase 17.2: an officer's own name and institution code for GET /auth/me,
 * read through current_officer_profile() (migration 20261004090000): officers
 * has no row-level security, so the function returns only the row of the
 * officer the transaction's actor is. Applicants get nothing new.
 */
@Injectable()
export class MeService {
  constructor(private readonly db: DbContext) {}

  async me(actor: Actor): Promise<MeDto> {
    if (!actor.officerId) return { ...actor };
    const [p] = await this.db.client.$queryRaw<
      Array<{ name: string; institution_code: string | null }>
    >`
      SELECT name, institution_code FROM current_officer_profile()`;
    return p ? { ...actor, name: p.name, institution_code: p.institution_code } : { ...actor };
  }
}
