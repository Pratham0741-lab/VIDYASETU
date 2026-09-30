import type { Prisma } from '@prisma/client';
import type { DbClient } from '../database/db-client';
import { RECORDED_FIELDS } from '../schemes/eligibility.service';
import { disagrees, isSensitiveField } from './review-routing';

/**
 * Phase 7's eligibility cross-check, moved here UNCHANGED from
 * DocumentPipelineProcessor (a private method until Phase 10) so the
 * DigiLocker path can run the very same comparison. The pipeline still calls
 * it for every OCR extraction; only the database client, the ids and the
 * tolerance are now parameters instead of processor fields.
 */
export type EligibilityMismatch = {
  field: string;
  sensitive: boolean;
  source: 'recorded' | 'declared';
};

/** Recorded fields whose source is the applicant row (readable as SYSTEM), by profile key. */
const APPLICANT_SOURCED: Readonly<Record<string, (a: ApplicantRow) => unknown>> = {
  category: (a) => a.category,
  pvtg_group: (a) => a.pvtg_group,
  gender: (a) => a.gender,
  is_disabled: (a) => a.is_disabled,
  disability_percentage: (a) => a.disability_percentage,
  domicile_state: (a) => a.domicile_state,
  domicile_district: (a) => a.domicile_district,
  family_income_annual: (a) => (a.income === null ? null : Number(a.income)),
};

interface ApplicantRow {
  category: string;
  pvtg_group: string | null;
  gender: string | null;
  is_disabled: boolean;
  disability_percentage: number | null;
  domicile_state: string;
  domicile_district: string | null;
  income: string | null;
}

const PROFILE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Fields that correspond to a value the application's automatic
 * eligibility evaluation used (the gate run Phase 4 recorded), and
 * disagree beyond DOC_VALUE_TOLERANCE. Names only: values never leave here.
 */
export async function compareWithEligibility(
  client: DbClient,
  job: { applicationId: string; applicantId: string },
  extracted: Readonly<Record<string, unknown>>,
  confidence: Readonly<Record<string, number>>,
  valueTolerance: number,
): Promise<EligibilityMismatch[]> {
  const gate = await client.workflowTransition.findFirst({
    where: { application_id: job.applicationId, triggered_by: 'SYSTEM' },
    orderBy: { created_at: 'desc' },
    select: { metadata: true },
  });
  const runId = (gate?.metadata as { evaluation_run_id?: unknown } | null)?.evaluation_run_id;
  if (typeof runId !== 'string') return [];

  const rows = await client.ruleEvaluation.findMany({
    where: { evaluation_run_id: runId, application_id: job.applicationId },
    select: { expr: true, trace: true },
  });
  const applicant = (await client.applicant.findUnique({
    where: { id: job.applicantId },
    select: {
      category: true,
      pvtg_group: true,
      gender: true,
      is_disabled: true,
      disability_percentage: true,
      domicile_state: true,
      domicile_district: true,
      income: true,
    },
  })) as unknown as ApplicantRow | null;

  const mismatches: Array<{
    field: string;
    sensitive: boolean;
    source: 'recorded' | 'declared';
  }> = [];
  for (const key of Object.keys(extracted).sort()) {
    if (!PROFILE_KEY.test(key)) continue;
    const path = new RegExp(`\\bapplicant\\.${key}\\b`);
    if (!rows.some((r) => path.test(r.expr))) continue; // not used by the evaluation

    let used: unknown;
    let source: 'recorded' | 'declared';
    if ((RECORDED_FIELDS as readonly string[]).includes(key)) {
      const read = APPLICANT_SOURCED[key];
      if (!read || !applicant) continue; // application-sourced: not readable as SYSTEM
      used = read(applicant);
      source = 'recorded';
    } else {
      used = declaredValue(rows, `applicant.${key}`);
      source = 'declared';
    }
    if (used === undefined || used === null) continue;
    if (disagrees(extracted[key], used, valueTolerance, confidence[key])) {
      mismatches.push({ field: key, sensitive: isSensitiveField(key), source });
    }
  }
  return mismatches;
}

/** A declared input as the evaluation resolved it (stored, unredacted, in its trace). */
function declaredValue(rows: Array<{ trace: Prisma.JsonValue }>, path: string): unknown {
  for (const row of rows) {
    const nodes = (row.trace as { trace?: unknown } | null)?.trace;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes as Array<Record<string, unknown>>) {
      for (const side of [node.left, node.right] as Array<Record<string, unknown> | undefined>) {
        if (side?.path === path && side.redacted !== true && 'resolvedValue' in side) {
          return side.resolvedValue;
        }
      }
    }
  }
  return undefined;
}
