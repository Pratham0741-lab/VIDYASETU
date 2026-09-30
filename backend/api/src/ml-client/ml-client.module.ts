import { Global, Module } from '@nestjs/common';
import { getLoggerToken, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MlClientService } from './ml-client.service';
import { MockMlService } from './mock-ml.service';

/** Builds the configured implementation (also used by specs, so they never import the mock). */
export function createMlClient(config: AppConfigService, logger: PinoLogger): MlClientService {
  return config.ml.mode === 'mock'
    ? new MockMlService(config, logger)
    : new MlClientService(config, logger);
}

/**
 * THE one place that chooses the document-intelligence implementation:
 * ML_MODE=real -> MlClientService (HTTP to the ml service),
 * ML_MODE=mock -> MockMlService (documented fixtures, no image analysis).
 * Everything else injects MlClientService and never imports the mock.
 */
@Global()
@Module({
  providers: [
    {
      provide: MlClientService,
      inject: [AppConfigService, getLoggerToken(MlClientService.name)],
      useFactory: createMlClient,
    },
  ],
  exports: [MlClientService],
})
export class MlClientModule {}
