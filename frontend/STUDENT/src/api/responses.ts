/**
 * Response view types.
 *
 * GENERATED where the OpenAPI file now has a response schema (GET /auth/me,
 * /schemes, /applications/{id}/history, /applications/{id}/selection-result):
 * those types are aliases of `components["schemas"]` in ./schema.ts.
 *
 * NOT IN OPENAPI (hand-kept, narrow): every other type below. They list only
 * the fields this app reads, checked against live responses
 * (docs/live-shapes). Replace each with a generated type when the backend
 * documents it (docs/BACKEND_REQUESTS.md R1).
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

/** POST /auth/register */
export interface RegisterResult {
  account_id: string;
  applicant_id: string;
}

/** GET /auth/me (generated) */
export type Me = Schemas['MeDto'];

/** GET /schemes (generated; public) */
export type ActiveSchemes = Schemas['ActiveSchemesDto'];
export type ActiveScheme = Schemas['ActiveSchemeVersionDto'];

/**
 * GET /applications/{id}/history (generated). The OpenAPI declares
 * `from_stage` as `type: object`, but the value is a stage string or null
 * (BACKEND_REQUESTS R8); only that field is narrowed here.
 */
export type HistoryEntry = Omit<Schemas['HistoryEntryDto'], 'from_stage'> & { from_stage: string | null };
export type ApplicationHistory = Omit<Schemas['ApplicationHistoryDto'], 'history'> & { history: HistoryEntry[] };

/** GET /applicants/me (identifiers masked by the backend) */
export interface ApplicantProfile {
  applicant_id: string;
  first_name: string;
  last_name: string;
  category: string | null;
  gender: string | null;
  dob: string | null;
  is_disabled: boolean | null;
  domicile_state: string | null;
  domicile_district: string | null;
  annual_income: string | null;
  preferred_language: string;
  supported_languages: string[];
}

/** GET/POST /applicants/me/consents */
export interface ConsentPurpose {
  purpose: string;
  required_for_applications: boolean;
  title_key: string;
  text_key: string;
  title: string;
  text: string;
  current: boolean;
  status: 'GIVEN' | 'WITHDRAWN' | 'NOT_GIVEN';
  status_notice_version: string | null;
}
export interface ConsentState {
  notice_version: string;
  language: string;
  purposes: ConsentPurpose[];
  missing_for_applications: string[];
  history: Array<{ purpose: string; status: string; notice_version: string; language: string; at: string }>;
}

/** Scheme entry of POST /schemes/check-eligibility */
export interface RuleResult {
  rule_id: string;
  rule_type: string;
  verdict: string;
  value: unknown;
  message_key: string | null;
  explanation: string | null;
}
export interface SchemeResult {
  scheme_code: string;
  scheme_name: string;
  version_no: number;
  scheme_version_id: string;
  outcome: string;
  eligible: boolean;
  failed_rules: Array<{ rule_id: string; message_key: string | null; explanation: string }>;
  error_rules: Array<{ rule_id: string; explanation: string }>;
  rules: RuleResult[];
}
export interface EligibilityCheck {
  evaluated_at: string;
  schemes_evaluated: number;
  eligible: SchemeResult[];
  not_eligible: SchemeResult[];
  indeterminate: SchemeResult[];
}

/** GET /schemes/{code}/versions/{version}/form-schema */
export interface FormField {
  key: string;
  path: string;
  types: string[];
  used_by: Array<{ rule_id: string; rule_type: string }>;
  options: unknown[];
  limits: Array<{ rule_id: string; param: string; value: unknown }>;
}
export interface FormSchema {
  scheme_code: string;
  scheme_name: string;
  version_no: number;
  scheme_version_id: string;
  status: string;
  fields: FormField[];
  documents: { required_documents: string[]; rule_doc_refs: Array<{ doc_ref: string; rule_ids: string[] }>; checklist: string[] };
  unparseable_rules: unknown[];
}

/** GET /applications/{id} (and list items) */
export type Stage =
  | 'SUBMITTED'
  | 'INO_VERIFIED'
  | 'DNO_VERIFIED'
  | 'SNO_VERIFIED'
  | 'MINISTRY_APPROVED'
  | 'DEFECTIVE'
  | 'REJECTED'
  | 'DISBURSED';
export interface Application {
  id: string;
  application_no: string;
  scheme_version_id: string;
  academic_year: string;
  current_stage: Stage;
  status: string;
  institution_name: string | null;
  course_name: string | null;
  submitted_at: string | null;
  stage_entered_at: string | null;
  stage_due_at: string | null;
  needs_eligibility_review: boolean;
}
export interface EligibilityGate {
  outcome: string;
  routed_to: Stage;
  needs_eligibility_review: boolean;
  failed_rules: Array<{ rule_id: string; message_key: string | null; explanation: string }>;
  error_rules: Array<{ rule_id: string; explanation: string }>;
}
export type CreatedApplication = Application & { eligibility_gate: EligibilityGate | null };

/** Application drafts */
export interface Draft {
  id: string;
  status: string;
  scheme_version_id: string | null;
  academic_year: string | null;
  institution_name: string | null;
  institution_code: string | null;
  course_name: string | null;
  course_year: number | null;
  is_hosteller: boolean | null;
  declared: Record<string, unknown> | null;
  submitted_application_id: string | null;
  updated_at: string;
}
export interface DraftSubmitResult {
  draft: Draft;
  application: CreatedApplication;
}

/** Documents */
export type DocumentState = 'MISSING' | 'QUALITY_REJECTED' | 'PROCESSING' | 'FAILED' | 'COMPLETED' | string;
export interface DocumentQuality {
  usable: boolean | null;
  issues: string[];
  confidence: number | null;
}
export interface UploadResult {
  status: 'PROCESSING' | 'QUALITY_REJECTED';
  document_id: string;
  document_type: string;
  uploaded_at: string;
  ml_mode: string;
  mock_notice?: string;
  quality: DocumentQuality;
}
/** Item of GET /applications/{id}/documents -> documents[] (live: no ml_mode here). */
export interface DocumentView {
  document_id: string;
  document_type: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
  state: DocumentState;
  quality: DocumentQuality | null;
  verification_status: string | null;
}
/** GET /documents/{id} (polling): the list item plus the ML mode. */
export type DocumentDetail = DocumentView & { ml_mode: string; mock_notice?: string };
/** One row's result: scanned automatically on upload. */
export type SlotOutcome = 'MISSING' | 'SCANNING' | 'VERIFIED' | 'NEEDS_ATTENTION';
export type AttentionReason =
  | { code: 'quality'; issues: string[] }
  | { code: 'unreadable' }
  | { code: 'wrong_type'; detected: string | null }
  | { code: 'type_uncertain' }
  | { code: 'manual_check' }
  | { code: 'low_confidence'; fields: string[] }
  | { code: 'profile_mismatch'; fields: string[] };
export interface DocumentReadiness {
  required_slots: string[];
  pending_slots: string[];
  attention_slots: string[];
  consistency: string | null;
  consistency_pending: boolean;
  ready: boolean;
  verified: boolean;
}
export interface DocumentSlot {
  slot: string;
  optional: boolean;
  document_id: string | null;
  state: DocumentState;
  outcome: SlotOutcome;
  reasons: AttentionReason[];
}
export interface ApplicationDocuments {
  application_id: string;
  current_stage: string;
  ml_mode: string;
  mock_notice?: string;
  checklist: string[];
  slots: DocumentSlot[];
  readiness: DocumentReadiness;
  documents: DocumentView[];
}
/** POST /applications/{id}/documents/complete */
export interface DocumentsComplete {
  application_id: string;
  advanced: boolean;
  current_stage: string;
  needs_eligibility_review?: boolean;
  readiness: DocumentReadiness;
  eligibility_gate: EligibilityGate | null;
}

/** GET /applications/{id}/deficiencies */
export interface DeficiencyItem {
  id: string;
  document_slot: string | null;
  document_type: string | null;
  field: string | null;
  source: 'CHECK' | 'OFFICER' | string;
  problem_code: string | null;
  fix_code: string | null;
  deadline_at: string | null;
  status: string;
  crop_ref: string | null;
}
export interface Deficiency {
  id: string;
  itemised: boolean;
  code: string;
  title: string | null;
  status: string;
  created_at: string;
  items: DeficiencyItem[];
}
export interface DeficiencyList {
  application_id: string;
  application_no: string;
  current_stage: Stage;
  deficiencies: Deficiency[];
}
export interface ResubmitResult {
  resubmitted: boolean;
  transition: { from_stage: string; to_stage: string } | null;
  items: Array<{ id: string; status: string; problem_code: string }>;
  all_cleared: boolean;
}

/** POST /applications/{id}/resubmit (without open itemised items) */
export interface TransitionResult {
  application: Application;
  transition: { from_stage: string; to_stage: string; trigger_action: string };
}

/**
 * GET /applications/{id}/selection-result (generated). The OpenAPI declares
 * `list.window_closes_at` as `type: object` (a date-time string or null in
 * reality, R8) and `score` as a free-form object; those are narrowed, and
 * `list` is kept nullable as a defensive guard.
 */
export type SelectionResultList = Omit<Schemas['SelectionResultListDto'], 'window_closes_at'> & { window_closes_at: string | null };
export type SelectionScore = { score_type: string; score_value: number; breakdown: unknown };
export type SelectionResult = Omit<Schemas['SelectionResultDto'], 'list' | 'score'> & {
  list: SelectionResultList | null;
  score?: SelectionScore | null;
};

/** GET /notifications */
export interface Notification {
  id: string;
  event_type: string;
  template_key: string;
  application_id: string | null;
  subject: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}
export interface NotificationList {
  count: number;
  notifications: Notification[];
}

/** POST /grievances */
export interface Grievance {
  id: string;
  status: string;
  subject_type: string;
}
