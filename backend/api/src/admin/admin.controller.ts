import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { ProvisionOfficerDto } from './admin.dto';
import { AdminService, ProvisionedOfficer } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** The only way to create an officer: there is no public officer registration. */
  @Post('officers')
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Provision an officer (account + officer row). SUPER_ADMIN only.' })
  provision(@Body() dto: ProvisionOfficerDto): Promise<ProvisionedOfficer> {
    return this.admin.provisionOfficer(dto);
  }
}
