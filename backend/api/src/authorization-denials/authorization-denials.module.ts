import { Global, Module } from '@nestjs/common';
import { DenialTransactionRunner } from '../database/denial-transaction.runner';
import {
  AuthorizationDenialsController,
  AuthorizationDenialsService,
} from './authorization-denials.controller';
import { DenialRecorder } from './denial-recorder.service';

/**
 * Global so the app-level exception filter and any background worker can
 * inject DenialRecorder without importing this module.
 */
@Global()
@Module({
  controllers: [AuthorizationDenialsController],
  providers: [DenialRecorder, DenialTransactionRunner, AuthorizationDenialsService],
  exports: [DenialRecorder],
})
export class AuthorizationDenialsModule {}
