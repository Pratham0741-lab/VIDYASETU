import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { PfmsAdapter } from '../integrations/pfms/pfms.adapter';
import { T } from '../workflow/vidyasetu-workflow';
import { WorkflowService } from '../workflow/workflow.service';
import { readReleaseSchedule, splitAnnualAmount } from './entitlement';
import type { SanctionOrderContent } from './sanction-order.pdf';

const DISBURSEMENT_SELECT = {
  id: true,
  application_id: true,
  selection_id: true,
  sanction_order_id: true,
  installment_no: true,
  academic_year: true,
  financial_year: true,
  component_type: true,
  amount: true,
  currency: true,
  beneficiary_type: true,
  payment_mode: true,
  scheduled_date: true,
  benefit_lines: true,
  status: true,
  transaction_reference: true,
  utr_number: true,
  disbursed_at: true,
  failure_reason: true,
  initiated_by_officer_id: true,
  reconciled_by_officer_id: true,
  reconciled_at: true,
} satisfies Prisma.DisbursementSelect;

function requireOfficer(actor: Actor): string {
  if (!actor.officerId) {
    throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
  }
  return actor.officerId;
}

/**
 * Disbursement schedule and PFMS reconciliation.
 *
 * No bank-account reference of any kind is stored on disbursements
 * (bank_account is on Phase 3's sensitive list; even a masked or partial
 * reference is derived from it). Correlating a disbursement with a specific
 * bank account requires separately decrypting the Applicant row through the
 * existing PII extension - a deliberate consequence of the redaction
 * policy, not an oversight.
 */
@Injectable()
export class DisbursementService {
  constructor(
    private readonly db: DbContext,
    private readonly pfms: PfmsAdapter,
    private readonly workflow: WorkflowService,
  ) {}

  /**
   * Instalment 1 (the sanctioned academic year) from the sanction order's
   * content - exactly what was sanctioned, one row per currency and
   * beneficiary channel. Lines that could not be scheduled are reported.
   */
  async createSchedule(actor: Actor, selectionId: string) {
    requireOfficer(actor);
    const client = this.db.client;
    const selection = await client.selection.findFirst({
      where: { id: selectionId },
      select: {
        id: true,
        application_id: true,
        selection_status: true,
        academic_year: true,
        application: {
          select: {
            scheme: { select: { disbursement_mode: true } },
            scheme_version: { select: { config: true } },
          },
        },
      },
    });
    if (!selection) throw new AppError(ErrorCode.NOT_FOUND);
    if (selection.selection_status !== 'CONFIRMED') {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'selection_not_confirmed' } });
    }
    // Phase 12 (M16, D2): the State pays these students by DBT. Nothing is
    // scheduled here and nothing is an error: the selection stands.
    if (selection.application.scheme.disbursement_mode === 'FORWARDED_TO_STATE') {
      return {
        selection_id: selection.id,
        disbursement_mode: 'FORWARDED_TO_STATE',
        disbursement_status: 'HANDLED_BY_STATE_DBT',
        message: 'Selected; disbursement is handled by the State through DBT.',
        instalments: [],
      };
    }
    const order = await client.sanctionOrder.findFirst({
      where: { selection_id: selection.id },
      select: { id: true, content: true, content_sha256: true },
    });
    if (!order) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Generate the sanction order before scheduling disbursements.',
        details: { reason: 'no_sanction_order' },
      });
    }
    const existing = await client.disbursement.count({ where: { selection_id: selection.id } });
    if (existing > 0) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'schedule_exists', instalments: existing },
      });
    }

    const content = order.content as unknown as SanctionOrderContent;
    // The frozen version's release cadence (Phase 12, M16 D1): QUARTERLY
    // splits each sanctioned annual amount into four equal instalments,
    // three months apart from the sanction date; otherwise one, as before.
    const release = readReleaseSchedule(selection.application.scheme_version.config);
    const sanctioned = new Date(`${content.sanction_date}T00:00:00.000Z`);
    for (const e of content.annual_entitlement) {
      const parts = splitAnnualAmount(e.amount, release.instalments_per_year);
      for (const [k, amount] of parts.entries()) {
        const due = new Date(sanctioned);
        due.setUTCMonth(due.getUTCMonth() + k * (12 / release.instalments_per_year));
        await client.disbursement.create({
          data: {
            application_id: selection.application_id,
            selection_id: selection.id,
            sanction_order_id: order.id,
            installment_no: k + 1,
            academic_year: content.academic_year,
            financial_year: content.academic_year,
            component_type:
              release.cadence === 'QUARTERLY' ? 'QUARTERLY_ENTITLEMENT' : 'ANNUAL_ENTITLEMENT',
            amount,
            currency: e.currency,
            beneficiary_type: e.beneficiary_type,
            payment_mode: e.payment_mode,
            scheduled_date: due,
            benefit_lines: e.lines,
          },
        });
      }
    }
    return {
      selection_id: selection.id,
      sanction_order_id: order.id,
      sanction_order_sha256: order.content_sha256,
      disbursement_mode: 'SCHEDULED_BY_PLATFORM',
      release_cadence: release.cadence,
      rates_status: release.rates_status,
      scheduled_date_basis:
        release.cadence === 'QUARTERLY'
          ? 'sanction date, then every three months (the scheme releases quarterly)'
          : 'sanction date (the scheme data defines no release calendar)',
      instalments: await this.list(selection.application_id),
      unschedulable_benefits: content.unschedulable_benefits,
      not_applicable_benefits: content.not_applicable_benefits,
    };
  }

  async list(applicationId: string) {
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    return this.db.client.disbursement.findMany({
      where: { application_id: app.id },
      select: DISBURSEMENT_SELECT,
      orderBy: [{ installment_no: 'asc' }, { currency: 'asc' }, { beneficiary_type: 'asc' }],
    });
  }

  private async load(id: string) {
    const d = await this.db.client.disbursement.findFirst({
      where: { id },
      select: DISBURSEMENT_SELECT,
    });
    if (!d) throw new AppError(ErrorCode.NOT_FOUND);
    return d;
  }

  /** PENDING -> PROCESSING: submitted to the PFMS stand-in. */
  async initiate(actor: Actor, id: string) {
    const officerId = requireOfficer(actor);
    const d = await this.load(id);
    if (d.status !== 'PENDING') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'not_pending', status: d.status },
      });
    }
    const app = await this.db.client.application.findFirst({
      where: { id: d.application_id },
      select: { application_no: true },
    });
    const { reference } = await this.pfms.initiateDisbursement({
      disbursement_id: d.id,
      application_no: app!.application_no,
      amount: d.amount,
      currency: d.currency,
      beneficiary_type: d.beneficiary_type,
      payment_mode: d.payment_mode,
    });
    await this.db.client.disbursement.update({
      where: { id: d.id },
      data: {
        status: 'PROCESSING',
        transaction_reference: reference,
        initiated_by_officer_id: officerId,
      },
    });
    return this.load(d.id);
  }

  /**
   * A MINISTRY_OFFICER reconciles the PFMS status callback. When the first
   * instalment succeeds, the application moves MINISTRY_APPROVED -> DISBURSED
   * through Phase 4's workflow engine as that officer (WorkflowService.act:
   * graph check, workflow_transitions + decision_records rows, event) -
   * never by writing current_stage directly.
   */
  async reconcile(actor: Actor, id: string) {
    const officerId = requireOfficer(actor);
    const d = await this.load(id);
    if (d.status !== 'PROCESSING' || !d.transaction_reference) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'not_processing', status: d.status },
      });
    }
    const callback = await this.pfms.checkStatus(d.transaction_reference);
    if (callback.status === 'PROCESSING') {
      return { disbursement: d, pfms_callback: callback, workflow: null };
    }
    const now = new Date();
    await this.db.client.disbursement.update({
      where: { id: d.id },
      data:
        callback.status === 'SUCCESS'
          ? {
              status: 'SUCCESS',
              utr_number: callback.utr_number,
              disbursed_at: now,
              reconciled_by_officer_id: officerId,
              reconciled_at: now,
            }
          : {
              status: 'FAILED',
              failure_reason: callback.failure_reason,
              reconciled_by_officer_id: officerId,
              reconciled_at: now,
            },
    });

    let workflow: unknown = null;
    if (callback.status === 'SUCCESS' && d.installment_no === 1) {
      const app = await this.db.client.application.findFirst({
        where: { id: d.application_id },
        select: { current_stage: true },
      });
      if (app?.current_stage === 'MINISTRY_APPROVED') {
        const result = await this.workflow.act(actor, d.application_id, T.DISBURSE, {
          remarks: `First instalment reconciled: PFMS ${callback.reference}, UTR ${callback.utr_number}`,
        });
        workflow = { transition: result.transition, decision_record_id: result.decision_record_id };
      }
    }
    return { disbursement: await this.load(d.id), pfms_callback: callback, workflow };
  }
}
