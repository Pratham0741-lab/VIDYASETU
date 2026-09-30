/**
 * Request types, taken from the generated OpenAPI schema (src/api/schema.ts,
 * `pnpm gen:api`). Do not hand-write request shapes here.
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type ErrorResponseDto = Schemas['ErrorResponseDto'];
export type ErrorCode = ErrorResponseDto['code'];
export type RegisterDto = Schemas['RegisterDto'];
export type LoginDto = Schemas['LoginDto'];
export type RefreshTokenDto = Schemas['RefreshTokenDto'];
export type UpdateProfileDto = Schemas['UpdateProfileDto'];
export type ConsentDto = Schemas['ConsentDto'];
export type CheckEligibilityDto = Schemas['CheckEligibilityDto'];
export type CreateApplicationDto = Schemas['CreateApplicationDto'];
export type SaveApplicationDraftDto = Schemas['SaveApplicationDraftDto'];
export type ResubmitDto = Schemas['ResubmitDto'];
export type RaiseGrievanceDto = Schemas['RaiseGrievanceDto'];
