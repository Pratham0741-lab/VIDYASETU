import { Module } from '@nestjs/common';
import { FairnessController } from './fairness.controller';
import { FairnessService } from './fairness.service';

/** Phase 13E: fairness data (plan Phase 13 / 16). */
@Module({
  controllers: [FairnessController],
  providers: [FairnessService],
})
export class FairnessModule {}
