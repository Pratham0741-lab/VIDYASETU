import { createServer, Server, Socket } from 'node:net';
import type { PinoLogger } from 'nestjs-pino';
import type { AppConfigService } from '../config/app-config.service';
import { RedisService } from './redis.service';

/**
 * Minimal RESP server: just enough of the Redis protocol for ioredis to
 * connect (INFO ready check, AUTH) and answer PING. It can be stopped and
 * restarted on the same port to simulate `docker compose stop/start redis`.
 */
class FakeRedisServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly frozen = new Set<Socket>();
  port = 0;

  async start(): Promise<void> {
    const server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address && typeof address === 'object') this.port = address.port;
    this.server = server;
  }

  /** Kills live connections and stops listening, like a stopped container. */
  async stop(): Promise<void> {
    for (const socket of [...this.sockets, ...this.frozen]) socket.destroy();
    this.sockets.clear();
    this.frozen.clear();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Half-open failure: stop listening, but leave existing connections open
   * and silent (no FIN/RST, no replies), like a peer whose IP disappeared.
   */
  async blackhole(): Promise<void> {
    for (const socket of this.sockets) this.frozen.add(socket);
    this.sockets.clear();
    // Stop accepting immediately. Not awaiting close(): its callback only
    // fires once every connection ends, and the frozen ones never do.
    this.server?.close();
    this.server = undefined;
    return Promise.resolve();
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.frozen.delete(socket);
    });
    socket.on('error', () => undefined);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let parsed: { args: string[]; rest: string } | undefined;
      while ((parsed = parseCommand(buffer))) {
        buffer = parsed.rest;
        if (!this.frozen.has(socket)) socket.write(reply(parsed.args));
      }
    });
  }
}

/** Parses one RESP array of bulk strings, or returns undefined if incomplete. */
function parseCommand(input: string): { args: string[]; rest: string } | undefined {
  if (!input.startsWith('*')) return undefined;
  let pos = input.indexOf('\r\n');
  if (pos < 0) return undefined;
  const count = Number(input.slice(1, pos));
  pos += 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    const lineEnd = input.indexOf('\r\n', pos);
    if (lineEnd < 0) return undefined;
    const length = Number(input.slice(pos + 1, lineEnd));
    const start = lineEnd + 2;
    if (input.length < start + length + 2) return undefined;
    args.push(input.slice(start, start + length));
    pos = start + length + 2;
  }
  return { args, rest: input.slice(pos) };
}

function reply(args: string[]): string {
  switch ((args[0] ?? '').toUpperCase()) {
    case 'PING':
      return '+PONG\r\n';
    case 'INFO': {
      const info = '# Server\r\nredis_version:7.4.11\r\nloading:0\r\n';
      return `$${Buffer.byteLength(info)}\r\n${info}\r\n`;
    }
    default:
      return '+OK\r\n';
  }
}

async function eventually(assertion: () => Promise<void>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

describe('RedisService', () => {
  const fake = new FakeRedisServer();
  let service: RedisService;

  beforeAll(async () => {
    await fake.start();
    const config = {
      redis: { host: '127.0.0.1', port: fake.port, password: undefined },
    } as unknown as AppConfigService;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;
    service = new RedisService(config, logger);
    service.onModuleInit();
  });

  afterAll(async () => {
    service.onModuleDestroy();
    await fake.stop();
  });

  it('recovers after the connection drops, using the same instance', async () => {
    // 1. Connected: ping succeeds.
    await eventually(() => service.ping(), 3000);

    // 2. Redis goes away: ping fails.
    await fake.stop();
    await eventually(async () => {
      await expect(service.ping()).rejects.toThrow();
    }, 3000);

    // 3. Redis comes back on the same address: ping succeeds again
    //    without recreating RedisService or restarting anything.
    await fake.start();
    await eventually(() => service.ping(), 5000);
  }, 15000);

  it('recovers from a half-open connection (peer vanished without closing)', async () => {
    await eventually(() => service.ping(), 3000);

    // The socket stays "connected" from the client's point of view but
    // nothing answers; ping must fail rather than hang or report cached state.
    await fake.blackhole();
    await expect(service.ping()).rejects.toThrow();

    await fake.start();
    await eventually(() => service.ping(), 8000);
  }, 20000);
});

describe('RedisService.onModuleDestroy (Phase 13E, DEV-3)', () => {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;

  it('while reconnecting: stops reconnecting and leaves no pending socket timer', async () => {
    const fake = new FakeRedisServer();
    await fake.start();
    const config = {
      redis: { host: '127.0.0.1', port: fake.port, password: undefined },
    } as unknown as AppConfigService;
    const service = new RedisService(config, logger);
    service.onModuleInit();
    await eventually(() => service.ping(), 3000);
    await fake.stop();
    await eventually(
      () => Promise.resolve(expect(service.client.status).toBe('reconnecting')),
      3000,
    );

    const timers = () =>
      (process as unknown as { getActiveResourcesInfo(): string[] })
        .getActiveResourcesInfo()
        .filter((r) => r === 'Timeout').length;
    let attempts = 0;
    service.client.on('connecting', () => attempts++);
    const before = timers(); // includes the pending reconnect timer
    service.onModuleDestroy();
    // The reconnect timer is cancelled and ioredis' socket destroy timer is
    // already cleared: one timer fewer, not the same number (the DEV-3 bug).
    expect(timers()).toBe(before - 1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(attempts).toBe(0);
  });

  it('already ended: does nothing', () => {
    const config = {
      redis: { host: '127.0.0.1', port: 1, password: undefined },
    } as unknown as AppConfigService;
    const service = new RedisService(config, logger);
    const disconnect = jest.spyOn(service.client, 'disconnect');
    Object.defineProperty(service.client, 'status', { value: 'end' });
    service.onModuleDestroy();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
