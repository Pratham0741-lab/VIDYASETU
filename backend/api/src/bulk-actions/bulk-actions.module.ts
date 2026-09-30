import { Module } from '@nestjs/common';
import { DeficienciesModule } from '../deficiencies/deficiencies.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { BulkActionsController } from './bulk-actions.controller';
import { BulkActionsService } from './bulk-actions.service';

/** Phase 13B: bulk clearing of officer queue items. */
@Module({
  imports: [WorkflowModule, DeficienciesModule],
  controllers: [BulkActionsController],
  providers: [BulkActionsService],
})
export class BulkActionsModule {}
