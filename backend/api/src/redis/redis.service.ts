import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';

const RECONNECT_BASE_DELAY_MS = 200;
const MAX_RECONNECT_DELAY_MS = 5000;
/** Upper bound for establishing a TCP connection before retrying. */
const CONNECT_TIMEOUT_MS = 5000;
/** How long ping() waits for PONG before declaring the connection dead. */
export const PING_TIMEOUT_MS = 2000;
/** Log at most one connection error per this interval while Redis is down. */
const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * Reconnect delay for attempt n (1-based): exponential backoff capped at
 * MAX_RECONNECT_DELAY_MS. Always returns a number, so ioredis never gives up.
 */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_RECONNECT_DELAY_MS);
}

class PingTimeoutError extends Error {
  constructor(ms: number) {
    super(`Redis PING timed out after ${ms}ms`);
    this.name = 'PingTimeoutError';
  }
}

/**
 * Owns the shared ioredis connection. Reconnects forever with backoff, and
 * connection errors are logged rather than thrown, so a Redis outage never
 * crashes the process.
 *
 * TODO(queues phase): BullMQ needs its own connections with
 * maxRetriesPerRequest: null; create them from `connectionOptions()`.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private lastErrorLoggedAt = 0;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    this.client = new Redis({
      ...this.connectionOptions(),
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Per-command retry budget only; it does not stop reconnection.
      maxRetriesPerRequest: 1,
      // Reconnection itself: never give up, back off up to 5s between attempts.
      retryStrategy: reconnectDelay,
    });

    this.client.on('ready', () => this.logger.info('Connected to Redis'));
    this.client.on('reconnecting', (delayMs: number) =>
      this.logger.debug({ delayMs }, 'Reconnecting to Redis'),
    );
    this.client.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        this.lastErrorLoggedAt = now;
        this.logger.error({ err }, 'Redis connection error');
      }
    });
  }

  connectionOptions(): { host: string; port: number; password?: string } {
    const { host, port, password } = this.config.redis;
    return { host, port, ...(password ? { password } : {}) };
  }

  onModuleInit(): void {
    // Not awaited: startup must not block or fail on Redis availability.
    this.client.connect().catch((err: unknown) => {
      this.logger.warn({ err }, 'Redis unavailable at startup; reconnecting in background');
    });
  }

  onModuleDestroy(): void {
    const status = this.client.status;
    // Already closed: nothing to close (DEV-3).
    if (status === 'end') return;
    this.client.disconnect(false);
    // DEV-3: while 'reconnecting' the socket is already closed. disconnect()
    // still cancels the pending reconnect, but ioredis (5.x) also arms a 2 s
    // destroy timer on that closed socket, waiting for a 'close' event that
    // already happened - it held shutdown for the full 2 s. Re-announcing the
    // close on the closed socket lets ioredis clear that timer at once.
    if (status === 'reconnecting') this.client.stream?.emit('close', false);
  }

  /**
   * Readiness probe. Always sends a real PING on the current client; it never
   * answers from cached connection status. While ioredis is reconnecting the
   * PING waits in the offline queue, so it succeeds as soon as Redis is back.
   *
   * If the socket claims to be connected but PING gets no reply in time, the
   * connection is half-open (peer vanished without FIN/RST). ioredis cannot
   * detect that by itself, so the socket is dropped here to trigger
   * retryStrategy; the next ping() then runs on a fresh connection.
   */
  async ping(timeoutMs: number = PING_TIMEOUT_MS): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PingTimeoutError(timeoutMs)), timeoutMs);
    });

    try {
      const reply = await Promise.race([this.client.ping(), timeout]);
      if (reply !== 'PONG') {
        throw new Error('Unexpected PING reply');
      }
    } catch (err) {
      if (err instanceof PingTimeoutError && this.client.status === 'ready') {
        this.logger.warn('Redis PING unanswered on a ready connection; forcing reconnect');
        this.client.disconnect(true);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
