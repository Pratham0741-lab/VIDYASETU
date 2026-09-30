import type { Request } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../common/context/request-context';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type {
  DenialIdentity,
  DenialTransactionRunner,
} from '../database/denial-transaction.runner';
import { DenialRecorder } from './denial-recorder.service';

const actor = {
  accountId: 'u-1',
  role: 'INSTITUTE_NODAL_OFFICER' as const,
  officerId: 'o-1',
  jurisdictionState: 'Jharkhand',
  jurisdictionDistrict: 'Ranchi',
};

type Work = () => Promise<void>;

function build() {
  const queryRaw = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue([{ id: 'd-1' }]);
  const tx = { $queryRaw: queryRaw };
  // The fresh transaction: runs `work` with the transaction client in RequestContext.
  const run = jest.fn<Promise<void>, [DenialIdentity, string | null, string, Work]>(
    (_identity, _ip, requestId, work) => RequestContext.run({ requestId, db: tx as never }, work),
  );
  const logger = { error: jest.fn() };
  const recorder = new DenialRecorder(
    { run } as unknown as DenialTransactionRunner,
    logger as unknown as PinoLogger,
  );
  return { recorder, run, queryRaw, logger };
}

const req = (withActor: boolean) =>
  ({
    method: 'POST',
    baseUrl: '',
    route: { path: '/api/v1/selections/:id/confirm' },
    params: { id: 's-1' },
    headers: { 'x-request-id': 'req-1' },
    ip: '10.0.0.9',
    ...(withActor ? { actor } : {}),
  }) as unknown as Request;

describe('DenialRecorder', () => {
  it('writes a denial in a fresh transaction carrying the refused actor', async () => {
    const { recorder, run, queryRaw } = build();
    await recorder.recordHttp(
      new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'role_not_permitted' } }),
      req(true),
    );
    expect(run).toHaveBeenCalledWith(
      { kind: 'actor', accountId: 'u-1', role: 'INSTITUTE_NODAL_OFFICER' },
      '10.0.0.9',
      'req-1',
      expect.any(Function),
    );
    const values = queryRaw.mock.calls[0].slice(1);
    expect(values.slice(0, 4)).toEqual([
      'POST /api/v1/selections/:id/confirm',
      'selection',
      's-1',
      'WRONG_ROLE',
    ]);
    expect(JSON.parse(values[4] as string)).toMatchObject({
      reason: 'role_not_permitted',
      origin: 'http',
    });
  });

  it('writes nothing for an error that is not a denial', async () => {
    const { recorder, run, queryRaw } = build();
    await recorder.recordHttp(new AppError(ErrorCode.NOT_FOUND), req(true));
    await recorder.recordHttp(new AppError(ErrorCode.VALIDATION_ERROR), req(true));
    expect(run).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('attributes a job failure to the SYSTEM actor', async () => {
    const { recorder, run, queryRaw } = build();
    const raise = Object.assign(new Error('x'), {
      meta: {
        message: 'ERROR: document_system_flag_application may only run as the SYSTEM actor (...)',
      },
    });
    await recorder.recordJob(raise, {
      queue: 'document-pipeline',
      jobId: 'j',
      attempt: 1,
      requestId: 'req-2',
      subjectType: 'application',
      subjectId: 'a-1',
    });
    expect(run).toHaveBeenCalledWith(
      { kind: 'system', role: 'SYSTEM' },
      null,
      'req-2',
      expect.any(Function),
    );
    expect(queryRaw.mock.calls[0].slice(1, 5)).toEqual([
      'db.document_system_flag_application',
      'application',
      'a-1',
      'SYSTEM_ACTOR_GUARD_FAILED',
    ]);
  });

  it('never throws when the write fails; logs at error level instead', async () => {
    const { recorder, queryRaw, logger } = build();
    queryRaw.mockRejectedValueOnce(new Error('database down'));
    await expect(
      recorder.recordHttp(new AppError(ErrorCode.FORBIDDEN), req(true)),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ denial_reason: 'FORBIDDEN' }),
      'authorization denial could not be recorded',
    );
  });
});
