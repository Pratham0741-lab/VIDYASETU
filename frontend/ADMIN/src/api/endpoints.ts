/**
 * One function per backend route the officer portal uses. Request bodies and
 * query parameters are typed from the generated OpenAPI schema (./types);
 * responses from ./responses (not in OpenAPI yet).
 */
import { api, clearTokens, getRefreshToken, requestBlob, setTokens } from './client';
import type {
  AnalyticsQuery,
  ApproveListDto,
  CreateDraftDto,
  CreateSchemeDto,
  PublishVersionDto,
  UpdateDraftDto,
  BulkActionDto,
  CloseWindowEarlyDto,
  ConfirmDocumentDto,
  DecideObjectionDto,
  DenialsQuery,
  DispositionDto,
  DocumentAccessQuery,
  FairnessQuery,
  IssueDeficiencyDto,
  LoginDto,
  MarkDefectiveDto,
  OfficerLanguageDto,
  OverrideEntryDto,
  QueueQuery,
  RejectDto,
  SelectionListsQuery,
  VerifyDto,
} from './types';
import type {
  AnalyticsView,
  ApplicationHistory,
  ApplicationDetail,
  ApplicationDocuments,
  AuditVerifyReport,
  AuthorizationDenial,
  BulkResult,
  DeficiencyIssueResult,
  DeficiencyList,
  DocumentAccess,
  DocumentView,
  FraudAnalytics,
  FraudFlag,
  FraudFlags,
  ListObjections,
  Me,
  OfficerPreferences,
  PreviewResult,
  PublishResult,
  SchemeDiff,
  SchemeList,
  SchemeSummary,
  SchemeVersionDetail,
  SchemeVersionFull,
  ValidateResult,
  QueueResponse,
  SelectionList,
  SelectionListDetail,
  TokenPair,
  TransitionResult,
} from './responses';

const enc = encodeURIComponent;

/** Query objects -> string values (undefined entries are dropped by the client). */
function q(obj: object | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k] = v === undefined || v === null ? undefined : String(v);
  return out;
}

// ------------------------------------------------------------------ auth
export async function login(dto: LoginDto): Promise<void> {
  const tokens = await api.post<TokenPair>('/auth/login', dto, { auth: false });
  setTokens(tokens.access_token, tokens.refresh_token);
}

/** Revokes the refresh token on the server (best effort) and forgets both tokens. */
export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  clearTokens();
  if (!refresh) return;
  try {
    await api.post<void>('/auth/logout', { refresh_token: refresh }, { auth: false });
  } catch {
    // Already revoked or server unreachable: the local session is gone anyway.
  }
}

export const getMe = () => api.get<Me>('/auth/me');
export const getPreferences = () => api.get<OfficerPreferences>('/officers/me/preferences');
export const setPreferences = (dto: OfficerLanguageDto) => api.put<OfficerPreferences>('/officers/me/preferences', dto);

// -------------------------------------------------------------- scrutiny
export const getQueue = (query?: QueueQuery) => api.get<QueueResponse>('/applications/queue', { query: q(query) });
/** Applications visible to the caller (own jurisdiction; newest first; at most 100). */
export const listApplications = () => api.get<ApplicationDetail[]>('/applications');
export const getApplication = (id: string) => api.get<ApplicationDetail>(`/applications/${enc(id)}`);
export const listDocuments = (id: string) => api.get<ApplicationDocuments>(`/applications/${enc(id)}/documents`);
/** The stored file (JPEG, PNG, WebP or PDF) as a Blob; reviewer roles in jurisdiction (404 otherwise). */
export const getDocumentFile = (id: string) => requestBlob(`/documents/${enc(id)}/file`);
export const getDocument = (id: string) => api.get<DocumentView>(`/documents/${enc(id)}`);
export const confirmDocument = (id: string, dto: ConfirmDocumentDto) =>
  api.post<DocumentView & { remarks: string | null }>(`/documents/${enc(id)}/confirm`, dto);

export const verifyApplication = (id: string, dto: VerifyDto) =>
  api.post<TransitionResult>(`/applications/${enc(id)}/verify`, dto);
export const rejectApplication = (id: string, dto: RejectDto) =>
  api.post<TransitionResult>(`/applications/${enc(id)}/reject`, dto);
export const markDefective = (id: string, dto: MarkDefectiveDto) =>
  api.post<TransitionResult>(`/applications/${enc(id)}/mark-defective`, dto);

/** Stage history (stages, action, time; no officer or reason). */
export const getApplicationHistory = (id: string) => api.get<ApplicationHistory>(`/applications/${enc(id)}/history`);
export const listDeficiencies = (id: string) => api.get<DeficiencyList>(`/applications/${enc(id)}/deficiencies`);
export const issueDeficiency = (id: string, dto: IssueDeficiencyDto) =>
  api.post<DeficiencyIssueResult>(`/applications/${enc(id)}/deficiencies`, dto);

export const bulkAction = (dto: BulkActionDto) => api.post<BulkResult>('/applications/bulk-actions', dto);

// ----------------------------------------------------------------- fraud
export const getFraudFlags = (id: string) => api.get<FraudFlags>(`/applications/${enc(id)}/fraud-flags`);
export const runFraudChecks = (id: string) => api.post<FraudFlags>(`/applications/${enc(id)}/fraud-checks`);
export const disposeFlag = (flagId: string, dto: DispositionDto) =>
  api.post<FraudFlag>(`/fraud-flags/${enc(flagId)}/disposition`, dto);

// ------------------------------------------------------------- selection
export const listSelectionLists = (query?: SelectionListsQuery) =>
  api.get<{ lists: SelectionList[] }>('/selection-lists', { query: q(query) });
export const getSelectionList = (id: string) => api.get<SelectionListDetail>(`/selection-lists/${enc(id)}`);
export const approveList = (id: string, dto: ApproveListDto) => api.post<unknown>(`/selection-lists/${enc(id)}/approve`, dto);
export const overrideEntry = (id: string, entryId: string, dto: OverrideEntryDto) =>
  api.post<unknown>(`/selection-lists/${enc(id)}/entries/${enc(entryId)}/override`, dto);
export const publishProvisional = (id: string) => api.post<unknown>(`/selection-lists/${enc(id)}/publish-provisional`);
export const decideObjection = (id: string, grievanceId: string, dto: DecideObjectionDto) =>
  api.post<unknown>(`/selection-lists/${enc(id)}/objections/${enc(grievanceId)}/decide`, dto);
export const closeWindow = (id: string) => api.post<unknown>(`/selection-lists/${enc(id)}/close-objection-window`);
export const closeWindowEarly = (id: string, dto: CloseWindowEarlyDto) =>
  api.post<unknown>(`/selection-lists/${enc(id)}/close-objection-window-early`, dto);
export const publishFinal = (id: string) => api.post<unknown>(`/selection-lists/${enc(id)}/publish-final`);
/** Objections to a list: ids, status and dates only (committee and list readers). */
export const listObjections = (id: string) => api.get<ListObjections>(`/selection-lists/${enc(id)}/objections`);

// ----------------------------------------------------------------- audit
export const verifyAuditChain = () => api.get<AuditVerifyReport>('/audit/verify');
export const listDenials = (query?: DenialsQuery) =>
  api.get<{ denials: AuthorizationDenial[] }>('/authorization-denials', { query: q(query) });
export const listDocumentAccess = (query?: DocumentAccessQuery) =>
  api.get<{ accesses: DocumentAccess[] }>('/document-access', { query: q(query) });

// ------------------------------------------------------------- analytics
export const getFraudAnalytics = (query: AnalyticsQuery) => api.get<FraudAnalytics>('/analytics/fraud', { query: q(query) });
export type AnalyticsName = 'funnel' | 'sla' | 'verification-quality';
export const getAnalytics = (name: AnalyticsName, query: AnalyticsQuery) =>
  api.get<AnalyticsView>(`/analytics/${name}`, { query: q(query) });
/** Fairness is per scheme and academic year (no date window). */
export const getFairness = (query: FairnessQuery) => api.get<AnalyticsView>('/analytics/fairness', { query: q(query) });

// --------------------------------------------------------- scheme studio
const schemePath = (code: string) => `/admin/schemes/${enc(code)}`;
const versionPath = (code: string, v: number) => `${schemePath(code)}/versions/${v}`;
export const listSchemes = () => api.get<SchemeList>('/admin/schemes');
export const createScheme = (dto: CreateSchemeDto) => api.post<SchemeSummary>('/admin/schemes', dto);
export const getSchemeVersion = (code: string, v: number) => api.get<SchemeVersionDetail>(versionPath(code, v));
export const createSchemeDraft = (code: string, dto: CreateDraftDto) =>
  api.post<SchemeVersionFull>(`${schemePath(code)}/versions`, dto);
export const updateSchemeDraft = (code: string, v: number, dto: UpdateDraftDto) =>
  api.patch<SchemeVersionFull>(versionPath(code, v), dto);
export const validateSchemeVersion = (code: string, v: number) => api.post<ValidateResult>(`${versionPath(code, v)}/validate`);
export const previewSchemeVersion = (code: string, v: number, applicant: Record<string, unknown>) =>
  api.post<PreviewResult>(`${versionPath(code, v)}/preview`, { applicant });
export const publishSchemeVersion = (code: string, v: number, dto: PublishVersionDto) =>
  api.post<PublishResult>(`${versionPath(code, v)}/publish`, dto);
export const retireSchemeVersion = (code: string, v: number) =>
  api.post<SchemeVersionFull>(`${versionPath(code, v)}/retire`);
export const diffSchemeVersions = (code: string, from: number, to: number) =>
  api.get<SchemeDiff>(`${schemePath(code)}/diff`, { query: { from: String(from), to: String(to) } });

export { clearTokens };
