/**
 * One function per backend route the student portal uses. Request bodies are
 * typed from the generated OpenAPI schema (./types); responses from
 * ./responses (not in OpenAPI yet).
 */
import { api, clearTokens, getRefreshToken, requestBlob, setTokens, upload } from './client';
import type {
  ConsentDto,
  CreateApplicationDto,
  LoginDto,
  RaiseGrievanceDto,
  RegisterDto,
  ResubmitDto,
  SaveApplicationDraftDto,
  UpdateProfileDto,
} from './types';
import type {
  ActiveSchemes,
  ApplicationHistory,
  ApplicantProfile,
  Application,
  ApplicationDocuments,
  ConsentState,
  CreatedApplication,
  DeficiencyList,
  DocumentDetail,
  DocumentsComplete,
  Draft,
  DraftSubmitResult,
  EligibilityCheck,
  FormSchema,
  Grievance,
  Me,
  NotificationList,
  RegisterResult,
  ResubmitResult,
  SelectionResult,
  TokenPair,
  TransitionResult,
  UploadResult,
} from './responses';

const enc = encodeURIComponent;

// ------------------------------------------------------------------ auth
export async function login(dto: LoginDto): Promise<void> {
  const tokens = await api.post<TokenPair>('/auth/login', dto, { auth: false });
  setTokens(tokens.access_token, tokens.refresh_token);
}

export function register(dto: RegisterDto) {
  return api.post<RegisterResult>('/auth/register', dto, { auth: false });
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

// ------------------------------------------------------------- applicant
export const getProfile = () => api.get<ApplicantProfile>('/applicants/me');
export const updateProfile = (dto: UpdateProfileDto) => api.patch<ApplicantProfile>('/applicants/me', dto);
export const getConsents = () => api.get<ConsentState>('/applicants/me/consents');
export const recordConsent = (dto: ConsentDto) => api.post<ConsentState>('/applicants/me/consents', dto);

// --------------------------------------------------------------- schemes
/** Public list of active scheme versions (60 per minute per IP: load once per page load). */
export const listSchemes = () => api.get<ActiveSchemes>('/schemes', { auth: false });

export const checkEligibility = (applicant: Record<string, unknown>) =>
  api.post<EligibilityCheck>('/schemes/check-eligibility', { applicant }, { auth: false });

export const getFormSchema = (code: string, version: number) =>
  api.get<FormSchema>(`/schemes/${enc(code)}/versions/${version}/form-schema`, { auth: false });

// ---------------------------------------------------------- applications
export const listApplications = () => api.get<Application[]>('/applications');
export const getApplication = (id: string) => api.get<Application>(`/applications/${enc(id)}`);
/** Stage history, oldest first (own application; 404 outside scope). */
export const getApplicationHistory = (id: string) => api.get<ApplicationHistory>(`/applications/${enc(id)}/history`);
export const createApplication = (dto: CreateApplicationDto) => api.post<CreatedApplication>('/applications', dto);

export const listDrafts = () => api.get<Draft[]>('/application-drafts');
export const createDraft = (dto: SaveApplicationDraftDto) => api.post<Draft>('/application-drafts', dto);
export const updateDraft = (id: string, dto: SaveApplicationDraftDto) =>
  api.patch<Draft>(`/application-drafts/${enc(id)}`, dto);
/** awaitDocuments: the application waits in SUBMITTED until its documents are uploaded and scanned. */
export const submitDraft = (id: string, awaitDocuments = false) =>
  api.post<DraftSubmitResult>(`/application-drafts/${enc(id)}/submit`, awaitDocuments ? { await_documents: true } : undefined);

// ------------------------------------------------------------- documents
export const uploadDocument = (applicationId: string, documentType: string, file: File) =>
  upload<UploadResult>(`/applications/${enc(applicationId)}/documents`, { document_type: documentType, file });
export const listDocuments = (applicationId: string) =>
  api.get<ApplicationDocuments>(`/applications/${enc(applicationId)}/documents`);
export const getDocument = (id: string) => api.get<DocumentDetail>(`/documents/${enc(id)}`);
/** After each scan settles: moves an application awaiting its documents on once they are all in (idempotent). */
export const completeDocuments = (applicationId: string) =>
  api.post<DocumentsComplete>(`/applications/${enc(applicationId)}/documents/complete`);

// ---------------------------------------------------------- deficiencies
export const listDeficiencies = (applicationId: string) =>
  api.get<DeficiencyList>(`/applications/${enc(applicationId)}/deficiencies`);
export const getDeficiencyCrop = (applicationId: string, itemId: string) =>
  requestBlob(`/applications/${enc(applicationId)}/deficiencies/items/${enc(itemId)}/crop`);
/** Resubmit a DEFECTIVE application without open itemised items (e.g. refused by the automatic gate). */
export const resubmitApplication = (applicationId: string, dto: ResubmitDto = {}) =>
  api.post<TransitionResult>(`/applications/${enc(applicationId)}/resubmit`, dto);
export const resubmitDeficiency = (applicationId: string, deficiencyId: string) =>
  api.post<ResubmitResult>(`/applications/${enc(applicationId)}/deficiencies/${enc(deficiencyId)}/resubmit`);

// ------------------------------------------------------ result, grievance
export const getSelectionResult = (applicationId: string) =>
  api.get<SelectionResult>(`/applications/${enc(applicationId)}/selection-result`);
export const raiseGrievance = (dto: RaiseGrievanceDto) => api.post<Grievance>('/grievances', dto);

// --------------------------------------------------------- notifications
export const listNotifications = () => api.get<NotificationList>('/notifications');
export const markNotificationRead = (id: string) =>
  api.post<{ id: string; read: boolean }>(`/notifications/${enc(id)}/read`);
