import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { TimeoutError, withTimeout } from '../common/utils/with-timeout';

/** Thrown by probes to report a specific, client-safe reason. */
export class ProbeFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ProbeFailure';
  }
}

/**
 * Runs one dependency probe with a timeout and turns the outcome into a
 * terminus up/down result. Probe errors are logged in full but reported to
 * clients only as a short reason (no hostnames, IPs or driver messages).
 */
@Injectable()
export class DependencyHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(DependencyHealthIndicator.name) private readonly logger: PinoLogger,
  ) {}

  async probe(key: string, check: () => Promise<void>): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check(key);
    const startedAt = Date.now();
    try {
      await withTimeout(check(), this.config.health.timeoutMs, `${key} health check`);
      return indicator.up({ latencyMs: Date.now() - startedAt });
    } catch (err) {
      const reason =
        err instanceof ProbeFailure
          ? err.reason
          : err instanceof TimeoutError
            ? 'timeout'
            : 'unavailable';
      this.logger.warn({ err, dependency: key, reason }, 'Dependency health check failed');
      return indicator.down({ reason });
    }
  }
}
