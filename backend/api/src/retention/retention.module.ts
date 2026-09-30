import { Module } from '@nestjs/common';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

/** Phase 17 (C): data retention (scheduled purge, off by default). */
@Module({
  controllers: [RetentionController],
  providers: [RetentionService, SystemTransactionRunner],
})
export class RetentionModule {}
