import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { DeficienciesController } from './deficiencies.controller';
import { DeficienciesService } from './deficiencies.service';

/** Phase 13C: the deficiency loop (plan Phase 10). */
@Module({
  imports: [WorkflowModule],
  controllers: [DeficienciesController],
  providers: [DeficienciesService],
  exports: [DeficienciesService],
})
export class DeficienciesModule {}
