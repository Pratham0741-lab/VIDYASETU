import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../../src/auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../../src/auth/roles';
import { DbContext } from '../../src/database/db-context';

/**
 * TEST-ONLY routes for the authorization-denials proof. Never part of the
 * production AppModule: mounted only through Test.createTestingModule, like
 * ValidationTestController (Phase 0).
 *
 * None of these routes contains any denial-recording code. Whatever lands in
 * authorization_denials comes from the global exception filter alone.
 */
@Controller('test/denial-probe')
export class DenialProbeController {
  constructor(private readonly db: DbContext) {}

  /** A brand-new guarded route: only SUPER_ADMIN may call it. */
  @Post('role-guarded')
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(200)
  roleGuarded() {
    return { ok: true };
  }

  /**
   * A code path that tries to bypass Phase 4's SYSTEM-actor guard: inside
   * the officer's own request transaction (their real app.actor_id), it
   * forges app.actor_role = 'SYSTEM' and calls workflow_system_transition().
   */
  @Post('applications/:id/workflow-system-transition')
  @Roles(...REVIEWER_ROLES)
  async forgeWorkflowTransition(@Param('id', new ParseUUIDPipe()) id: string) {
    const client = this.db.client;
    await client.$queryRaw`SELECT set_config('app.actor_role', 'SYSTEM', true)`;
    return client.$queryRaw`SELECT workflow_system_transition(
      ${id}::uuid, 'MINISTRY_APPROVED', 'DISBURSED', 'DISBURSED',
      CURRENT_TIMESTAMP, NULL, false) AS updated`;
  }

  /** The same bypass attempt against Phase 7's document_system_flag_application(). */
  @Post('applications/:id/document-flag')
  @Roles(...REVIEWER_ROLES)
  async forgeDocumentFlag(@Param('id', new ParseUUIDPipe()) id: string) {
    const client = this.db.client;
    await client.$queryRaw`SELECT set_config('app.actor_role', 'SYSTEM', true)`;
    return client.$queryRaw`SELECT document_system_flag_application(
      ${id}::uuid, true, NULL, NULL, NULL) AS updated`;
  }
}
