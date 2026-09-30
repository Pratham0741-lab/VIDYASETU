import { Injectable } from '@nestjs/common';
import type { AppConfig } from './app-config';

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The only way application code reads configuration.
 * Nothing outside src/config may touch process.env.
 */
@Injectable()
export class AppConfigService {
  private readonly config: Readonly<AppConfig>;

  constructor(config: AppConfig) {
    this.config = deepFreeze(structuredClone(config));
  }

  get<K extends keyof AppConfig>(key: K): Readonly<AppConfig[K]> {
    return this.config[key];
  }

  get nodeEnv(): AppConfig['nodeEnv'] {
    return this.config.nodeEnv;
  }

  get isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.port;
  }

  get logLevel(): AppConfig['logLevel'] {
    return this.config.logLevel;
  }

  get cors(): Readonly<AppConfig['cors']> {
    return this.config.cors;
  }

  get swagger(): Readonly<AppConfig['swagger']> {
    return this.config.swagger;
  }

  get http(): Readonly<AppConfig['http']> {
    return this.config.http;
  }

  get database(): Readonly<AppConfig['database']> {
    return this.config.database;
  }

  get redis(): Readonly<AppConfig['redis']> {
    return this.config.redis;
  }

  get storage(): Readonly<AppConfig['storage']> {
    return this.config.storage;
  }

  get ml(): Readonly<AppConfig['ml']> {
    return this.config.ml;
  }

  get documents(): Readonly<AppConfig['documents']> {
    return this.config.documents;
  }

  get postSelection(): Readonly<AppConfig['postSelection']> {
    return this.config.postSelection;
  }

  get deficiencies(): Readonly<AppConfig['deficiencies']> {
    return this.config.deficiencies;
  }

  get languages(): Readonly<AppConfig['languages']> {
    return this.config.languages;
  }

  get selectionLists(): Readonly<AppConfig['selectionLists']> {
    return this.config.selectionLists;
  }

  get consent(): Readonly<AppConfig['consent']> {
    return this.config.consent;
  }

  get retention(): Readonly<AppConfig['retention']> {
    return this.config.retention;
  }

  get slaSweep(): Readonly<AppConfig['slaSweep']> {
    return this.config.slaSweep;
  }

  get schemes(): Readonly<AppConfig['schemes']> {
    return this.config.schemes;
  }

  get fraud(): Readonly<AppConfig['fraud']> {
    return this.config.fraud;
  }

  get integrations(): Readonly<AppConfig['integrations']> {
    return this.config.integrations;
  }

  get health(): Readonly<AppConfig['health']> {
    return this.config.health;
  }

  get auth(): Readonly<AppConfig['auth']> {
    return this.config.auth;
  }

  get mail(): Readonly<AppConfig['mail']> {
    return this.config.mail;
  }
}
