import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ApplicationDraftsController } from './application-drafts.controller';
import { ApplicationDraftsService } from './application-drafts.service';
import { ApplicationHistoryController, ApplicationHistoryService } from './application-history';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  // Phase 17: the submit path checks consent (PrivacyService).
  imports: [WorkflowModule, PrivacyModule],
  // Phase 17.2: GET /applications/:id/history.
  controllers: [ApplicationsController, ApplicationDraftsController, ApplicationHistoryController],
  providers: [ApplicationsService, ApplicationDraftsService, ApplicationHistoryService],
})
export class ApplicationsModule {}
