import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigService } from '../config/app-config.service';
import { DocumentPipelineProcessor } from './document-pipeline.processor';
import { DocumentPipelineQueue } from './document-pipeline.queue';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { SystemActor } from '../workflow/system-actor';
import { DeficienciesModule } from '../deficiencies/deficiencies.module';

@Module({
  imports: [
    // Phase 13C: the upload guard and RESUBMITTED marking for open deficiency items.
    DeficienciesModule,
    // Memory storage (the service hashes, sniffs and stores the bytes itself).
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        limits: { fileSize: config.documents.maxUploadBytes, files: 1, fields: 5 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentPipelineQueue,
    DocumentPipelineProcessor,
    SystemTransactionRunner,
    // Phase 4's same-transaction SYSTEM switch, for DigiLocker extraction rows.
    SystemActor,
  ],
})
export class DocumentsModule {}
