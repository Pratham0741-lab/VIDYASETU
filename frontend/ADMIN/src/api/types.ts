/**
 * Request types, taken from the generated OpenAPI schema (src/api/schema.ts,
 * `pnpm gen:api`). Do not hand-write request shapes here.
 */
import type { components, operations } from './schema';

type Schemas = components['schemas'];

export type ErrorResponseDto = Schemas['ErrorResponseDto'];
export type ErrorCode = ErrorResponseDto['code'];
export type LoginDto = Schemas['LoginDto'];
export type OfficerLanguageDto = Schemas['OfficerLanguageDto'];

// Scrutiny
export type VerifyDto = Schemas['VerifyDto'];
export type RejectDto = Schemas['RejectDto'];
export type MarkDefectiveDto = Schemas['MarkDefectiveDto'];
export type ConfirmDocumentDto = Schemas['ConfirmDocumentDto'];
export type IssueDeficiencyDto = Schemas['IssueDeficiencyDto'];
export type OfficerItemDto = Schemas['OfficerItemDto'];
export type BulkActionDto = Schemas['BulkActionDto'];
export type BulkAction = BulkActionDto['action'];

// Fraud
export type DispositionDto = Schemas['DispositionDto'];
export type Disposition = DispositionDto['status'];

// Selection
export type ApproveListDto = Schemas['ApproveListDto'];
export type OverrideEntryDto = Schemas['OverrideEntryDto'];
export type DecideObjectionDto = Schemas['DecideObjectionDto'];
export type CloseWindowEarlyDto = Schemas['CloseWindowEarlyDto'];

// Scheme Studio
export type CreateSchemeDto = Schemas['CreateSchemeDto'];
export type CreateDraftDto = Schemas['CreateDraftDto'];
export type UpdateDraftDto = Schemas['UpdateDraftDto'];
export type PublishVersionDto = Schemas['PublishVersionDto'];
export type PreviewVersionDto = Schemas['PreviewVersionDto'];
export type SchemeType = CreateSchemeDto['type'];
export type DisbursementMode = NonNullable<CreateSchemeDto['disbursement_mode']>;

// Query parameters
export type QueueQuery = NonNullable<operations['WorkflowController_queue']['parameters']['query']>;
export type AnalyticsQuery = NonNullable<operations['AnalyticsController_fraud']['parameters']['query']>;
export type DenialsQuery = NonNullable<operations['AuthorizationDenialsController_list']['parameters']['query']>;
export type DocumentAccessQuery = NonNullable<operations['DocumentAccessController_list']['parameters']['query']>;
export type FairnessQuery = operations['FairnessController_report']['parameters']['query'];
export type SelectionListsQuery = NonNullable<operations['SelectionListsController_index']['parameters']['query']>;
