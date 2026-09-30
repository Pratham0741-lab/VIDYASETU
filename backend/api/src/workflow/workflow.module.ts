import { Module } from '@nestjs/common';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { SchemesModule } from '../schemes/schemes.module';
import { SlaSweepService } from './sla-sweep.service';
import { SystemActor } from './system-actor';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

/**
 * Import before ApplicationsModule in AppModule: its GET /applications/queue
 * and /applications/sla-breaches must be registered before the
 * GET /applications/:id route.
 */
@Module({
  imports: [SchemesModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, SystemActor, SlaSweepService, SystemTransactionRunner],
  exports: [WorkflowService, SlaSweepService],
})
export class WorkflowModule {}
