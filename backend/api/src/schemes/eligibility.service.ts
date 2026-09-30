import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { evaluateScheme, Outcome, RuleOutcome, VersionEvaluation } from './eligibility-engine';
import { deriveFormSchema, FormSchema } from './form-schema';
import { sanitizeProfile } from './profile';
import { REDACTION_POLICY, toPersisted } from './redaction';

/**
 * What happened to an evaluation's data at rest. The HTTP response always
 * carries the full, unredacted evaluation; this block states what was (or
 * was not) written to rule_evaluations.
 */
export interface StorageReport {
  persisted: boolean;
  reason: string;
  redaction_policy: string | null;
  /** Sensitive applicant.* paths whose values were withheld from storage. */
  redacted_fields: string[];
}

const ANONYMOUS_NOT_PERSISTED: StorageReport = {
  persisted: false,
  reason:
    'Anonymous evaluation: nothing is stored (no account, no consent, and audit_logs would make any stored copy permanent).',
  redaction_policy: null,
  redacted_fields: [],
};

const VERSION_SELECT = {
  id: true,
  version_no: true,
  status: true,
  effective_from: true,
  effective_to: true,
  config: true,
  scheme: { select: { id: true, code: true, name: true, is_active: true } },
} satisfies Prisma.SchemeVersionSelect;

type VersionRow = Prisma.SchemeVersionGetPayload<{ select: typeof VERSION_SELECT }>;

/** Profile keys taken from the applicant/application records, never from the caller. */
export const RECORDED_FIELDS = [
  'category',
  'pvtg_group',
  'gender',
  'is_disabled',
  'disability_percentage',
  'domicile_state',
  'domicile_district',
  'family_income_annual',
  'age',
  'academic_year_number',
  'institution_name',
  'institution_code',
  'course_name',
  'is_hosteller',
] as const;

export interface RuleResultView {
  rule_id: string;
  rule_type: string;
  verdict: RuleOutcome['verdict'];
  value: RuleOutcome['value'];
  message_key: string | null;
  explanation: string | null;
  decisive: RuleOutcome['decisive'];
}

export interface SchemeVersionResult {
  scheme_code: string;
  scheme_name: string;
  version_no: number;
  scheme_version_id: string;
  outcome: Outcome;
  eligible: boolean;
  failed_rules: Array<{ rule_id: string; message_key: string | null; explanation: string }>;
  error_rules: Array<{ rule_id: string; explanation: string }>;
  rules: RuleResultView[];
}

function view(rule: RuleOutcome): RuleResultView {
  return {
    rule_id: rule.rule_id,
    rule_type: rule.rule_type,
    verdict: rule.verdict,
    value: rule.value,
    message_key: rule.message_key,
    explanation: rule.explanation,
    decisive: rule.decisive,
  };
}

function summarize(version: VersionRow, evaluation: VersionEvaluation): SchemeVersionResult {
  return {
    scheme_code: version.scheme.code,
    scheme_name: version.scheme.name,
    version_no: version.version_no,
    scheme_version_id: version.id,
    outcome: evaluation.outcome,
    eligible: evaluation.eligible,
    failed_rules: evaluation.rules
      .filter((r) => r.verdict === 'FAIL')
      .map((r) => ({
        rule_id: r.rule_id,
        message_key: r.message_key,
        explanation: r.explanation!,
      })),
    error_rules: evaluation.rules
      .filter((r) => r.verdict === 'ERROR' && r.rule_type === 'eligibility')
      .map((r) => ({ rule_id: r.rule_id, explanation: r.explanation! })),
    rules: evaluation.rules.map(view),
  };
}

/** An application evaluated in memory, not yet persisted. */
export interface PreparedApplicationEvaluation {
  application_id: string;
  /**
   * The profile evaluated (recorded + declared). In memory only - it holds
   * decrypted values and is never persisted or returned by the API.
   */
  profile: Readonly<Record<string, unknown>>;
  version: VersionRow;
  evaluation: VersionEvaluation;
  evaluated_at: Date;
  recorded_keys: string[];
  declared_keys: string[];
}

/** The HTTP view of an application evaluation (full, unredacted). */
export function applicationEvaluationView(
  prepared: PreparedApplicationEvaluation,
  runId: string,
  storage: StorageReport,
) {
  return {
    evaluation_run_id: runId,
    storage,
    evaluated_at: prepared.evaluated_at.toISOString(),
    application_id: prepared.application_id,
    inputs: { recorded: prepared.recorded_keys, declared: prepared.declared_keys },
    ...summarize(prepared.version, prepared.evaluation),
  };
}

function wholeYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const beforeBirthday =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (beforeBirthday) years--;
  return years;
}

/**
 * Scheme-engine persistence and lookup. All queries go through DbContext:
 * inside an authenticated request that is the Phase 2 actor transaction
 * (so rule_evaluations rows and their audit entries carry the actor);
 * on public routes it is the base client with no actor.
 */
@Injectable()
export class EligibilityService {
  constructor(private readonly db: DbContext) {}

  /** Part 3: evaluate a submitted application against its frozen scheme version. */
  async evaluateApplication(applicationId: string, declaredInput: unknown) {
    const prepared = await this.prepareApplicationEvaluation(applicationId, declaredInput);
    const { runId, storage } = await this.persistApplicationEvaluation(prepared);
    return applicationEvaluationView(prepared, runId, storage);
  }

  /**
   * Reads the application and applicant (under the caller's visibility) and
   * evaluates, without writing anything. Split from persisting so the Phase 4
   * eligibility gate can read as the submitting applicant and write its
   * decision as the SYSTEM actor, in one transaction.
   */
  async prepareApplicationEvaluation(
    applicationId: string,
    declaredInput: unknown,
  ): Promise<PreparedApplicationEvaluation> {
    const declared = sanitizeProfile(declaredInput ?? {}, 'declared');
    const overridden = RECORDED_FIELDS.filter((key) =>
      Object.prototype.hasOwnProperty.call(declared, key),
    );
    if (overridden.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: overridden.map((key) => ({
          field: `declared.${key}`,
          constraints: {
            recordedField: `${key} comes from the application record and cannot be declared`,
          },
        })),
      });
    }

    const client = this.db.client;
    // Jurisdiction scope + RLS apply: invisible applications are simply not found.
    const application = await client.application.findFirst({
      where: { id: applicationId },
      select: {
        id: true,
        applicant_id: true,
        course_year: true,
        institution_name: true,
        institution_code: true,
        course_name: true,
        is_hosteller: true,
        scheme_version: { select: VERSION_SELECT },
      },
    });
    if (!application) throw new AppError(ErrorCode.NOT_FOUND);

    // Separate query (not an include) so the PII extension decrypts income.
    const applicant = await client.applicant.findUnique({
      where: { id: application.applicant_id },
      select: {
        category: true,
        pvtg_group: true,
        gender: true,
        is_disabled: true,
        disability_percentage: true,
        domicile_state: true,
        domicile_district: true,
        dob: true,
        income: true,
      },
    });
    if (!applicant) throw new AppError(ErrorCode.NOT_FOUND);

    const evaluatedAt = new Date();
    const recorded: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined) recorded[key] = value;
    };
    put('category', applicant.category);
    put('pvtg_group', applicant.pvtg_group);
    put('gender', applicant.gender);
    put('is_disabled', applicant.is_disabled);
    put('disability_percentage', applicant.disability_percentage);
    put('domicile_state', applicant.domicile_state);
    put('domicile_district', applicant.domicile_district);
    const income = Number(applicant.income);
    if (Number.isFinite(income)) put('family_income_annual', income);
    if (applicant.dob) put('age', wholeYearsBetween(applicant.dob, evaluatedAt));
    put('academic_year_number', application.course_year);
    put('institution_name', application.institution_name);
    put('institution_code', application.institution_code);
    put('course_name', application.course_name);
    put('is_hosteller', application.is_hosteller);

    const profile = Object.assign(
      Object.create(null) as Record<string, unknown>,
      declared,
      recorded,
    );
    const version = application.scheme_version;
    return {
      application_id: application.id,
      version,
      profile,
      evaluation: evaluateScheme(version.config, profile),
      evaluated_at: evaluatedAt,
      recorded_keys: Object.keys(recorded).sort(),
      declared_keys: Object.keys(declared).sort(),
    };
  }

  /** Writes a prepared evaluation (redacted) under the current transaction's actor. */
  async persistApplicationEvaluation(
    prepared: PreparedApplicationEvaluation,
  ): Promise<{ runId: string; storage: StorageReport }> {
    const runId = randomUUID();
    const storage = await this.persist(
      runId,
      [{ version: prepared.version, evaluation: prepared.evaluation }],
      prepared.application_id,
    );
    return { runId, storage };
  }

  /** Part 4: every currently active scheme version against a profile. */
  async checkAllActive(profileInput: unknown) {
    const profile = sanitizeProfile(profileInput);
    const today = new Date();
    const versions = await this.db.client.schemeVersion.findMany({
      where: {
        status: 'active',
        effective_from: { lte: today },
        OR: [{ effective_to: null }, { effective_to: { gte: today } }],
        scheme: { is_active: true },
      },
      select: VERSION_SELECT,
      orderBy: [{ scheme: { code: 'asc' } }, { version_no: 'desc' }],
    });

    const results = versions.map((version) => ({
      version,
      evaluation: evaluateScheme(version.config, profile),
    }));
    const summaries = results.map(({ version, evaluation }) => summarize(version, evaluation));
    const byFewestFailures = (a: SchemeVersionResult, b: SchemeVersionResult) =>
      a.failed_rules.length + a.error_rules.length - (b.failed_rules.length + b.error_rules.length);
    return {
      evaluation_run_id: null,
      storage: ANONYMOUS_NOT_PERSISTED,
      evaluated_at: today.toISOString(),
      schemes_evaluated: summaries.length,
      eligible: summaries.filter((s) => s.outcome === 'ELIGIBLE'),
      // Closest misses first: "you are not eligible for X because Y".
      not_eligible: summaries.filter((s) => s.outcome === 'INELIGIBLE').sort(byFewestFailures),
      indeterminate: summaries.filter((s) => s.outcome === 'INDETERMINATE').sort(byFewestFailures),
    };
  }

  /** One specific version (any status, including archived) against a profile. */
  async checkVersion(code: string, versionNo: number, profileInput: unknown) {
    const profile = sanitizeProfile(profileInput);
    const version = await this.findVersion(code, versionNo);
    const evaluation = evaluateScheme(version.config, profile);
    return {
      evaluation_run_id: null,
      storage: ANONYMOUS_NOT_PERSISTED,
      status: version.status,
      ...summarize(version, evaluation),
    };
  }

  /** Part 5: form fields and document checklist derived from the rule ASTs. */
  async formSchema(code: string, versionNo: number) {
    const version = await this.findVersion(code, versionNo);
    const schema: FormSchema = deriveFormSchema(version.config);
    return {
      scheme_code: version.scheme.code,
      scheme_name: version.scheme.name,
      version_no: version.version_no,
      scheme_version_id: version.id,
      status: version.status,
      ...schema,
    };
  }

  /**
   * Public lookup: any published version (active or archived). Drafts are
   * not published (Phase 14 loose ends, Part A) and look like no version at
   * all here; authors preview them through the scheme-authoring API.
   */
  private async findVersion(code: string, versionNo: number): Promise<VersionRow> {
    const version = await this.db.client.schemeVersion.findFirst({
      where: { version_no: versionNo, scheme: { code }, status: { not: 'draft' } },
      select: VERSION_SELECT,
    });
    if (!version) throw new AppError(ErrorCode.NOT_FOUND);
    return version;
  }

  /**
   * Writes the REDACTED form of every rule outcome (see redaction.ts): one
   * row per rule, one INSERT statement. evaluated_by_* come from the database
   * defaults, i.e. the actor transaction's app.actor_id / app.actor_role.
   * Only authenticated evaluations are ever stored: without an actor
   * transaction nothing is written (and so no audit_logs row is produced).
   */
  private async persist(
    runId: string,
    results: Array<{ version: VersionRow; evaluation: VersionEvaluation }>,
    applicationId: string,
  ): Promise<StorageReport> {
    if (!this.db.inActorTransaction) {
      return ANONYMOUS_NOT_PERSISTED;
    }

    const redacted = new Set<string>();
    const data: Prisma.RuleEvaluationCreateManyInput[] = results.flatMap(
      ({ version, evaluation }) =>
        evaluation.rules.map((rule) => {
          const stored = toPersisted(rule);
          stored.redacted_paths.forEach((p) => redacted.add(p));
          return {
            evaluation_run_id: runId,
            scheme_version_id: version.id,
            application_id: applicationId,
            rule_id: rule.rule_id,
            rule_type: rule.rule_type,
            expr: rule.expr,
            verdict: rule.verdict,
            result_value: stored.result_value === null ? Prisma.JsonNull : stored.result_value,
            trace: JSON.parse(JSON.stringify(stored.trace)) as Prisma.InputJsonValue,
            explanation: stored.explanation,
            message_key: rule.message_key,
          };
        }),
    );
    if (data.length > 0) await this.db.client.ruleEvaluation.createMany({ data });

    return {
      persisted: data.length > 0,
      reason:
        'Authenticated evaluation of a submitted application: stored with sensitive values redacted.',
      redaction_policy: REDACTION_POLICY,
      redacted_fields: [...redacted].sort(),
    };
  }
}
