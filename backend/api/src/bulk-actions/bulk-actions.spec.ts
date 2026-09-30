import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { DbContext } from '../database/db-context';
import type { DeficienciesService } from '../deficiencies/deficiencies.service';
import type { FraudDetectionService } from '../fraud/fraud-detection.service';
import type { WorkflowService } from '../workflow/workflow.service';
import { BulkActionsService } from './bulk-actions.service';

const INO = {
  accountId: 'a',
  role: AppRole.INSTITUTE_NODAL_OFFICER,
  officerId: 'o',
} as unknown as Actor;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const CFG = { config: { required_documents: ['Family Income Certificate'], rules: [] } };
const APPS = [
  {
    id: id(1),
    application_no: 'A1',
    current_stage: 'INO_VERIFIED',
    needs_eligibility_review: false,
    scheme_version: CFG,
  },
  {
    id: id(2),
    application_no: 'A2',
    current_stage: 'INO_VERIFIED',
    needs_eligibility_review: false,
    scheme_version: CFG,
  }, // held
  {
    id: id(3),
    application_no: 'A3',
    current_stage: 'DNO_VERIFIED',
    needs_eligibility_review: false,
    scheme_version: CFG,
  }, // DNO's stage
  {
    id: id(4),
    application_no: 'A4',
    current_stage: 'INO_VERIFIED',
    needs_eligibility_review: true,
    scheme_version: CFG,
  },
  // id(5): not visible (out of scope under RLS)
];

function setup(actImpl?: () => Promise<unknown>, apps: unknown[] = APPS) {
  const act = jest.fn(
    actImpl ??
      (() =>
        Promise.resolve({
          transition: { to_stage: 'DNO_VERIFIED' },
          decision_record_id: 'd',
        })),
  );
  const runForApplication = jest.fn(() => Promise.resolve({}));
  const holdingFlags = jest.fn((appId: string) =>
    Promise.resolve(
      appId === id(2) ? [{ id: 'f1', flag_type: 'SHARED_BANK_ACCOUNT', status: 'OPEN' }] : [],
    ),
  );
  // Phase 17 (F4): the transaction-local batch-id settings the service makes.
  const settings: unknown[][] = [];
  const db = {
    client: {
      application: { findMany: () => Promise.resolve(apps) },
      $executeRaw: (_sql: TemplateStringsArray, ...values: unknown[]) => {
        settings.push(values);
        return Promise.resolve(1);
      },
    },
  } as unknown as DbContext;
  const deficiencies = {
    issue: jest.fn((_actor: unknown, appId: string, _dto: unknown) =>
      Promise.resolve({
        current_stage: 'DEFECTIVE',
        decision_record_id: `dr-${appId}`,
        deficiency_id: `def-${appId}`,
        items: [
          {
            id: `item-${appId}`,
            status: 'OPEN',
            problem_code: 'deficiency.problem.document_expired',
          },
        ],
      }),
    ),
    openItemised: jest.fn((appId: string) =>
      Promise.resolve({
        app: { id: appId },
        deficiencyId: appId === id(4) ? null : `def-${appId}`,
      }),
    ),
    recheck: jest.fn(() =>
      Promise.resolve({
        checks_run: [{ item_id: 'i1', outcome: 'PASS', check: 'DOCUMENT_VALIDITY', slot: 's' }],
        checks_skipped: [{ check: 'QUALITY_GATE', slot: 't', reason: 'NO_CHANGED_INPUT' }],
        items: [
          {
            id: 'i1',
            status: 'RESOLVED',
            problem_code: 'deficiency.problem.document_expired',
            previous_problem_code: null,
          },
        ],
      }),
    ),
  };
  const svc = new BulkActionsService(
    db,
    { act } as unknown as WorkflowService,
    { runForApplication, holdingFlags } as unknown as FraudDetectionService,
    deficiencies as unknown as DeficienciesService,
    { info: jest.fn() } as never,
  );
  return { svc, act, runForApplication, deficiencies, settings };
}
const ids = [1, 2, 3, 4, 5].map(id);

describe('BulkActionsService (Phase 13B)', () => {
  it('reports every item; only the eligible one changes', async () => {
    const { svc, act, settings } = setup();
    const r = await svc.run(INO, { action: 'VERIFY', application_ids: ids });
    expect(
      r.items.map((i) => [i.application_no ?? i.application_id, i.outcome, i.skip_reason]),
    ).toEqual([
      ['A1', 'CHANGED', undefined],
      ['A2', 'SKIPPED', 'HELD_BY_FRAUD_REVIEW'],
      ['A3', 'SKIPPED', 'WRONG_STAGE_FOR_ROLE'],
      ['A4', 'SKIPPED', 'NEEDS_INDIVIDUAL_ELIGIBILITY_REVIEW'],
      [id(5), 'SKIPPED', 'NOT_FOUND_OR_OUT_OF_SCOPE'],
    ]);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(INO, id(1), 'verify', { remarks: undefined });
    expect(r).toMatchObject({ requested: 5, changed: 1, skipped: 4 });
    // Phase 17 (F4): the batch id is set before the items run, and cleared after.
    expect(settings).toEqual([[r.batch_id], []]);
  });

  it('dry run writes nothing and runs no detection', async () => {
    const { svc, act, runForApplication, settings } = setup();
    const r = await svc.run(INO, { action: 'VERIFY', application_ids: ids, dry_run: true });
    expect(act).not.toHaveBeenCalled();
    expect(runForApplication).not.toHaveBeenCalled();
    expect(settings).toEqual([]); // nothing written, no batch id set
    expect(r.items[0].outcome).toBe('WOULD_CHANGE');
    expect(r).toMatchObject({ would_change: 1, changed: 0, skipped: 4 });
  });

  it('MARK_DEFECTIVE needs one shared reason and a deficiency', async () => {
    const { svc, act } = setup();
    await expect(
      svc.run(INO, { action: 'MARK_DEFECTIVE', application_ids: [id(1)] }),
    ).rejects.toMatchObject({ code: ErrorCode.REASON_REQUIRED });
    const deficiency = { code: 'DEF_X', title: 'x', description: 'y' };
    await svc.run(INO, {
      action: 'MARK_DEFECTIVE',
      application_ids: [id(1), id(4)],
      reason: '  Same expired certificate on both.  ',
      deficiency,
    });
    // An eligibility review does not block marking defective.
    expect(act).toHaveBeenCalledTimes(2);
    expect(act).toHaveBeenLastCalledWith(INO, id(4), 'mark_defective', {
      remarks: 'Same expired certificate on both.',
      deficiency,
    });
  });

  it('rolls the whole batch back (error names the item) if one change fails', async () => {
    const { svc } = setup(() => Promise.reject(new AppError(ErrorCode.CONFLICT)));
    const err = await svc
      .run(INO, { action: 'VERIFY', application_ids: ids })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).details).toMatchObject({
      reason: 'bulk_item_failed',
      application_id: id(1),
      committed: 0,
    });
  });

  describe('Phase 13C deficiency actions', () => {
    const item = {
      check_code: 'DOCUMENT_VALIDITY' as const,
      document_type: 'INCOME_CERTIFICATE' as const,
    };

    it('ISSUE_DEFICIENCY needs a reason and an item', async () => {
      const { svc } = setup();
      await expect(
        svc.run(INO, { action: 'ISSUE_DEFICIENCY', application_ids: ids, deficiency_item: item }),
      ).rejects.toMatchObject({ code: ErrorCode.REASON_REQUIRED });
      await expect(
        svc.run(INO, {
          action: 'ISSUE_DEFICIENCY',
          application_ids: ids,
          reason: 'Certificates older than a year.',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('ISSUE_DEFICIENCY issues the same item per application; held, out-of-scope and wrong-stage items are skipped', async () => {
      const { svc, deficiencies } = setup();
      const r = await svc.run(INO, {
        action: 'ISSUE_DEFICIENCY',
        application_ids: ids,
        reason: 'Certificates older than a year.',
        deficiency_item: item,
      });
      const by = Object.fromEntries(r.items.map((i) => [i.application_id, i]));
      expect(by[id(1)]).toMatchObject({
        outcome: 'CHANGED',
        document_slot: 'Family Income Certificate',
        deficiency_id: `def-${id(1)}`,
      });
      expect(by[id(2)]).toMatchObject({ outcome: 'SKIPPED', skip_reason: 'HELD_BY_FRAUD_REVIEW' });
      expect(by[id(3)]).toMatchObject({ outcome: 'SKIPPED', skip_reason: 'WRONG_STAGE_FOR_ROLE' });
      expect(by[id(4)]).toMatchObject({ outcome: 'CHANGED' });
      expect(by[id(5)]).toMatchObject({
        outcome: 'SKIPPED',
        skip_reason: 'NOT_FOUND_OR_OUT_OF_SCOPE',
      });
      expect(deficiencies.issue).toHaveBeenCalledTimes(2);
      expect(deficiencies.issue.mock.calls[0][2]).toMatchObject({
        include_failed_checks: false,
        items: [{ document_slot: 'Family Income Certificate', check_code: 'DOCUMENT_VALIDITY' }],
      });
    });

    it('ISSUE_DEFICIENCY dry run writes nothing', async () => {
      const { svc, deficiencies } = setup();
      const r = await svc.run(INO, {
        action: 'ISSUE_DEFICIENCY',
        application_ids: ids,
        reason: 'Certificates older than a year.',
        deficiency_item: item,
        dry_run: true,
      });
      expect(deficiencies.issue).not.toHaveBeenCalled();
      expect(r.would_change).toBe(2);
    });

    it('RESOLVE_DEFICIENCY rechecks DEFECTIVE applications with an open itemised deficiency only', async () => {
      const defective = APPS.map((a) => ({ ...a, current_stage: 'DEFECTIVE' }));
      defective[2] = { ...defective[2], current_stage: 'DNO_VERIFIED' };
      const { svc, deficiencies } = setup(undefined, defective);
      const r = await svc.run(INO, { action: 'RESOLVE_DEFICIENCY', application_ids: ids });
      const by = Object.fromEntries(r.items.map((i) => [i.application_id, i]));
      expect(by[id(1)]).toMatchObject({ outcome: 'CHANGED', checks_run: 1, checks_skipped: 1 });
      expect(by[id(2)]).toMatchObject({ skip_reason: 'HELD_BY_FRAUD_REVIEW' });
      expect(by[id(3)]).toMatchObject({ skip_reason: 'NOT_DEFECTIVE' });
      expect(by[id(4)]).toMatchObject({ skip_reason: 'NO_OPEN_ITEMISED_DEFICIENCY' });
      expect(by[id(5)]).toMatchObject({ skip_reason: 'NOT_FOUND_OR_OUT_OF_SCOPE' });
      expect(deficiencies.recheck).toHaveBeenCalledWith({ id: id(1) }, `def-${id(1)}`, true);
    });
  });
});
