import { DynamicModule, Module } from '@nestjs/common';
import { EnvSource, loadConfigOrExit } from './app-config';
import { AppConfigService } from './app-config.service';

export interface AppConfigModuleOptions {
  /**
   * Environment to validate. Defaults to process.env. Tests and the OpenAPI
   * exporter pass an explicit object so they never depend on the host env.
   */
  env?: EnvSource;
}

@Module({})
export class AppConfigModule {
  static forRoot(options: AppConfigModuleOptions = {}): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [
        {
          provide: AppConfigService,
          useFactory: () => new AppConfigService(loadConfigOrExit(options.env ?? process.env)),
        },
      ],
      exports: [AppConfigService],
    };
  }
}
