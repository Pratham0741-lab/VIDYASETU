import type { ModuleRef } from '@nestjs/core';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { T } from './vidyasetu-workflow';
import { WorkflowController } from './workflow.controller';
import type { WorkflowService } from './workflow.service';
import type { SlaSweepService } from './sla-sweep.service';

const applicant = { accountId: 'a', role: AppRole.APPLICANT, officerId: null } as unknown as Actor;
const APP = '00000000-0000-4000-8000-000000000001';

function setup(deficiencyId: string | null) {
  const act = jest.fn(() => Promise.resolve({ transition: { to_stage: 'INO_VERIFIED' } }));
  const deficiencies = {
    openItemised: jest.fn(() => Promise.resolve({ app: { id: APP }, deficiencyId })),
    resubmit: jest.fn(() => Promise.resolve({ resubmitted: false, checks_run: [] })),
  };
  const moduleRef = { get: () => deficiencies } as unknown as ModuleRef;
  const controller = new WorkflowController(
    { act } as unknown as WorkflowService,
    moduleRef,
    {} as unknown as SlaSweepService,
  );
  return { controller, act, deficiencies };
}

describe('POST /applications/:id/resubmit (Phase 13D, M39)', () => {
  it('with an open itemised deficiency: the deficiency service decides (same as the new path)', async () => {
    const { controller, act, deficiencies } = setup('def-1');
    await controller.resubmit(applicant, APP, { declared: { x: 1 } });
    expect(deficiencies.resubmit).toHaveBeenCalledWith(applicant, APP, 'def-1', { x: 1 });
    expect(act).not.toHaveBeenCalled();
  });

  it('without open items: the original transition, unchanged', async () => {
    const { controller, act, deficiencies } = setup(null);
    await controller.resubmit(applicant, APP, { declared: { x: 1 } });
    expect(act).toHaveBeenCalledWith(applicant, APP, T.RESUBMIT, { declared: { x: 1 } });
    expect(deficiencies.resubmit).not.toHaveBeenCalled();
  });
});
