import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { FraudController, FraudReviewService } from './fraud.controller';
import { PrismaFraudData } from './fraud-data';
import { FraudDetectionService } from './fraud-detection.service';
import { FraudHoldGuard } from './fraud-hold.guard';

/**
 * Phase 11: fraud & duplicate detection. Global so Phase 4's queue can read
 * the fraud summary. The hold guard is registered after AuthModule's guards
 * (this module is imported after AuthModule), so it only ever sees
 * authenticated, role-permitted requests.
 */
@Global()
@Module({
  controllers: [FraudController],
  providers: [
    SystemTransactionRunner,
    PrismaFraudData,
    FraudDetectionService,
    FraudReviewService,
    { provide: APP_GUARD, useClass: FraudHoldGuard },
  ],
  exports: [FraudDetectionService],
})
export class FraudModule {}
