import { Prisma } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';
import type { AppConfigService } from '../config/app-config.service';
import * as pii from '../lib/crypto/pii';
import { PrismaService } from './prisma.service';

// Nothing listens on port 1: queries fail at connection time, after the
// query extension has already run.
const config = {
  database: { url: 'postgresql://test:test@127.0.0.1:1/vidyasetu_test?connect_timeout=1' },
} as unknown as AppConfigService;

function createService(): PrismaService {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
  return new PrismaService(config, logger);
}

describe('PrismaService (with PII extension)', () => {
  let service: PrismaService;

  beforeAll(() => {
    service = createService();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps its own members callable on the extended client', async () => {
    expect(typeof service.onModuleInit).toBe('function');
    expect(typeof service.onModuleDestroy).toBe('function');

    // Runs with `this` bound to the extended client; fails only on connection.
    await expect(service.ping()).rejects.toBeInstanceOf(Prisma.PrismaClientInitializationError);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('routes Applicant writes on the injected instance through encryptPII', async () => {
    const encrypt = jest
      .spyOn(pii, 'encryptPII')
      .mockImplementation((plaintext: string) => Buffer.from(`enc:${plaintext}`));

    const attempt = service.applicant.create({
      data: {
        first_name: 'Test',
        last_name: 'Applicant',
        category: 'ST',
        domicile_state: 'Jharkhand',
        // The extension accepts plaintext; Prisma's static type is still Bytes.
        caste_cert_number: 'CASTE-001' as unknown as Uint8Array<ArrayBuffer>,
        income: '185000.00' as unknown as Uint8Array<ArrayBuffer>,
        bank_account: 'SBIN0001234:1' as unknown as Uint8Array<ArrayBuffer>,
      },
    });

    // The write itself fails (no database). The proof is the spy: the
    // extension on the injected instance received every plaintext PII value.
    await expect(attempt).rejects.toBeInstanceOf(Prisma.PrismaClientInitializationError);
    expect(encrypt.mock.calls.map(([plaintext]) => plaintext)).toEqual([
      'CASTE-001',
      '185000.00',
      'SBIN0001234:1',
    ]);
  });
});
