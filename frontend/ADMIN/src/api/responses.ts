/**
 * Response view types.
 *
 * GENERATED where the OpenAPI file has a response schema (`pnpm gen:api`,
 * src/api/schema.ts): /auth/me, /applications/:id/history,
 * /selection-lists/:id/objections (and /schemes, selection-result, not
 * used here). Everything else is still NOT IN OPENAPI: most 2xx responses
 * are `{"description": ""}`, so those types list only the fields this app
 * reads, as found in the backend source (docs/FRONTEND_FINDINGS.md) and
 * checked live (docs/live-shapes/). Replace them with generated types as
 * the backend documents them (docs/BACKEND_REQUESTS.md R1). Request types
 * come from ./types (generated).
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type AppRole =
  | 'APPLICANT'
  | 'SUPER_ADMIN'
  | 'MINISTRY_OFFICER'
  | 'STATE_NODAL_OFFICER'
  | 'DISTRICT_NODAL_OFFICER'
  | 'INSTITUTE_NODAL_OFFICER'
  | 'COMMITTEE'
  | 'AUDITOR';

/** POST /auth/login */
export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

/** GET /auth/me (generated MeDto; officers also get name and institution_code). `role` narrowed to AppRole. */
export type Me = Omit<Schemas['MeDto'], 'role'> & { role: AppRole };

/**
 * GET /applications/:id/history (generated). The OpenAPI file declares
 * `from_stage` as nullable without a type, which generates
 * `Record<string, never> | null`; it is a stage code (string) or null.
 */
export type HistoryEntry = Omit<Schemas['HistoryEntryDto'], 'from_stage'> & { from_stage: string | null };
export type ApplicationHistory = Omit<Schemas['ApplicationHistoryDto'], 'history'> & { history: HistoryEntry[] };

/** GET /selection-lists/:id/objections (generated): ids, status and dates only. */
export type ListObjections = Schemas['ListObjectionsDto'];
export type Objection = Schemas['ObjectionDto'];

/** GET/PUT /officers/me/preferences */
export interface OfficerPreferences {
  officer_id: string;
  preferred_language: string;
  is_default: boolean;
  supported_languages?: string[];
  updated_at?: string | null;
}

// ------------------------------------------------------------ workflow
export type SlaState = 'WITHIN_SLA' | 'BREACHED' | 'NO_SLA';
export interface SlaView {
  stage: string;
  stage_entered_at: string;
  sla_days: number | null;
  due_at: string | null;
  state: SlaState;
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Application row as selected by the workflow (WORKFLOW_APPLICATION_SELECT). */
export interface WorkflowApplication {
  id: string;
  application_no: string;
  applicant_id: string;
  scheme_id: string;
  scheme_version_id: string;
  academic_year: string;
  current_stage: string;
  status: string;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
  institution_name: string | null;
  institution_code: string | null;
  assigned_officer_id: string | null;
  submitted_at: string | null;
  stage_entered_at: string;
  stage_due_at: string | null;
  needs_eligibility_review: boolean;
}

/** One row of GET /applications/queue */
export interface QueueItem extends WorkflowApplication {
  sla: SlaView;
  fraud: {
    held: boolean;
    open_flags: number;
    flags: Array<{ id: string; flag_type: string; severity: Severity; status: string }>;
  };
}

/** GET /applications/queue (at most 100 rows, ordered by eligibility review, then SLA due date) */
export interface QueueResponse {
  role: AppRole;
  stages: string[];
  count: number;
  applications: QueueItem[];
}

/** GET /applications/:id (reviewers also get aadhaar_authentication) */
export interface ApplicationDetail extends WorkflowApplication {
  course_name?: string | null;
  course_year?: number | null;
  /** status e.g. NOT_ATTEMPTED (live) */
  aadhaar_authentication?: { status: string; aadhaar_masked: string | null; at: string | null } | null;
}

/** POST /applications/:id/verify | reject | mark-defective */
export interface TransitionResult {
  application: WorkflowApplication & { sla: SlaView };
  transition: { id: string; from_stage: string; to_stage: string; trigger_action: string };
  decision_record_id: string | null;
  deficiency_id: string | null;
}

// ------------------------------------------------------------ documents
export type FieldReview = 'AUTO_ACCEPTED' | 'NEEDS_REVIEW' | 'OFFICER_CONFIRMED';

export interface ExtractedField {
  name: string;
  /** string | number live; kept open for booleans and redaction markers */
  value: unknown;
  confidence: number | null;
  review: FieldReview | null;
  sensitive: boolean;
  corrected: boolean;
}

/** A field whose extracted value disagrees with the applicant data (names only; never the values). */
export interface EligibilityMismatch {
  field: string;
  source: 'recorded' | 'declared' | string;
  sensitive: boolean;
}

/** One verification rule's result for a document, with the compared values. */
export interface RuleCheck {
  rule: string;
  field: string;
  mandatory: boolean;
  status: 'PASS' | 'FAIL' | 'NOT_READ' | 'UNAVAILABLE' | 'SKIPPED';
  extracted: string | number | null;
  expected: string | number | null;
}
/** Per-document-type verification: OCR extracts, the rules decide. */
export interface DocumentVerification {
  document_type: string;
  result: 'VERIFIED' | 'FLAGGED' | 'UNREAD';
  checks: RuleCheck[];
}
export interface DocumentView {
  document_id: string;
  application_id: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  file_sha256: string;
  uploaded_at: string;
  state: string;
  source: 'UPLOAD' | 'DIGILOCKER' | string;
  digilocker: { reference: string | null; issuer: string | null; issued_on: string | null; verified_at: string | null } | null;
  quality: { usable: boolean | null; issues: string[]; confidence: number | null } | null;
  verification_status: string;
  /** Rule results (income, ST certificate, marksheet, bonafide); null for other types. */
  verification?: DocumentVerification | null;
  extraction: {
    id: string;
    status: string;
    error_code: string | null;
    engine: string | null;
    /** alternatives[].type is lower case (e.g. "marksheet"); type is upper case (e.g. "CASTE_CERTIFICATE") */
    classification: { type: string | null; confidence: number | null; alternatives: Array<{ type: string; confidence: number }> | null; matches_slot: boolean | null };
    review_status: FieldReview | null;
    review_threshold: number | null;
    fields: ExtractedField[];
    eligibility_mismatches: EligibilityMismatch[] | null;
    confirmed_by_officer_id: string | null;
    confirmed_at: string | null;
    processed_at: string;
  } | null;
  ml_mode?: string;
  mock_notice?: string;
}

/** GET /applications/:id/documents */
export interface ApplicationDocuments {
  application_id: string;
  ml_mode: string;
  mock_notice?: string;
  flags: {
    needs_eligibility_review: boolean;
    /** e.g. CONSISTENT */
    document_consistency_status: string | null;
    document_consistency_details: { checks?: Record<string, boolean>; engine?: string; confidence?: Record<string, number>; min_confidence?: number; documents_compared?: number } | null;
    document_consistency_checked_at: string | null;
  };
  checklist: string[];
  slots: Array<{ slot: string; document_id: string | null; state: string }>;
  documents: DocumentView[];
}

// ------------------------------------------------------------ deficiencies
export interface DeficiencyItemPreview {
  document_slot: string;
  document_type?: string | null;
  field?: string | null;
  check_code: string;
  source?: string;
  problem_code: string;
  fix_code?: string | null;
  deadline_at: string;
}

/** POST /applications/:id/deficiencies (dry_run true / false) */
export interface DeficiencyIssueResult {
  dry_run?: boolean;
  application_id: string;
  application_no?: string;
  current_stage?: string;
  deficiency_id?: string;
  decision_record_id?: string | null;
  deadline_days: number;
  items: DeficiencyItemPreview[];
}

/** GET /applications/:id/deficiencies */
export interface DeficiencyList {
  application_id: string;
  application_no: string;
  current_stage: string;
  deficiencies: Array<{
    id: string;
    itemised: boolean;
    code: string;
    title: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
    items: Array<{ id: string; document_slot: string | null; check_code: string; problem_code: string; status: string; deadline_at: string | null }>;
  }>;
}

// ------------------------------------------------------------ bulk actions
export type BulkOutcome = 'CHANGED' | 'WOULD_CHANGE' | 'NO_CHANGE' | 'SKIPPED';
export interface BulkItemResult {
  application_id: string;
  application_no: string | null;
  outcome: BulkOutcome;
  skip_reason?: string;
  from_stage: string | null;
  to_stage?: string;
  fraud_flag_ids?: string[];
  document_slot?: string;
}
/** POST /applications/bulk-actions */
export interface BulkResult {
  batch_id: string;
  action: string;
  dry_run: boolean;
  transaction: string;
  requested: number;
  changed: number;
  would_change: number;
  no_change: number;
  skipped: number;
  items: BulkItemResult[];
}

// ------------------------------------------------------------ fraud
export interface FraudFlag {
  id: string;
  created_at: string;
  flag_type: string;
  severity: Severity;
  status: string;
  subject_type: 'APPLICATION' | 'INSTITUTION';
  application_id: string | null;
  institution_code: string | null;
  related_application_ids: string[];
  related_document_ids: string[];
  confidence: number | null;
  summary: string;
  evidence: Record<string, unknown>;
  detector: string;
  reviewed_by_officer_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

/** GET /applications/:id/fraud-flags; POST .../fraud-checks adds `run` */
export interface FraudFlags {
  application_id: string;
  application_no: string;
  current_stage: string;
  held: boolean;
  holding_flag_ids: string[];
  flags: FraudFlag[];
  run?: unknown;
}

/** A count cell of an analytics view: a number, or a suppression marker exactly as returned (e.g. "<5", "suppressed"). */
export type Cell = number | string | null;

/** GET /analytics/fraud */
export interface FraudAnalytics {
  meta: Record<string, unknown>;
  application_flags: Array<{ flag_type: string; severity: string; status: string; flags: Cell; applications?: Cell }>;
  institution_flags: Array<{ flag_type: string; severity: string; status: string; flags: Cell }>;
  held_applications: { total: Cell; by_stage: Array<{ stage: string; applications: Cell }> };
}

// ------------------------------------------------------------ selection
export type ListStatus = 'DRAFT' | 'PROVISIONAL_PUBLISHED' | 'OBJECTION_WINDOW_CLOSED' | 'FINAL_PUBLISHED';
export interface SelectionList {
  id: string;
  selection_run_id: string;
  scheme_code: string;
  academic_year: string;
  status: ListStatus;
  approvals_required: number;
  objection_window_days: number;
  provisional_published_at: string | null;
  window_closes_at: string | null;
  window_closed_at: string | null;
  window_closed_early: boolean | null; // always boolean live
  final_published_at: string | null;
  created_at: string;
}

export interface ListDecision {
  kind: string;
  reason: string | null;
  officer_id: string | null;
  grievance_id?: string | null;
  created_at: string;
}

export interface SelectionEntry {
  id: string;
  application_id: string;
  application_no: string | null;
  computed_outcome: string;
  /** null in practice for the observed final lists (live pass M8) */
  computed_rank: number | null;
  not_selected_reason: string | null;
  vertical_category: string | null;
  horizontal_reservation: string | null;
  committee_decision: 'INCLUDE' | 'EXCLUDE' | null;
  final_outcome: string | null;
  decisions: ListDecision[];
}

/** GET /selection-lists/:id */
export interface SelectionListDetail extends SelectionList {
  list_decisions: ListDecision[];
  entries_in_scope: number;
  entries: SelectionEntry[];
}

// ------------------------------------------------------------ audit
export interface ChainBreak {
  kind: string;
  record_id: string | null;
  seq: string | null;
  detail: string;
  fields?: string[];
}
export interface LegacyReport {
  rows: number;
  digest: string;
  checkpoint_rows: number | null;
  checkpoint_digest: string | null;
  matches_checkpoint: boolean;
  vouches_for: string;
  cannot_vouch_for: string;
}
export interface ChainReport {
  rows: number;
  first_seq: string | null;
  last_seq: string | null;
  last_hash: string | null;
  head_seq: string | null;
  head_hash: string | null;
  vouches_for: string;
  cannot_vouch_for: string;
}
/** GET /audit/verify */
export interface AuditVerifyReport {
  ok: boolean;
  checked_at: string;
  legacy: LegacyReport;
  chain: ChainReport;
  first_break: ChainBreak | null;
  denials: { ok: boolean; legacy: LegacyReport; chain: ChainReport; first_break: ChainBreak | null };
}

/** GET /authorization-denials (only the fields this app shows; never IP or details) */
export interface AuthorizationDenial {
  id: string;
  occurred_at: string;
  actor_type: string | null;
  actor_role: string | null;
  action_attempted: string;
  subject_type: string | null;
  subject_id: string | null;
  denial_reason: string;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
  /** a decimal string (live); null for legacy rows */
  seq: string | null;
  record_hash: string;
}

/** GET /document-access (ids only) */
export interface DocumentAccess {
  id: string;
  accessed_at: string;
  actor_role: string;
  access_kind: string;
  resource_type: string;
  resource_id: string | null;
  application_id: string | null;
  document_id: string | null;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
}

// ------------------------------------------------------------ analytics
/** Any analytics view: `meta` plus named row arrays / objects, cells printed as returned. */
export interface AnalyticsView {
  meta: Record<string, unknown>;
  [section: string]: unknown;
}

// ------------------------------------------------------------ scheme studio
export type VersionStatus = 'draft' | 'active' | 'archived';

export interface SchemeVersionSummary {
  id: string;
  version_no: number;
  status: VersionStatus | string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemeSummary {
  id: string;
  code: string;
  name: string;
  department: string;
  description: string | null;
  type: string;
  portal_url: string | null;
  is_active: boolean;
  disbursement_mode: string;
  created_at: string;
  updated_at: string;
  versions?: SchemeVersionSummary[];
}

/** GET /admin/schemes */
export interface SchemeList {
  known_workflows: string[];
  schemes: SchemeSummary[];
}

/** One rule of a scheme config (schemas/scheme-config.schema.json); other keys are kept as they are. */
export interface ConfigRule {
  id: string;
  type: 'eligibility' | 'benefit_note' | 'operational' | 'unmapped' | string;
  expr: string;
  params: Record<string, unknown>;
  doc_refs: string[];
  message_key: string;
  [key: string]: unknown;
}

export interface SelectionPool {
  key: 'ST_OTHERS' | 'PVTG';
  seats: number;
  female_percentage?: number;
  rounding?: 'HALF_UP' | 'FLOOR' | 'CEIL';
}

export interface SelectionPolicy {
  basis: 'NO_COMPETITION' | 'RANKED_NO_CAP' | 'QUOTA';
  merit?: { rule_id: string; direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' };
  pools?: SelectionPool[];
}

/** A scheme version config. The schema leaves the top level open, so unknown keys are preserved. */
export interface SchemeConfig {
  rules: ConfigRule[];
  benefits: Array<Record<string, unknown>>;
  required_documents: string[];
  fund_sharing_ratio: string | null;
  selection_policy?: SelectionPolicy;
  workflow?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SchemeVersionFull extends SchemeVersionSummary {
  scheme_id: string;
  config: SchemeConfig;
  source_document: string | null;
  source_url: string | null;
  extraction_confidence: string | null;
  extraction_notes: string | null;
}

/** GET /admin/schemes/:code/versions/:v */
export interface SchemeVersionDetail {
  scheme: SchemeSummary;
  version: SchemeVersionFull;
  editable: boolean;
}

/** One validation problem (400 VALIDATION_ERROR details[] from create, edit, validate, publish). */
export interface ConfigIssue {
  field: string;
  message_key?: string;
  params?: Record<string, string | number>;
  constraints?: Record<string, string>;
}

/** POST .../validate (200) */
export interface ValidateResult {
  scheme_code: string;
  version_no: number;
  status: string;
  valid: boolean;
  rules_by_type: Record<string, number>;
  form_fields: string[];
  document_checklist: string[];
  workflow: string;
}

export interface FormSchemaField {
  key: string;
  path?: string;
  types?: string[];
  used_by?: Array<{ rule_id: string; rule_type: string }>;
  options?: unknown[];
  limits?: Array<{ rule_id: string; param: string; value: unknown }>;
}

/** POST .../preview */
export interface PreviewResult {
  scheme_code: string;
  version_no: number;
  status: string;
  stored: boolean;
  outcome: string;
  eligible: boolean | null;
  rules: Array<{ rule_id: string; rule_type: string; verdict: string; value: unknown; message_key: string | null; explanation: string | null }>;
  form_schema: { fields: FormSchemaField[]; documents?: { checklist?: string[] }; unparseable_rules?: unknown[] };
}

/** POST .../publish */
export interface PublishResult {
  version: SchemeVersionFull;
  superseded: Array<{ version_no: number; status: string; effective_to: string | null }>;
}

/** GET /admin/schemes/:code/diff */
export interface SchemeDiff {
  scheme_code: string;
  from: { version_no: number; status: string };
  to: { version_no: number; status: string };
  change_count: number;
  changes: Array<{ path: string; change: 'added' | 'removed' | 'changed' | string; from?: unknown; to?: unknown }>;
}
