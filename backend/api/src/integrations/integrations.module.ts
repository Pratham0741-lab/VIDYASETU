import { Global, Module } from '@nestjs/common';
import { getLoggerToken, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import {
  DigiLockerAdapter,
  MockDigiLockerAdapter,
  UnconfiguredDigiLockerAdapter,
} from './digilocker/digilocker.adapter';
import { NspCheckController, NspCheckService } from './nsp/nsp-check.controller';
import { MockNspAdapter, NspAdapter, UnconfiguredNspAdapter } from './nsp/nsp.adapter';
import { MockPfmsAdapter, PfmsAdapter, UnconfiguredPfmsAdapter } from './pfms/pfms.adapter';
import {
  AadhaarAdapter,
  MockAadhaarAdapter,
  UnconfiguredAadhaarAdapter,
} from './aadhaar/aadhaar.adapter';
import { AadhaarAuthenticationService } from './aadhaar/aadhaar-authentication.service';
import { AadhaarController } from './aadhaar/aadhaar.controller';

/** Builds the configured adapters (also used by specs). */
export function createDigiLockerAdapter(
  config: AppConfigService,
  logger: PinoLogger,
): DigiLockerAdapter {
  return config.integrations.digilocker.mode === 'mock'
    ? new MockDigiLockerAdapter(logger)
    : new UnconfiguredDigiLockerAdapter();
}
export function createPfmsAdapter(config: AppConfigService, logger: PinoLogger): PfmsAdapter {
  return config.integrations.pfms.mode === 'mock'
    ? new MockPfmsAdapter(config, logger)
    : new UnconfiguredPfmsAdapter();
}
export function createAadhaarAdapter(config: AppConfigService, logger: PinoLogger): AadhaarAdapter {
  return config.integrations.aadhaar.mode === 'mock'
    ? new MockAadhaarAdapter(logger)
    : new UnconfiguredAadhaarAdapter();
}
export function createNspAdapter(config: AppConfigService, logger: PinoLogger): NspAdapter {
  return config.integrations.nsp.mode === 'mock'
    ? new MockNspAdapter(logger)
    : new UnconfiguredNspAdapter();
}

/**
 * THE one place that chooses each integration adapter, by DIGILOCKER_MODE /
 * PFMS_MODE / NSP_MODE (default mock; the ML_MODE precedent). Everything else
 * injects the abstract adapter class and never imports a mock.
 * Phase 14 loose ends (Part E): AADHAAR_MODE / AadhaarAdapter, called only by
 * AadhaarAuthenticationService (POST /applicants/me/aadhaar-authentication).
 */
@Global()
@Module({
  controllers: [NspCheckController, AadhaarController],
  providers: [
    {
      provide: DigiLockerAdapter,
      inject: [AppConfigService, getLoggerToken('MockDigiLockerAdapter')],
      useFactory: createDigiLockerAdapter,
    },
    {
      provide: PfmsAdapter,
      inject: [AppConfigService, getLoggerToken('MockPfmsAdapter')],
      useFactory: createPfmsAdapter,
    },
    {
      provide: NspAdapter,
      inject: [AppConfigService, getLoggerToken('MockNspAdapter')],
      useFactory: createNspAdapter,
    },
    {
      provide: AadhaarAdapter,
      inject: [AppConfigService, getLoggerToken('MockAadhaarAdapter')],
      useFactory: createAadhaarAdapter,
    },
    NspCheckService,
    AadhaarAuthenticationService,
  ],
  exports: [DigiLockerAdapter, PfmsAdapter, NspAdapter, AadhaarAdapter],
})
export class IntegrationsModule {}
