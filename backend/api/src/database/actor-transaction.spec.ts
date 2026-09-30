import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { RequestContext } from '../common/context/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import { ActorTransactionInterceptor } from './actor-transaction.interceptor';
import { ActorTransactionRunner } from './actor-transaction.runner';

const actor: Actor = {
  accountId: '11111111-1111-4111-8111-111111111111',
  role: AppRole.DISTRICT_NODAL_OFFICER,
  officerId: '22222222-2222-4222-8222-222222222222',
  jurisdictionState: 'Jharkhand',
  jurisdictionDistrict: 'Ranchi',
};

function fakePrisma() {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`queryRaw:${strings.join('?').replace(/\s+/g, ' ').trim()}`);
      return Promise.resolve([{ values }]);
    }),
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>, options: unknown) => {
      calls.push(`begin:${JSON.stringify(options)}`);
      const result = await fn(tx);
      calls.push('commit');
      return result;
    }),
  };
  return { prisma: prisma as unknown as PrismaService, tx, calls };
}

describe('ActorTransactionRunner', () => {
  it('sets the actor with transaction-local set_config as the first statement', async () => {
    const { prisma, tx, calls } = fakePrisma();
    const runner = new ActorTransactionRunner(prisma);

    await RequestContext.run({ requestId: 'r-1' }, () =>
      runner.run(actor, '10.0.0.7', () => Promise.resolve('ok')),
    );

    expect(calls[0]).toMatch(/^begin:/);
    expect(calls[1]).toContain("set_config('app.actor_id', ?, true)");
    expect(calls[1]).toContain("set_config('app.actor_role', ?, true)");
    expect(calls[1]).toContain("set_config('app.request_ip', ?, true)");
    // Values are bind parameters, never interpolated into the SQL text.
    expect(calls[1]).not.toContain(actor.accountId);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([
      actor.accountId,
      AppRole.DISTRICT_NODAL_OFFICER,
      '10.0.0.7',
    ]);
    expect(calls[calls.length - 1]).toBe('commit');
  });

  it('exposes the transaction client and actor for the whole unit of work, then clears them', async () => {
    const { prisma, tx } = fakePrisma();
    const runner = new ActorTransactionRunner(prisma);
    const seen: unknown[] = [];

    await RequestContext.run({ requestId: 'r-2' }, async () => {
      await runner.run(actor, null, async () => {
        seen.push(RequestContext.db(), RequestContext.actor(), RequestContext.requestId());
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(RequestContext.db()); // still the same client after an async hop
      });
      seen.push(RequestContext.db(), RequestContext.actor());
    });

    expect(seen).toEqual([tx, actor, 'r-2', tx, undefined, undefined]);
  });

  it('passes an empty request_ip when unknown (read back as NULL via NULLIF)', async () => {
    const { prisma, tx } = fakePrisma();
    await new ActorTransactionRunner(prisma).run(actor, null, () => Promise.resolve(1));
    expect(tx.$queryRaw.mock.calls[0][3]).toBe('');
  });
});

describe('ActorTransactionInterceptor', () => {
  function httpContext(req: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('opens no transaction for requests without an actor (public routes)', async () => {
    const run = jest.fn();
    const interceptor = new ActorTransactionInterceptor({
      run,
    } as unknown as ActorTransactionRunner);
    const next: CallHandler = { handle: () => of('public') };

    await expect(lastValueFrom(interceptor.intercept(httpContext({}), next))).resolves.toBe(
      'public',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the handler inside the actor transaction for authenticated requests', async () => {
    const run = jest.fn((_a: Actor, _ip: string | null, work: () => Promise<unknown>) => work());
    const interceptor = new ActorTransactionInterceptor({
      run,
    } as unknown as ActorTransactionRunner);
    const next: CallHandler = { handle: () => of('handled') };

    const result = await lastValueFrom(
      interceptor.intercept(httpContext({ actor, ip: '203.0.113.9' }), next),
    );

    expect(result).toBe('handled');
    expect(run).toHaveBeenCalledWith(actor, '203.0.113.9', expect.any(Function));
  });
});
