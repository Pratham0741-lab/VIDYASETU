import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { checkRow } from '../audit/audit-chain';
import { prismaAuditSource } from '../audit/audit-source';
import { requireReason } from '../common/reason';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { EligibilityService } from '../schemes/eligibility.service';
import { StorageService } from '../storage/storage.service';
import { canonicalJson, contentHash } from './canonical';
import { computeEntitlement } from './entitlement';
import { objectionWindowClosesAt } from './policies';
import { listForRun } from '../selection-lists/list-lookup';
import {
  AuditChainRef,
  qrPayload,
  renderSanctionOrderPdf,
  SanctionOrderContent,
} from './sanction-order.pdf';

export const SANCTION_ORDER_FORMAT = 'vidyasetu-sanction-order/v1';

const SELECTION_SELECT = {
  id: true,
  application_id: true,
  selection_run_id: true,
  selection_status: true,
  selection_basis: true,
  merit_rank: true,
  vertical_category: true,
  is_female_reserved: true,
  is_pwd_reserved: true,
  academic_year: true,
  created_at: true,
  confirmed_at: true,
  confirmed_by_officer_id: true,
  objection_window_overridden: true,
  override_reason: true,
} satisfies Prisma.SelectionSelect;

function requireOfficer(actor: Actor): string {
  if (!actor.officerId) {
    throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
  }
  return actor.officerId;
}

/**
 * Selection confirmation and sanction orders. Every read and write goes
 * through DbContext (the request's Phase 2 actor transaction): RLS and the
 * jurisdiction scope apply, and every write is audited with the officer.
 */
@Injectable()
export class SanctionService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    private readonly eligibility: EligibilityService,
    private readonly storage: StorageService,
  ) {}

  private async loadSelection(id: string) {
    const s = await this.db.client.selection.findFirst({ where: { id }, select: SELECTION_SELECT });
    if (!s) throw new AppError(ErrorCode.NOT_FOUND);
    return s;
  }

  /**
   * PROVISIONAL -> CONFIRMED (MINISTRY_OFFICER). Refused while the objection
   * window (OBJECTION_WINDOW_DAYS after the run) is open, unless the officer
   * overrides it with a reason - recorded on the row and so in the audit log.
   */
  async confirm(actor: Actor, selectionId: string, overrideReason: string | undefined) {
    const officerId = requireOfficer(actor);
    const s = await this.loadSelection(selectionId);
    // Phase 13E: a run with a selection list is confirmed only from its
    // published final list, and only for rows the final list selected.
    const list = await listForRun(this.db.client, s.selection_run_id);
    if (list) {
      if (list.status !== 'FINAL_PUBLISHED') {
        throw new AppError(ErrorCode.CONFLICT, {
          message: 'This selection belongs to a list whose final version is not published yet.',
          details: { reason: 'final_list_not_published', list_status: list.status },
        });
      }
      const entry = await this.db.client.selectionListEntry.findFirst({
        where: { selection_list_id: list.id, application_id: s.application_id },
        select: { final_outcome: true },
      });
      if (entry?.final_outcome !== 'SELECTED') {
        throw new AppError(ErrorCode.CONFLICT, {
          details: {
            reason: 'not_selected_in_final_list',
            final_outcome: entry?.final_outcome ?? null,
          },
        });
      }
    }
    if (s.selection_status !== 'PROVISIONAL') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `Only a PROVISIONAL selection can be confirmed (this one is ${s.selection_status}).`,
        details: { reason: 'not_provisional', selection_status: s.selection_status },
      });
    }
    const now = new Date();
    const closesAt = objectionWindowClosesAt(
      s.created_at,
      this.config.postSelection.objectionWindowDays,
    );
    const windowOpen = now < closesAt;
    const openObjections = await this.db.client.grievance.count({
      where: {
        subject_type: 'SELECTION_OBJECTION',
        selection_run_id: s.selection_run_id,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    });
    let reason = overrideReason?.trim();
    if (windowOpen && !reason) {
      throw new AppError(ErrorCode.CONFLICT, {
        message:
          'The objection window for this selection run is still open. Confirm after it closes, or override it with a reason.',
        details: {
          reason: 'objection_window_open',
          window_closes_at: closesAt.toISOString(),
          objection_window_days: this.config.postSelection.objectionWindowDays,
          open_objections_for_run: openObjections,
        },
      });
    }

    // Phase 13C (M34): an override reason, like every other decision reason,
    // is at least REASON_MIN_LENGTH trimmed characters.
    if (windowOpen) reason = requireReason(reason, 'override_reason', 1000);

    const updated = await this.db.client.selection.updateMany({
      where: { id: s.id, selection_status: 'PROVISIONAL' },
      data: {
        selection_status: 'CONFIRMED',
        confirmed_at: now,
        confirmed_by_officer_id: officerId,
        objection_window_overridden: windowOpen,
        override_reason: windowOpen ? reason! : null,
      },
    });
    if (updated.count !== 1) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'selection_changed' } });
    }
    return {
      selection: await this.loadSelection(s.id),
      objection_window: {
        closes_at: closesAt.toISOString(),
        was_open: windowOpen,
        overridden: windowOpen,
        open_objections_for_run: openObjections,
      },
    };
  }

  /** CONFIRMED selections only. One order per selection. */
  async generate(actor: Actor, selectionId: string) {
    const officerId = requireOfficer(actor);
    const s = await this.loadSelection(selectionId);
    if (s.selection_status !== 'CONFIRMED') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `A sanction order is issued only for a CONFIRMED selection (this one is ${s.selection_status}).`,
        details: { reason: 'selection_not_confirmed', selection_status: s.selection_status },
      });
    }
    const existing = await this.db.client.sanctionOrder.findFirst({
      where: { selection_id: s.id },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'sanction_order_exists', sanction_order_id: existing.id },
      });
    }

    const app = await this.db.client.application.findFirst({
      where: { id: s.application_id },
      select: {
        id: true,
        application_no: true,
        applicant_id: true,
        academic_year: true,
        scheme_version: {
          select: {
            id: true,
            version_no: true,
            config: true,
            scheme: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    const person = await this.db.client.applicant.findUnique({
      where: { id: app.applicant_id },
      select: { first_name: true, last_name: true },
    });
    // The recorded profile exactly as Phase 3 builds it (no declared inputs:
    // a condition needing one is reported, never assumed).
    const prepared = await this.eligibility.prepareApplicationEvaluation(app.id, {});
    const ent = computeEntitlement(app.scheme_version.config, prepared.profile);

    const id = randomUUID();
    const now = new Date();
    const content: SanctionOrderContent = {
      format: SANCTION_ORDER_FORMAT,
      sanction_order_id: id,
      sanction_date: now.toISOString().slice(0, 10),
      selection_id: s.id,
      selection_run_id: s.selection_run_id,
      application_id: app.id,
      application_no: app.application_no,
      applicant_name: `${person?.first_name ?? ''} ${person?.last_name ?? ''}`.trim(),
      scheme_code: app.scheme_version.scheme.code,
      scheme_name: app.scheme_version.scheme.name,
      scheme_version_id: app.scheme_version.id,
      scheme_version_no: app.scheme_version.version_no,
      academic_year: app.academic_year,
      vertical_category: s.vertical_category,
      horizontal_reservation: s.is_female_reserved ? 'FEMALE' : s.is_pwd_reserved ? 'PWD' : null,
      merit_rank: s.merit_rank,
      selection_basis: s.selection_basis,
      annual_entitlement: ent.instalments.map((i) => ({
        currency: i.currency,
        beneficiary_type: i.beneficiary_type,
        payment_mode: i.payment_mode,
        amount: i.amount,
        lines: i.lines.map((l) => ({
          benefit_id: l.benefit_id,
          amount_annual: l.amount_annual,
          currency: l.currency,
        })),
      })),
      unschedulable_benefits: ent.unschedulable,
      not_applicable_benefits: ent.not_applicable,
      issued_by_officer_id: officerId,
    };
    const hash = contentHash(content);
    const key = `sanction-orders/${app.id}/${id}.pdf`;

    // Phase 14 loose ends (D2): insert first, so the audit trigger writes
    // the sanction event's chain record; the PDF then carries its seq and
    // record hash. If storing the PDF fails, the transaction (and so the
    // order and its audit record) rolls back.
    await this.db.client.sanctionOrder.create({
      data: {
        id,
        selection_id: s.id,
        application_id: app.id,
        content: JSON.parse(canonicalJson(content)) as Prisma.InputJsonObject,
        content_sha256: hash,
        pdf_storage_key: key,
        generated_by_officer_id: officerId,
        generated_at: now,
      },
    });
    const chain = await this.chainRecordOf(id);
    const pdf = await renderSanctionOrderPdf(content, hash, chain);
    await this.storage.put(this.storage.documentsBucket, key, pdf, 'application/pdf');
    return {
      sanction_order_id: id,
      content_sha256: hash,
      audit_chain: chain,
      qr_payload: qrPayload(id, hash, chain),
      pdf_storage_key: key,
      pdf_bytes: pdf.length,
      content,
    };
  }

  /** The audit-chain record of an order's creation (NULL for orders from before the chain). */
  private async chainRecordOf(orderId: string): Promise<AuditChainRef | null> {
    const rows = await this.db.client.$queryRaw<Array<{ seq: string | null; record_hash: string }>>`
      SELECT seq::text AS seq, record_hash FROM audit_logs
       WHERE table_name = 'sanction_orders' AND record_id = ${orderId}::uuid AND action = 'INSERT'
       ORDER BY seq NULLS FIRST LIMIT 1`;
    const r = rows[0];
    return r && r.seq !== null ? { seq: r.seq, record_hash: r.record_hash } : null;
  }

  async get(orderId: string) {
    const o = await this.db.client.sanctionOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        selection_id: true,
        application_id: true,
        content: true,
        content_sha256: true,
        generated_at: true,
        generated_by_officer_id: true,
        pdf_storage_key: true,
      },
    });
    if (!o) throw new AppError(ErrorCode.NOT_FOUND);
    return o;
  }

  async pdf(orderId: string): Promise<Buffer> {
    const o = await this.get(orderId);
    return this.storage.get(this.storage.documentsBucket, o.pdf_storage_key);
  }

  /**
   * Independent verification: recompute SHA-256 over the canonical JSON of
   * the supplied order data and compare with the hash stored for that order.
   *
   * Phase 14 loose ends (D2): with the audit-chain reference printed on the
   * PDF (seq + record hash), also check that the record exists, is the
   * INSERT of this order, carries this content hash, and verifies under the
   * audit verifier's own row check (sha256(hash_input) = record_hash, the
   * stored row still matches what was hashed, and prev_hash links to the
   * record before it). This proves the order data matches an audited
   * sanction event. It does not prove the rest of the chain after that
   * record is intact (run GET /audit/verify), that the PDF's printed text
   * was not altered around these values, or anything outside the database
   * (the chain is not anchored externally and there is no digital signature).
   */
  async verify(content: Record<string, unknown>, supplied?: AuditChainRef) {
    const orderId =
      typeof content.sanction_order_id === 'string' ? content.sanction_order_id : null;
    if (!orderId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'content.sanction_order_id', constraints: { required: 'required' } }],
      });
    }
    const stored = await this.get(orderId);
    const recomputed = contentHash(content);
    const match = recomputed === stored.content_sha256;
    const auditChain = await this.verifyChainRecord(orderId, recomputed, supplied);
    return {
      sanction_order_id: orderId,
      recomputed_sha256: recomputed,
      stored_sha256: stored.content_sha256,
      match,
      audit_chain: auditChain,
      verified: match && auditChain.verified,
      proves: auditChain.verified
        ? 'The supplied order data hashes to the stored content hash, and that hash was written by an audited INSERT of this order at the referenced chain record, which verifies and links to its predecessor.'
        : null,
      does_not_prove:
        'That the chain after this record is intact (GET /api/v1/audit/verify), that text printed around these values was not altered, or anything outside this database (no external anchor, no digital signature).',
    };
  }

  private async verifyChainRecord(orderId: string, contentSha: string, supplied?: AuditChainRef) {
    const actual = await this.chainRecordOf(orderId);
    if (!supplied) {
      return {
        supplied: null,
        record: actual,
        verified: false,
        reason: actual
          ? 'no audit chain reference supplied (it is printed on the PDF and in its QR code)'
          : 'this order predates chain references (no seq on its audit record)',
      };
    }
    const seq = /^[1-9][0-9]{0,18}$/.test(supplied.seq) ? BigInt(supplied.seq) : null;
    const rows =
      seq === null
        ? []
        : await prismaAuditSource(this.db.client).chainPage(
            String(seq > 1n ? seq - 2n : 0n),
            seq > 1n ? 2 : 1,
          );
    const row = rows.find((r) => r.seq === supplied.seq) ?? null;
    const prev =
      seq !== null && seq > 1n ? (rows.find((r) => r.seq === String(seq - 1n)) ?? null) : null;
    const checks = {
      record_exists: row !== null,
      is_this_orders_insert:
        row !== null &&
        row.table_name === 'sanction_orders' &&
        row.record_id === orderId &&
        row.action === 'INSERT',
      record_hash_matches_supplied: row !== null && row.record_hash === supplied.record_hash,
      audited_content_sha256_matches:
        row !== null &&
        (JSON.parse(row.row_data) as { content_sha256?: unknown }).content_sha256 === contentSha,
      record_verifies:
        row !== null && seq !== null && checkRow(row, seq, prev?.record_hash ?? null) === null,
    };
    const brk = row !== null && seq !== null ? checkRow(row, seq, prev?.record_hash ?? null) : null;
    return {
      supplied,
      record: row ? { seq: row.seq, record_hash: row.record_hash, prev_hash: row.prev_hash } : null,
      checks,
      record_break: brk ? { kind: brk.kind, detail: brk.detail } : null,
      verified: Object.values(checks).every(Boolean),
    };
  }
}
