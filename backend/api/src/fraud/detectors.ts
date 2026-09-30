import { dedupKey, MATCH_KEY_VERSION, matchHmac, MatchField } from './fraud-match';
import { IdentityRecord, scoreIdentityPair } from './identity-match';

/**
 * Phase 11 detectors. Each is independently callable and testable against a
 * FraudData implementation, and returns zero or more flag drafts.
 *
 * Evidence discipline (every redaction rule since Phase 3): a draft carries
 * record ids, counts, categories and scores - never a bank account, a
 * certificate number, a file hash, a name or a date of birth.
 */

export type FlagType =
  | 'SHARED_BANK_ACCOUNT'
  | 'REPEATED_CERTIFICATE_NUMBER'
  | 'DUPLICATE_FILE_HASH'
  | 'INSTITUTION_SURGE'
  | 'FUZZY_IDENTITY_MATCH';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type IndexSource = 'DECLARED' | 'OCR' | 'DIGILOCKER';

export interface FlagDraft {
  flag_type: FlagType;
  severity: Severity;
  subject_type: 'APPLICATION' | 'INSTITUTION';
  application_id: string | null;
  institution_code: string | null;
  related_application_ids: string[];
  related_document_ids: string[];
  confidence: number | null;
  summary: string;
  evidence: Record<string, unknown>;
  detector: string;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
  dedup_key: string;
}

export interface AppFacts {
  application_id: string;
  application_no: string;
  applicant_id: string;
  current_stage: string;
  jurisdiction_state: string;
  jurisdiction_district: string | null;
  institution_code: string | null;
  assigned_officer_id: string | null;
  submitted_at: Date;
}
export interface DocFacts {
  document_id: string;
  application_id: string;
  applicant_id: string;
  file_sha256: string;
  source: string;
}
export interface IndexEntry {
  applicant_id: string;
  field: MatchField;
  source: IndexSource;
  document_id: string | null;
  match_hmac: string;
}
export interface ApplicantIdentity extends IdentityRecord {
  applicant_id: string;
  domicile_state: string;
}

/** What the detectors read and write. The live implementation runs as the SYSTEM actor. */
export interface FraudData {
  applications(q: {
    applicationIds?: string[];
    applicantIds?: string[];
    institutionCode?: string;
    disbursementIds?: string[];
  }): Promise<AppFacts[]>;
  documents(q: {
    documentIds?: string[];
    applicationId?: string;
    fileSha256?: string;
  }): Promise<DocFacts[]>;
  /** The applicant's own declared identifiers, decrypted in memory for hashing only. */
  declaredIdentifiers(
    applicantId: string,
  ): Promise<{ bank_account: string | null; caste_cert_number: string | null }>;
  /** Identifiers read from this application's completed extractions (in memory only). */
  extractedIdentifiers(
    applicationId: string,
  ): Promise<
    Array<{ document_id: string; field: MatchField; value: string; source: 'OCR' | 'DIGILOCKER' }>
  >;
  upsertIndex(entries: IndexEntry[]): Promise<void>;
  findIndexMatches(field: MatchField, hmac: string): Promise<IndexEntry[]>;
  identity(applicantId: string): Promise<ApplicantIdentity | null>;
  identityCandidates(
    domicileState: string,
    excludeApplicantId: string,
  ): Promise<ApplicantIdentity[]>;
  platformFirstSubmission(): Promise<Date | null>;
}

export interface DetectorContext {
  data: FraudData;
  matchKey: Buffer;
  now: () => Date;
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
const listIds = (ids: string[]) =>
  ids.length <= 5 ? ids.join(', ') : `${ids.slice(0, 5).join(', ')} (+${ids.length - 5} more)`;

function applicationFlag(
  app: AppFacts,
  f: Omit<
    FlagDraft,
    | 'subject_type'
    | 'application_id'
    | 'institution_code'
    | 'jurisdiction_state'
    | 'jurisdiction_district'
  >,
): FlagDraft {
  return {
    ...f,
    subject_type: 'APPLICATION',
    application_id: app.application_id,
    institution_code: null,
    jurisdiction_state: app.jurisdiction_state,
    jurisdiction_district: app.jurisdiction_district,
  };
}

/**
 * One flag per application in a group of DIFFERENT applicants that share an
 * identifier, each pointing at the others' applications. Stable dedup key per
 * (type, field, application, group), so running from either side agrees.
 */
async function groupFlags(
  ctx: DetectorContext,
  type: FlagType,
  field: MatchField,
  groupEntries: IndexEntry[],
  severity: Severity,
  detector: string,
): Promise<FlagDraft[]> {
  const applicantIds = sorted(groupEntries.map((e) => e.applicant_id));
  if (applicantIds.length < 2) return [];
  const apps = await ctx.data.applications({ applicantIds });
  const docIds = sorted(groupEntries.flatMap((e) => (e.document_id ? [e.document_id] : [])));
  const sources = sorted(groupEntries.map((e) => e.source));
  const groupKey = applicantIds.join(',');
  return apps.map((app) => {
    const others = apps
      .filter((o) => o.applicant_id !== app.applicant_id)
      .map((o) => o.application_id)
      .sort();
    const label =
      field === 'bank_account'
        ? 'bank account'
        : field === 'caste_cert_number'
          ? 'caste certificate number'
          : 'certificate number';
    return applicationFlag(app, {
      flag_type: type,
      severity,
      related_application_ids: others,
      related_document_ids: docIds,
      confidence: null,
      summary: `Same ${label} as ${others.length} application(s) of ${applicantIds.length - 1} other applicant(s): ${listIds(others)}`,
      evidence: {
        field,
        match: 'keyed-hash equality (HMAC-SHA256, value never compared or stored in clear)',
        key_version: MATCH_KEY_VERSION,
        sources,
        other_applicant_count: applicantIds.length - 1,
        matched_application_ids: others,
        matched_document_ids: docIds,
      },
      detector,
      dedup_key: dedupKey(type, field, app.application_id, groupKey),
    });
  });
}

// ---------------------------------------------------------------------------
export async function detectSharedBankAccount(
  ctx: DetectorContext,
  applicationId: string,
): Promise<FlagDraft[]> {
  const [app] = await ctx.data.applications({ applicationIds: [applicationId] });
  if (!app) return [];
  const { bank_account } = await ctx.data.declaredIdentifiers(app.applicant_id);
  const hmac = bank_account ? matchHmac(ctx.matchKey, 'bank_account', bank_account) : null;
  if (!hmac) return [];
  await ctx.data.upsertIndex([
    {
      applicant_id: app.applicant_id,
      field: 'bank_account',
      source: 'DECLARED',
      document_id: null,
      match_hmac: hmac,
    },
  ]);
  const group = await ctx.data.findIndexMatches('bank_account', hmac);
  if (!group.some((e) => e.applicant_id !== app.applicant_id)) return [];
  return groupFlags(
    ctx,
    'SHARED_BANK_ACCOUNT',
    'bank_account',
    group,
    'HIGH',
    'detectSharedBankAccount',
  );
}

// ---------------------------------------------------------------------------
export async function detectRepeatedCertificateNumber(
  ctx: DetectorContext,
  applicationId: string,
): Promise<FlagDraft[]> {
  const [app] = await ctx.data.applications({ applicationIds: [applicationId] });
  if (!app) return [];
  const entries: IndexEntry[] = [];
  const declared = await ctx.data.declaredIdentifiers(app.applicant_id);
  const declaredHmac = declared.caste_cert_number
    ? matchHmac(ctx.matchKey, 'caste_cert_number', declared.caste_cert_number)
    : null;
  if (declaredHmac) {
    entries.push({
      applicant_id: app.applicant_id,
      field: 'caste_cert_number',
      source: 'DECLARED',
      document_id: null,
      match_hmac: declaredHmac,
    });
  }
  for (const x of await ctx.data.extractedIdentifiers(applicationId)) {
    const h = matchHmac(ctx.matchKey, x.field, x.value);
    if (h)
      entries.push({
        applicant_id: app.applicant_id,
        field: x.field,
        source: x.source,
        document_id: x.document_id,
        match_hmac: h,
      });
  }
  if (entries.length === 0) return [];
  await ctx.data.upsertIndex(entries);

  const flags: FlagDraft[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.field}:${e.match_hmac}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = await ctx.data.findIndexMatches(e.field, e.match_hmac);
    if (!group.some((g) => g.applicant_id !== app.applicant_id)) continue;
    // Declared values and DigiLocker (issuer) values are exact; an OCR read may be a misread.
    const severity: Severity = group.every((g) => g.source !== 'OCR') ? 'HIGH' : 'MEDIUM';
    flags.push(
      ...(await groupFlags(
        ctx,
        'REPEATED_CERTIFICATE_NUMBER',
        e.field,
        group,
        severity,
        'detectRepeatedCertificateNumber',
      )),
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
export async function detectDuplicateFileHash(
  ctx: DetectorContext,
  documentId: string,
): Promise<FlagDraft[]> {
  const [doc] = await ctx.data.documents({ documentIds: [documentId] });
  if (!doc) return [];
  const same = await ctx.data.documents({ fileSha256: doc.file_sha256 });
  // The same file on the same applicant's own (re)submissions is not fraud.
  if (!same.some((d) => d.applicant_id !== doc.applicant_id)) return [];
  const apps = await ctx.data.applications({
    applicationIds: sorted(same.map((d) => d.application_id)),
  });
  const groupKey = sorted(same.map((d) => d.document_id)).join(',');
  const applicantCount = new Set(same.map((d) => d.applicant_id)).size;
  return apps.map((app) => {
    const mine = same
      .filter((d) => d.application_id === app.application_id)
      .map((d) => d.document_id)
      .sort();
    const others = same.filter((d) => d.applicant_id !== app.applicant_id);
    const otherApps = sorted(others.map((d) => d.application_id));
    return applicationFlag(app, {
      flag_type: 'DUPLICATE_FILE_HASH',
      severity: 'HIGH',
      related_application_ids: otherApps,
      related_document_ids: sorted(others.map((d) => d.document_id)),
      confidence: null,
      summary: `Document ${listIds(mine)} is byte-identical to document(s) ${listIds(others.map((d) => d.document_id).sort())} on ${otherApps.length} other applicant(s)' application(s): ${listIds(otherApps)}`,
      evidence: {
        match: 'identical SHA-256 of the stored file (Phase 7 upload hash, not recomputed)',
        this_application_document_ids: mine,
        same_file_as: others.map((d) => ({
          document_id: d.document_id,
          application_id: d.application_id,
        })),
        applicant_count: applicantCount,
      },
      detector: 'detectDuplicateFileHash',
      dedup_key: dedupKey('DUPLICATE_FILE_HASH', app.application_id, groupKey),
    });
  });
}

// ---------------------------------------------------------------------------
export interface SurgeConfig {
  windowDays: number;
  baselineWindows: number;
  multiple: number;
  minCount: number;
}
export interface SurgeResult {
  institution_code: string;
  status: 'FIRED' | 'NORMAL' | 'INSUFFICIENT_BASELINE';
  window_start: string;
  window_count: number;
  baseline_counts: number[];
  baseline_median: number | null;
  threshold: number | null;
  reason?: string;
  flags: FlagDraft[];
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Current window's submissions for one institution against the median of the
 * preceding `baselineWindows` windows. Refuses (INSUFFICIENT_BASELINE) when the
 * platform's history does not reach back over the whole baseline: without it,
 * any first-week volume would look like a surge.
 */
export async function detectInstitutionSurge(
  ctx: DetectorContext,
  institutionCode: string,
  windowDays: number,
  cfg: Omit<SurgeConfig, 'windowDays'>,
): Promise<SurgeResult> {
  const now = ctx.now().getTime();
  const windowStart = now - windowDays * DAY;
  const baselineStart = windowStart - cfg.baselineWindows * windowDays * DAY;
  const base: Omit<SurgeResult, 'status' | 'flags'> = {
    institution_code: institutionCode,
    window_start: new Date(windowStart).toISOString(),
    window_count: 0,
    baseline_counts: [],
    baseline_median: null,
    threshold: null,
  };
  const first = await ctx.data.platformFirstSubmission();
  if (!first || first.getTime() > baselineStart) {
    return {
      ...base,
      status: 'INSUFFICIENT_BASELINE',
      reason: `platform history starts ${first ? first.toISOString() : 'nowhere'}; the baseline needs data from ${new Date(baselineStart).toISOString()}`,
      flags: [],
    };
  }
  const rows = (await ctx.data.applications({ institutionCode })).filter(
    (a) => a.submitted_at.getTime() >= baselineStart && a.submitted_at.getTime() <= now,
  );
  const inWindow = rows.filter((a) => a.submitted_at.getTime() >= windowStart);
  const baselineCounts = Array.from({ length: cfg.baselineWindows }, (_, k) => {
    const from = baselineStart + k * windowDays * DAY;
    const to = from + windowDays * DAY;
    return rows.filter((a) => a.submitted_at.getTime() >= from && a.submitted_at.getTime() < to)
      .length;
  });
  const med = median(baselineCounts);
  const threshold = Math.max(cfg.minCount, Math.ceil(cfg.multiple * Math.max(med, 1)));
  const result = {
    ...base,
    window_count: inWindow.length,
    baseline_counts: baselineCounts,
    baseline_median: med,
    threshold,
  };
  if (inWindow.length < threshold) return { ...result, status: 'NORMAL', flags: [] };

  // The window's most common jurisdiction decides who reviews the flag.
  const tally = new Map<string, { state: string; district: string | null; n: number }>();
  for (const a of inWindow) {
    const k = `${a.jurisdiction_state}|${a.jurisdiction_district ?? ''}`;
    const t = tally.get(k) ?? {
      state: a.jurisdiction_state,
      district: a.jurisdiction_district,
      n: 0,
    };
    t.n += 1;
    tally.set(k, t);
  }
  const top = [...tally.values()].sort((x, y) => y.n - x.n)[0];
  const ids = inWindow.map((a) => a.application_id).sort();
  const bucket = Math.floor(windowStart / (windowDays * DAY));
  return {
    ...result,
    status: 'FIRED',
    flags: [
      {
        flag_type: 'INSTITUTION_SURGE',
        severity: 'MEDIUM',
        subject_type: 'INSTITUTION',
        application_id: null,
        institution_code: institutionCode,
        related_application_ids: ids.slice(0, 200),
        related_document_ids: [],
        confidence: null,
        summary: `${inWindow.length} applications in ${windowDays} days from institution ${institutionCode}; baseline median ${med} per ${windowDays} days (threshold ${threshold})`,
        evidence: {
          window_days: windowDays,
          window_start: new Date(windowStart).toISOString(),
          window_count: inWindow.length,
          baseline_windows: cfg.baselineWindows,
          baseline_counts: baselineCounts,
          baseline_median: med,
          multiple: cfg.multiple,
          min_count: cfg.minCount,
          threshold,
          application_ids_truncated: ids.length > 200,
        },
        detector: 'detectInstitutionSurge',
        jurisdiction_state: top.state,
        jurisdiction_district: top.district,
        dedup_key: dedupKey(
          'INSTITUTION_SURGE',
          institutionCode,
          String(windowDays),
          String(bucket),
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
export async function detectFuzzyIdentityMatch(
  ctx: DetectorContext,
  applicantId: string,
): Promise<FlagDraft[]> {
  const me = await ctx.data.identity(applicantId);
  if (!me || !me.dob) return [];
  const candidates = await ctx.data.identityCandidates(me.domicile_state, applicantId);
  const flags: FlagDraft[] = [];
  for (const c of candidates) {
    const s = scoreIdentityPair(me, c);
    if (!s.severity) continue;
    const apps = await ctx.data.applications({ applicantIds: [me.applicant_id, c.applicant_id] });
    const pairKey = sorted([me.applicant_id, c.applicant_id]).join(',');
    for (const app of apps) {
      const others = apps
        .filter((o) => o.applicant_id !== app.applicant_id)
        .map((o) => o.application_id)
        .sort();
      flags.push(
        applicationFlag(app, {
          flag_type: 'FUZZY_IDENTITY_MATCH',
          severity: s.severity,
          related_application_ids: others,
          related_document_ids: [],
          confidence: s.score,
          summary: `Possibly the same person as the applicant of ${listIds(others)} (score ${s.score}; name ${s.name_relation}, date of birth ${s.dob_relation}, district ${s.district_match ? 'same' : 'different'}) - advisory, uncalibrated`,
          evidence: {
            score: s.score,
            name_relation: s.name_relation,
            dob_relation: s.dob_relation,
            district_match: s.district_match,
            matched_application_ids: others,
            calibration:
              'UNCALIBRATED: hand-constructed cases only; no labelled duplicate data exists',
          },
          detector: 'detectFuzzyIdentityMatch',
          dedup_key: dedupKey('FUZZY_IDENTITY_MATCH', app.application_id, pairKey),
        }),
      );
    }
  }
  return flags;
}
