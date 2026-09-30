import { Module } from '@nestjs/common';
import { SchemesModule } from '../schemes/schemes.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DisbursementService } from './disbursement.service';
import { GrievanceService } from './grievance.service';
import {
  GrievanceController,
  RenewalController,
  SanctionController,
} from './post-selection.controller';
import { RenewalService } from './renewal.service';
import { SanctionService } from './sanction.service';

/**
 * Phase 9: confirmation, sanction orders, disbursements, renewals,
 * grievances. PFMS is the Phase 10 PfmsAdapter (IntegrationsModule, by PFMS_MODE).
 */
@Module({
  imports: [SchemesModule, WorkflowModule],
  controllers: [SanctionController, RenewalController, GrievanceController],
  providers: [SanctionService, DisbursementService, RenewalService, GrievanceService],
  // Phase 13E: committee objection decisions resolve through the grievance flow.
  exports: [GrievanceService],
})
export class PostSelectionModule {}
