import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** SUPER_ADMIN and the read-only AUDITOR. Same logic as scripts/verify-audit-chain.ts. */
  @Get('verify')
  @Roles(AppRole.SUPER_ADMIN, AppRole.AUDITOR)
  @ApiOperation({
    summary:
      'Verify the audit chain: recompute every hash, check sequence and links, and check the legacy checkpoint.',
  })
  verify() {
    return this.audit.verify();
  }
}
