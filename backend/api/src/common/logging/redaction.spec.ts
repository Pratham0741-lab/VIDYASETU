import { Writable } from 'node:stream';
import pino from 'pino';
import { buildLoggerOptions } from './logger-options';
import { isSensitiveLogKey, SENSITIVE_LOG_KEYS } from './redaction';

/** A value for every sensitive key, each distinctive enough to find in the output. */
const VALUES: Record<string, string> = {
  first_name: 'Kavyaname',
  last_name: 'Oraonsurname',
  full_name: 'Kavya Oraon Full',
  applicant_name: 'Applicant Namevalue',
  holder_name: 'Holder Namevalue',
  email: 'kavya.leak@example.org',
  phone: '+91 98765 43210',
  dob: '2001-02-03',
  date_of_birth: '2001-02-04',
  income: '181818',
  annual_income: '171717.00',
  family_income_annual: '161616',
  bank_account: 'SBIN0001234:30948291048',
  ifsc: 'SBIN0009999',
  caste_cert_number: 'JH-ST-2026-LEAK1',
  certificate_number: 'JH-INC-2026-LEAK2',
  aadhaar_number: '0999 0000 0017',
  password: 'Sup3rSecret!pw',
  refresh_token: 'rt_leaky_token_value',
  remarks: 'remark text about Kavya',
  reason: 'reason text naming Oraon',
  review_notes: 'review note text',
  description: 'description text value',
  body: 'notification body text value',
  subject: 'notification subject value',
  progress_report: 'progress report text value',
};

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const opts = buildLoggerOptions({ logLevel: 'debug' } as never).pinoHttp as pino.LoggerOptions;
  const logger = pino(
    {
      formatters: opts.formatters,
      serializers: opts.serializers,
      hooks: opts.hooks,
      level: 'debug',
    },
    stream,
  );
  return { logger, text: () => lines.join('') };
}

describe('log redaction (Phase 17, Part A)', () => {
  it('covers every field this test logs', () => {
    for (const k of Object.keys(VALUES)) expect([k, isSensitiveLogKey(k)]).toEqual([k, true]);
    expect(SENSITIVE_LOG_KEYS.size).toBeGreaterThan(40);
  });

  it('no sensitive value appears, at any depth, in objects, arrays, errors or job payloads', () => {
    const { logger, text } = capture();
    logger.info({ ...VALUES }, 'flat');
    logger.info({ job: { data: { applicant: { profile: { ...VALUES } } } } }, 'nested job payload');
    logger.info(
      { rows: [{ ...VALUES }, { deeper: [{ Bank_Account: VALUES.bank_account }] }] },
      'array',
    );
    logger.warn(
      { details: [{ field: 'phone', constraints: { x: 'bad' } }], FirstName: VALUES.first_name },
      'details',
    );
    const prismaLike = Object.assign(
      new Error(
        `\nInvalid \`prisma.applicant.create()\` invocation:\n{ data: { first_name: "${VALUES.first_name}", email: "${VALUES.email}", bank_account: "${VALUES.bank_account}" } }`,
      ),
      { name: 'PrismaClientValidationError', meta: { target: ['email'], email: VALUES.email } },
    );
    logger.error({ err: prismaLike }, 'prisma');
    logger.error(
      {
        err: new Error(
          `mail to ${VALUES.email} failed; call ${VALUES.phone}; account ${VALUES.bank_account}`,
        ),
      },
      'free text',
    );
    logger.error(
      { err: Object.assign(new Error('wrapped'), { cause: { remarks: VALUES.remarks } }) },
      'cause',
    );
    // A Prisma error EVENT passes the whole invocation as the message string.
    logger.error(
      { target: 'applicant.create' },
      `\nInvalid \`prisma.applicant.create()\` invocation:\n{ data: { last_name: "${VALUES.last_name}", dob: "${VALUES.dob}" } }`,
    );
    logger.warn(`plain message naming ${VALUES.email} and ${VALUES.phone}`);
    const out = text();
    for (const [k, v] of Object.entries(VALUES)) expect([k, out.includes(v)]).toEqual([k, false]);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('PrismaClientValidationError');
    expect(out).toContain('Invalid `prisma.applicant.create()` invocation:');
    expect(out).toContain('[email]');
    expect(out).toContain('"field":"phone"');
  });

  it('a request is logged as method, path, query names and body field names / sizes only', () => {
    const { logger, text } = capture();
    logger.info(
      {
        // pino-http passes the request object (a class instance, like
        // IncomingMessage): the formatter leaves it to the req serializer.
        req: Object.assign(new (class FakeRequest {})(), {
          id: 'r1',
          method: 'POST',
          url: `/api/v1/auth/register?email=${encodeURIComponent(VALUES.email)}&lang=hi`,
          params: {},
          raw: { body: { ...VALUES, nested: { phone: VALUES.phone } } },
          headers: { authorization: 'Bearer secret' },
          remoteAddress: '10.1.2.3',
        }),
      },
      'request completed',
    );
    const line = JSON.parse(text()) as {
      req: { url: string; body: { fields: Array<{ name: string; size: number }> } };
    };
    expect(line.req.url).toBe('/api/v1/auth/register?email=…&lang=…');
    expect(line.req.body.fields.find((f) => f.name === 'first_name')).toEqual({
      name: 'first_name',
      type: 'string',
      size: VALUES.first_name.length,
    });
    const out = text();
    for (const [k, v] of Object.entries(VALUES)) expect([k, out.includes(v)]).toEqual([k, false]);
    expect(out).not.toContain('Bearer secret');
    expect(out).not.toContain('10.1.2.3');
  });
});
