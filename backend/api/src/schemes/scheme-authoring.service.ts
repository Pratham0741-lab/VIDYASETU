import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { diffConfigs } from './config-diff';
import { assertValidSchemeConfig, KNOWN_WORKFLOWS } from './config-validation';
import { evaluateScheme } from './eligibility-engine';
import { deriveFormSchema } from './form-schema';
import { sanitizeProfile } from './profile';
import type {
  CreateDraftDto,
  CreateSchemeDto,
  PublishVersionDto,
  UpdateDraftDto,
} from './scheme-authoring.dto';

const SCHEME_SELECT = {
  id: true,
  code: true,
  name: true,
  department: true,
  description: true,
  type: true,
  portal_url: true,
  is_active: true,
  disbursement_mode: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.SchemeSelect;

const VERSION_SUMMARY = {
  id: true,
  version_no: true,
  status: true,
  effective_from: true,
  effective_to: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.SchemeVersionSelect;

const VERSION_FULL = {
  ...VERSION_SUMMARY,
  scheme_id: true,
  config: true,
  source_document: true,
  source_url: true,
  extraction_confidence: true,
  extraction_notes: true,
} satisfies Prisma.SchemeVersionSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The database's refusal (scheme_version_publication_lock) as the API's 409. */
function lockRefusal(err: unknown): never {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('SCHEME_VERSION_PUBLISHED')) {
    throw new AppError(ErrorCode.CONFLICT, {
      message: 'A published scheme version cannot be changed. Author a new version instead.',
      details: { reason: 'version_published', enforced_by: 'database' },
    });
  }
  throw err;
}

/**
 * Scheme authoring (Phase 14 loose ends, Part A; plan Phase 4): create a
 * scheme, draft a version, edit the draft, validate it, publish it, retire a
 * published version, and compare versions. Every write goes through the
 * request's actor transaction, so each one lands in the audit chain with the
 * officer who made it (schemes and scheme_versions are both audited).
 *
 * A published version is never edited: the API refuses (409) and so does the
 * database (scheme_version_publication_lock), and a change becomes a new
 * version. Applications stay pinned to the version they were created on
 * (trigger_prevent_scheme_version_change); publishing a newer version only
 * retires the old one for NEW applications.
 */
@Injectable()
export class SchemeAuthoringService {
  constructor(
    private readonly db: DbContext,
    @InjectPinoLogger(SchemeAuthoringService.name) private readonly logger: PinoLogger,
  ) {}

  async list() {
    const schemes = await this.db.client.scheme.findMany({
      select: {
        ...SCHEME_SELECT,
        versions: { select: VERSION_SUMMARY, orderBy: { version_no: 'asc' } },
      },
      orderBy: { code: 'asc' },
    });
    return { known_workflows: KNOWN_WORKFLOWS, schemes };
  }

  private async scheme(code: string) {
    const s = await this.db.client.scheme.findUnique({ where: { code }, select: SCHEME_SELECT });
    if (!s) throw new AppError(ErrorCode.NOT_FOUND);
    return s;
  }

  private async version(code: string, versionNo: number) {
    const v = await this.db.client.schemeVersion.findFirst({
      where: { version_no: versionNo, scheme: { code } },
      select: VERSION_FULL,
    });
    if (!v) throw new AppError(ErrorCode.NOT_FOUND);
    return v;
  }

  async getVersion(code: string, versionNo: number) {
    const [scheme, version] = await Promise.all([this.scheme(code), this.version(code, versionNo)]);
    return { scheme, version, editable: version.status === 'draft' };
  }

  async createScheme(dto: CreateSchemeDto) {
    try {
      const s = await this.db.client.scheme.create({
        data: {
          code: dto.code,
          name: dto.name,
          department: dto.department,
          description: dto.description ?? null,
          type: dto.type,
          portal_url: dto.portal_url ?? null,
          disbursement_mode: dto.disbursement_mode ?? 'SCHEDULED_BY_PLATFORM',
        },
        select: SCHEME_SELECT,
      });
      this.logger.info({ schemeId: s.id, code: s.code }, 'scheme created');
      return s;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'scheme_code_exists' } });
      }
      throw err;
    }
  }

  async createDraft(code: string, dto: CreateDraftDto) {
    const scheme = await this.scheme(code);
    let config: unknown = dto.config;
    if (config === undefined) {
      if (dto.based_on_version === undefined) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          details: [
            {
              field: 'config',
              constraints: { required: 'give a config, or based_on_version to copy one' },
            },
          ],
        });
      }
      config = (await this.version(code, dto.based_on_version)).config;
    }
    assertValidSchemeConfig(config);
    const last = await this.db.client.schemeVersion.aggregate({
      where: { scheme_id: scheme.id },
      _max: { version_no: true },
    });
    const versionNo = (last._max.version_no ?? 0) + 1;
    try {
      const v = await this.db.client.schemeVersion.create({
        data: {
          scheme_id: scheme.id,
          version_no: versionNo,
          status: 'draft',
          // Set for real at publication; NOT NULL in the table.
          effective_from: today(),
          config: config as Prisma.InputJsonObject,
          source_document: dto.source_document ?? null,
          source_url: dto.source_url ?? null,
          extraction_notes: dto.extraction_notes ?? null,
        },
        select: VERSION_FULL,
      });
      this.logger.info(
        { schemeVersionId: v.id, code, versionNo, basedOn: dto.based_on_version ?? null },
        'scheme version drafted',
      );
      return v;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'version_number_taken' } });
      }
      throw err;
    }
  }

  private refuseUnlessDraft(v: { status: string; version_no: number }) {
    if (v.status !== 'draft') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `Version ${v.version_no} is ${v.status}: a published version is never edited. Author a new version instead.`,
        details: { reason: 'version_published', status: v.status, enforced_by: 'api' },
      });
    }
  }

  async updateDraft(code: string, versionNo: number, dto: UpdateDraftDto) {
    const v = await this.version(code, versionNo);
    this.refuseUnlessDraft(v);
    if (dto.config !== undefined) assertValidSchemeConfig(dto.config);
    const updated = await this.db.client.schemeVersion
      .update({
        where: { id: v.id },
        data: {
          ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonObject } : {}),
          ...(dto.source_document !== undefined ? { source_document: dto.source_document } : {}),
          ...(dto.source_url !== undefined ? { source_url: dto.source_url } : {}),
          ...(dto.extraction_notes !== undefined ? { extraction_notes: dto.extraction_notes } : {}),
        },
        select: VERSION_FULL,
      })
      .catch(lockRefusal);
    this.logger.info({ schemeVersionId: v.id, code, versionNo }, 'scheme draft edited');
    return updated;
  }

  /** Validates the stored config: 200 with a summary, or the standard 400 with every issue. */
  async validate(code: string, versionNo: number) {
    const v = await this.version(code, versionNo);
    assertValidSchemeConfig(v.config);
    const form = deriveFormSchema(v.config);
    const rules = (v.config as { rules: Array<{ type: string }> }).rules;
    return {
      scheme_code: code,
      version_no: v.version_no,
      status: v.status,
      valid: true,
      rules_by_type: rules.reduce<Record<string, number>>((t, r) => {
        t[r.type] = (t[r.type] ?? 0) + 1;
        return t;
      }, {}),
      form_fields: form.fields.map((f) => f.key),
      document_checklist: form.documents.checklist,
      workflow: (v.config as { workflow?: string }).workflow ?? `${KNOWN_WORKFLOWS[0]} (default)`,
    };
  }

  /** Any version, drafts included: evaluate a profile and derive the form (nothing stored). */
  async preview(code: string, versionNo: number, applicantInput: unknown) {
    const v = await this.version(code, versionNo);
    const profile = sanitizeProfile(applicantInput);
    const evaluation = evaluateScheme(v.config, profile);
    return {
      scheme_code: code,
      version_no: v.version_no,
      status: v.status,
      stored: false,
      outcome: evaluation.outcome,
      eligible: evaluation.eligible,
      rules: evaluation.rules.map((r) => ({
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        verdict: r.verdict,
        value: r.value,
        message_key: r.message_key,
        explanation: r.explanation,
      })),
      form_schema: deriveFormSchema(v.config),
    };
  }

  async publish(code: string, versionNo: number, dto: PublishVersionDto) {
    const scheme = await this.scheme(code);
    const v = await this.version(code, versionNo);
    this.refuseUnlessDraft(v);
    assertValidSchemeConfig(v.config);
    const from = dto.effective_from ? new Date(`${dto.effective_from}T00:00:00.000Z`) : today();
    if (Number.isNaN(from.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'effective_from', constraints: { isDate: 'not a calendar date' } }],
      });
    }
    // The version it supersedes (if any) is retired the day before: its
    // applications keep it (they are pinned), new applications get this one.
    const active = await this.db.client.schemeVersion.findMany({
      where: { scheme_id: scheme.id, status: 'active' },
      select: { id: true, version_no: true, effective_from: true },
    });
    const clash = active.find((a) => a.effective_from.getTime() >= from.getTime());
    if (clash) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `Version ${clash.version_no} is effective from ${isoDate(clash.effective_from)}; publish this one from a later date.`,
        details: {
          reason: 'effective_from_not_after_active_version',
          active_version: clash.version_no,
        },
      });
    }
    const superseded = new Date(from.getTime() - DAY_MS);
    for (const a of active) {
      await this.db.client.schemeVersion.update({
        where: { id: a.id },
        data: { status: 'archived', effective_to: superseded },
      });
    }
    const published = await this.db.client.schemeVersion
      .update({
        where: { id: v.id },
        data: { status: 'active', effective_from: from, effective_to: null },
        select: VERSION_FULL,
      })
      .catch(lockRefusal);
    this.logger.info(
      {
        schemeVersionId: v.id,
        code,
        versionNo,
        supersededVersions: active.map((a) => a.version_no),
      },
      'scheme version published',
    );
    return {
      version: published,
      superseded: active.map((a) => ({
        version_no: a.version_no,
        status: 'archived',
        effective_to: isoDate(superseded),
      })),
    };
  }

  /** active -> archived from today: no new applications; existing ones keep it. */
  async retire(code: string, versionNo: number) {
    const v = await this.version(code, versionNo);
    if (v.status !== 'active') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'version_not_active', status: v.status },
      });
    }
    const end = today();
    const retired = await this.db.client.schemeVersion.update({
      where: { id: v.id },
      data: {
        status: 'archived',
        effective_to: v.effective_from.getTime() > end.getTime() ? v.effective_from : end,
      },
      select: VERSION_FULL,
    });
    this.logger.info({ schemeVersionId: v.id, code, versionNo }, 'scheme version retired');
    return retired;
  }

  async diff(code: string, fromNo: number, toNo: number) {
    const [a, b] = await Promise.all([this.version(code, fromNo), this.version(code, toNo)]);
    const changes = diffConfigs(a.config, b.config);
    return {
      scheme_code: code,
      from: { version_no: a.version_no, status: a.status },
      to: { version_no: b.version_no, status: b.status },
      change_count: changes.length,
      changes,
    };
  }
}
