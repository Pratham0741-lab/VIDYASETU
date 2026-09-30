import { Readable } from 'node:stream';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminService } from '../src/admin/admin.service';
import { EligibilityService } from '../src/schemes/eligibility.service';
import { WorkflowService } from '../src/workflow/workflow.service';
import { SelectionService } from '../src/selection/selection.service';
import { DocumentsService } from '../src/documents/documents.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { DisbursementService } from '../src/post-selection/disbursement.service';
import { GrievanceService } from '../src/post-selection/grievance.service';
import { RenewalService } from '../src/post-selection/renewal.service';
import { SanctionService } from '../src/post-selection/sanction.service';
import { AppModule } from '../src/app.module';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { AuditService } from '../src/audit/audit.service';
import { BulkActionsService } from '../src/bulk-actions/bulk-actions.service';
import { DeficienciesService } from '../src/deficiencies/deficiencies.service';
import { ApplicantsService } from '../src/applicants/applicants.service';
import { SelectionListsService } from '../src/selection-lists/selection-lists.service';
import { FairnessService } from '../src/fairness/fairness.service';
import { SchemeAuthoringService } from '../src/schemes/scheme-authoring.service';
import { SlaSweepService } from '../src/workflow/sla-sweep.service';
import { OfficerPreferencesService } from '../src/officers/officer-preferences';
import { PrivacyService } from '../src/privacy/privacy.service';
import { RetentionService } from '../src/retention/retention.service';
import { ApplicationHistoryService } from '../src/applications/application-history';
import { MeService } from '../src/auth/me';
import { DocumentAccessService } from '../src/documents/document-access';
import { ApplicationDraftsService } from '../src/applications/application-drafts.service';
import { AadhaarAuthenticationService } from '../src/integrations/aadhaar/aadhaar-authentication.service';
import { SelectionReviewService } from '../src/selection-review/selection-review.service';
import { FraudReviewService } from '../src/fraud/fraud.controller';
import { FraudDetectionService } from '../src/fraud/fraud-detection.service';
import { NspCheckService } from '../src/integrations/nsp/nsp-check.controller';
import { AuthorizationDenialsService } from '../src/authorization-denials/authorization-denials.controller';
import { configureApp } from '../src/app.setup';
import { ApplicationsService } from '../src/applications/applications.service';
import type { AccessTokenClaims, Actor } from '../src/auth/actor';
import { IS_PUBLIC_KEY } from '../src/auth/decorators';
import { ALL_ROLES, AppRole } from '../src/auth/roles';
import { RequestContext } from '../src/common/context/request-context';
import { ActorTransactionRunner } from '../src/database/actor-transaction.runner';
import { TEST_ENV } from './support/create-test-app';

// ---------------------------------------------------------------------------
// The matrix: every protected route x every role (eight since Phase 13B), spelled out.
// ---------------------------------------------------------------------------
type Outcome = 'allow' | 'deny';
const A: Outcome = 'allow';
const D: Outcome = 'deny';

const APP_ID = '5b0f8a3e-2a1c-4d8b-9e7f-0a1b2c3d4e5f';

interface RouteSpec {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  body?: Record<string, unknown>;
  /** Multipart upload: form fields + one file. */
  file?: { fields: Record<string, string>; name: string; content: Buffer; contentType: string };
  okStatus: number;
  matrix: Record<AppRole, Outcome>;
}

const ROUTES: Record<string, RouteSpec> = {
  'GET /api/v1/auth/me': {
    method: 'get',
    path: '/api/v1/auth/me',
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/admin/officers': {
    method: 'post',
    path: '/api/v1/admin/officers',
    body: {
      email: 'new.officer@example.org',
      password: 'Str0ng-Passphrase',
      name: 'New Officer',
      role: 'DISTRICT_NODAL_OFFICER',
      jurisdiction_state: 'Jharkhand',
      jurisdiction_district: 'Ranchi',
    },
    okStatus: 201,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications': {
    method: 'get',
    path: '/api/v1/applications',
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'POST /api/v1/applications': {
    method: 'post',
    path: '/api/v1/applications',
    body: { scheme_version_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', academic_year: '2026-27' },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'POST /api/v1/applications/:id/evaluate-eligibility': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/evaluate-eligibility`,
    body: { declared: { degree_enrolled: 'PhD' } },
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/assign-to-me': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/assign-to-me`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/queue': {
    method: 'get',
    path: '/api/v1/applications/queue',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/sla-breaches': {
    method: 'get',
    path: '/api/v1/applications/sla-breaches',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/sla-status': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/sla-status`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/verify': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/verify`,
    body: { remarks: 'Documents checked.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/reject': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/reject`,
    body: { remarks: 'Not a resident of the state.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/mark-defective': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/mark-defective`,
    body: {
      code: 'DEF_INCOME_EXPIRED',
      title: 'Income certificate expired',
      description: 'x',
      remarks: 'Certificate expired before the application date.',
    },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/resubmit': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/resubmit`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/schemes/:code/academic-years/:year/run-selection': {
    method: 'post',
    path: '/api/v1/schemes/NFST/academic-years/2026-27/run-selection',
    body: { dry_run: true },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/documents': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/documents`,
    file: {
      fields: { document_type: 'Family Income Certificate' },
      name: 'income.pdf',
      content: Buffer.from('%PDF-1.4 matrix'),
      contentType: 'application/pdf',
    },
    okStatus: 202,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/documents/complete': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/documents/complete`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/documents': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/documents`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/documents/:id': {
    method: 'get',
    path: `/api/v1/documents/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/documents/:id/confirm': {
    method: 'post',
    path: `/api/v1/documents/${APP_ID}/confirm`,
    body: {
      corrections: { certificate_number: 'JH-INC-2026-0042' },
      remarks: 'Read from the original certificate.',
    },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/authorization-denials': {
    method: 'get',
    path: '/api/v1/authorization-denials',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/applications/:id/nsp-duplicate-check': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/nsp-duplicate-check`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/fraud/backfill': {
    method: 'post',
    path: '/api/v1/fraud/backfill',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/fraud-flags': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/fraud-flags`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'POST /api/v1/applications/:id/fraud-checks': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/fraud-checks`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/fraud-flags/:id/disposition': {
    method: 'post',
    path: `/api/v1/fraud-flags/${APP_ID}/disposition`,
    body: { status: 'FALSE_POSITIVE', notes: 'Checked against the originals.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/analytics/funnel': {
    method: 'get',
    path: '/api/v1/analytics/funnel?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/funnel/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/funnel/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/sla': {
    method: 'get',
    path: '/api/v1/analytics/sla?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/sla/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/sla/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/schemes': {
    method: 'get',
    path: '/api/v1/analytics/schemes?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/schemes/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/schemes/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/disbursements': {
    method: 'get',
    path: '/api/v1/analytics/disbursements?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/disbursements/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/disbursements/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fraud': {
    method: 'get',
    path: '/api/v1/analytics/fraud?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fraud/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/fraud/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/jurisdiction': {
    method: 'get',
    path: '/api/v1/analytics/jurisdiction?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/jurisdiction/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/jurisdiction/export.csv?from=2026-04-01&to=2027-04-01',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/audit/verify': {
    method: 'get',
    path: '/api/v1/audit/verify',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/selections': {
    method: 'get',
    path: '/api/v1/selections?scheme=NOS&academic_year=2026-27',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/bulk-actions': {
    method: 'post',
    path: '/api/v1/applications/bulk-actions',
    body: { action: 'VERIFY', application_ids: [APP_ID], dry_run: true },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  // Phase 13C: the deficiency loop.
  'POST /api/v1/applications/:id/deficiencies': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/deficiencies`,
    body: { reason: 'Income certificate is older than 12 months.', dry_run: true },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/deficiencies': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/deficiencies`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/applications/:id/deficiencies/items/:itemId/crop': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/deficiencies/items/${APP_ID}/crop`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/deficiencies/:deficiencyId/resubmit': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/deficiencies/${APP_ID}/resubmit`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  // Phase 13D: the applicant's own profile.
  'GET /api/v1/applicants/me': {
    method: 'get',
    path: '/api/v1/applicants/me',
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'PATCH /api/v1/applicants/me': {
    method: 'patch',
    path: '/api/v1/applicants/me',
    body: { preferred_language: 'hi' },
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  // Phase 13E: committee review, publication and the final list.
  'GET /api/v1/selection-lists': {
    method: 'get',
    path: `/api/v1/selection-lists`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/selection-lists/:id': {
    method: 'get',
    path: `/api/v1/selection-lists/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/selection-lists/:id/approve': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/approve`,
    body: {},
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/entries/:entryId/override': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/entries/${APP_ID}/override`,
    body: { decision: 'EXCLUDE', reason: 'Documents found forged on re-check.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/publish-provisional': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/publish-provisional`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/objections/:grievanceId/decide': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/objections/${APP_ID}/decide`,
    body: { outcome: 'DISMISSED', reason: 'Rank is correct as computed.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/close-objection-window': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/close-objection-window`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/close-objection-window-early': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/close-objection-window-early`,
    body: { reason: 'All objections were heard on 30 Sep.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selection-lists/:id/publish-final': {
    method: 'post',
    path: `/api/v1/selection-lists/${APP_ID}/publish-final`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/selection-result': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/selection-result`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  // Phase 13E: fairness data.
  'GET /api/v1/analytics/fairness': {
    method: 'get',
    path: '/api/v1/analytics/fairness?scheme=NFST&academic_year=2031-32',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fairness/export.csv': {
    method: 'get',
    path: '/api/v1/analytics/fairness/export.csv?scheme=NFST&academic_year=2031-32',
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/notifications': {
    method: 'get',
    path: '/api/v1/notifications',
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/notifications/:id/read': {
    method: 'post',
    path: `/api/v1/notifications/${APP_ID}/read`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selections/:id/confirm': {
    method: 'post',
    path: `/api/v1/selections/${APP_ID}/confirm`,
    body: { override_reason: 'Committee sign-off' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/selections/:id/sanction-order': {
    method: 'post',
    path: `/api/v1/selections/${APP_ID}/sanction-order`,
    okStatus: 201,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/sanction-orders/:id': {
    method: 'get',
    path: `/api/v1/sanction-orders/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/sanction-orders/:id/pdf': {
    method: 'get',
    path: `/api/v1/sanction-orders/${APP_ID}/pdf`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/sanction-orders/verify': {
    method: 'post',
    path: '/api/v1/sanction-orders/verify',
    body: { content: { sanction_order_id: APP_ID } },
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/selections/:id/disbursements': {
    method: 'post',
    path: `/api/v1/selections/${APP_ID}/disbursements`,
    okStatus: 201,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/disbursements': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/disbursements`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/disbursements/:id/initiate': {
    method: 'post',
    path: `/api/v1/disbursements/${APP_ID}/initiate`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/disbursements/:id/reconcile': {
    method: 'post',
    path: `/api/v1/disbursements/${APP_ID}/reconcile`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/renewals': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/renewals`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applications/:id/renewals': {
    method: 'post',
    path: `/api/v1/applications/${APP_ID}/renewals`,
    body: {
      academic_year: '2027-28',
      academic_year_number: 2,
      passed_previous_year: true,
      progress_report: 'Chapter 2 complete.',
    },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/renewals/:id/endorse': {
    method: 'post',
    path: `/api/v1/renewals/${APP_ID}/endorse`,
    body: { remarks: 'Endorsed.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/renewals/:id/continuation-check': {
    method: 'post',
    path: `/api/v1/renewals/${APP_ID}/continuation-check`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/renewals/:id/decide': {
    method: 'post',
    path: `/api/v1/renewals/${APP_ID}/decide`,
    body: { decision: 'APPROVE' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/grievances': {
    method: 'post',
    path: '/api/v1/grievances',
    body: {
      application_id: APP_ID,
      subject_type: 'APPLICATION',
      description: 'Stipend not received.',
    },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/grievances': {
    method: 'get',
    path: '/api/v1/grievances',
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/grievances/:id': {
    method: 'get',
    path: `/api/v1/grievances/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'POST /api/v1/grievances/:id/start': {
    method: 'post',
    path: `/api/v1/grievances/${APP_ID}/start`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/grievances/:id/resolve': {
    method: 'post',
    path: `/api/v1/grievances/${APP_ID}/resolve`,
    body: { outcome: 'RESOLVED', note: 'Paid in full through PFMS.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/admin/schemes': {
    method: 'get',
    path: `/api/v1/admin/schemes`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/admin/schemes': {
    method: 'post',
    path: `/api/v1/admin/schemes`,
    body: { code: 'NEW_SCHEME', name: 'New scheme', department: 'Dept', type: 'CENTRAL_SECTOR' },
    okStatus: 201,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/admin/schemes/:code/diff': {
    method: 'get',
    path: `/api/v1/admin/schemes/NFST/diff?from=4&to=5`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/admin/schemes/:code/versions/:version': {
    method: 'get',
    path: `/api/v1/admin/schemes/NFST/versions/5`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'POST /api/v1/admin/schemes/:code/versions': {
    method: 'post',
    path: `/api/v1/admin/schemes/NFST/versions`,
    body: { based_on_version: 5 },
    okStatus: 201,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'PATCH /api/v1/admin/schemes/:code/versions/:version': {
    method: 'patch',
    path: `/api/v1/admin/schemes/NFST/versions/6`,
    body: { source_url: 'x' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/admin/schemes/:code/versions/:version/validate': {
    method: 'post',
    path: `/api/v1/admin/schemes/NFST/versions/6/validate`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/admin/schemes/:code/versions/:version/preview': {
    method: 'post',
    path: `/api/v1/admin/schemes/NFST/versions/6/preview`,
    body: { applicant: {} },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/admin/schemes/:code/versions/:version/publish': {
    method: 'post',
    path: `/api/v1/admin/schemes/NFST/versions/6/publish`,
    body: {},
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/admin/schemes/:code/versions/:version/retire': {
    method: 'post',
    path: `/api/v1/admin/schemes/NFST/versions/5/retire`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/sla-breaches/recorded': {
    method: 'get',
    path: `/api/v1/applications/sla-breaches/recorded`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'POST /api/v1/applications/sla-breaches/sweep': {
    method: 'post',
    path: `/api/v1/applications/sla-breaches/sweep`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/application-drafts': {
    method: 'post',
    path: `/api/v1/application-drafts`,
    body: { academic_year: '2026-27' },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/application-drafts': {
    method: 'get',
    path: `/api/v1/application-drafts`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/application-drafts/:id': {
    method: 'get',
    path: `/api/v1/application-drafts/${APP_ID}`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'PATCH /api/v1/application-drafts/:id': {
    method: 'patch',
    path: `/api/v1/application-drafts/${APP_ID}`,
    body: { course_year: 2 },
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/application-drafts/:id/submit': {
    method: 'post',
    path: `/api/v1/application-drafts/${APP_ID}/submit`,
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applicants/me/aadhaar-authentication': {
    method: 'post',
    path: `/api/v1/applicants/me/aadhaar-authentication`,
    body: { aadhaar_number: '0999 0000 0017', consent: true },
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applicants/me/aadhaar-authentication': {
    method: 'get',
    path: `/api/v1/applicants/me/aadhaar-authentication`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/analytics/funnel/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/funnel/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/funnel/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/funnel/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/sla/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/sla/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/sla/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/sla/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/schemes/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/schemes/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/schemes/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/schemes/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/disbursements/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/disbursements/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/disbursements/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/disbursements/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fraud/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/fraud/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fraud/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/fraud/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/jurisdiction/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/jurisdiction/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/jurisdiction/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/jurisdiction/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/workload': {
    method: 'get',
    path: `/api/v1/analytics/workload?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/workload/export.csv': {
    method: 'get',
    path: `/api/v1/analytics/workload/export.csv?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/workload/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/workload/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/workload/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/workload/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/verification-quality': {
    method: 'get',
    path: `/api/v1/analytics/verification-quality?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/verification-quality/export.csv': {
    method: 'get',
    path: `/api/v1/analytics/verification-quality/export.csv?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/verification-quality/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/verification-quality/export.xlsx?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/verification-quality/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/verification-quality/export.pdf?from=2026-04-01&to=2027-04-01`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fairness/export.xlsx': {
    method: 'get',
    path: `/api/v1/analytics/fairness/export.xlsx?scheme=NFST&academic_year=2031-32`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/analytics/fairness/export.pdf': {
    method: 'get',
    path: `/api/v1/analytics/fairness/export.pdf?scheme=NFST&academic_year=2031-32`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'GET /api/v1/officers/me/preferences': {
    method: 'get',
    path: `/api/v1/officers/me/preferences`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
  'PUT /api/v1/officers/me/preferences': {
    method: 'put',
    path: `/api/v1/officers/me/preferences`,
    body: { preferred_language: 'hi' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: D,
    },
  },
  'PUT /api/v1/admin/officers/:id/preferences': {
    method: 'put',
    path: `/api/v1/admin/officers/${APP_ID}/preferences`,
    body: { preferred_language: 'hi' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applicants/me/consents': {
    method: 'get',
    path: `/api/v1/applicants/me/consents`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applicants/me/consents': {
    method: 'post',
    path: `/api/v1/applicants/me/consents`,
    body: {
      purpose: 'application_processing',
      status: 'GIVEN',
      notice_version: '2026-10-v1',
      language: 'en',
    },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applicants/me/data-export': {
    method: 'get',
    path: `/api/v1/applicants/me/data-export`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applicants/me/correction-requests': {
    method: 'post',
    path: `/api/v1/applicants/me/correction-requests`,
    body: { field: 'first_name', value: 'Asha', reason: 'Spelling differs from my certificate.' },
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applicants/me/correction-requests': {
    method: 'get',
    path: `/api/v1/applicants/me/correction-requests`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/applicants/me/erasure-requests': {
    method: 'post',
    path: `/api/v1/applicants/me/erasure-requests`,
    okStatus: 201,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applicants/me/erasure-requests': {
    method: 'get',
    path: `/api/v1/applicants/me/erasure-requests`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/correction-requests': {
    method: 'get',
    path: `/api/v1/correction-requests`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'POST /api/v1/correction-requests/:id/decide': {
    method: 'post',
    path: `/api/v1/correction-requests/${APP_ID}/decide`,
    body: { decision: 'REJECT', reason: 'The certificate shows the stored spelling.' },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'POST /api/v1/admin/retention/run': {
    method: 'post',
    path: `/api/v1/admin/retention/run`,
    body: { dry_run: true },
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/admin/retention/runs': {
    method: 'get',
    path: `/api/v1/admin/retention/runs`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: D,
      STATE_NODAL_OFFICER: D,
      DISTRICT_NODAL_OFFICER: D,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  'GET /api/v1/document-access': {
    method: 'get',
    path: `/api/v1/document-access`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: A,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: D,
      COMMITTEE: D,
      AUDITOR: A,
    },
  },
  // Phase 17.2: portal read routes.
  'GET /api/v1/documents/:id/file': {
    method: 'get',
    path: `/api/v1/documents/${APP_ID}/file`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/applications/:id/history': {
    method: 'get',
    path: `/api/v1/applications/${APP_ID}/history`,
    okStatus: 200,
    matrix: {
      APPLICANT: A,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: D,
      AUDITOR: D,
    },
  },
  'GET /api/v1/selection-lists/:id/objections': {
    method: 'get',
    path: `/api/v1/selection-lists/${APP_ID}/objections`,
    okStatus: 200,
    matrix: {
      APPLICANT: D,
      SUPER_ADMIN: D,
      MINISTRY_OFFICER: A,
      STATE_NODAL_OFFICER: A,
      DISTRICT_NODAL_OFFICER: A,
      INSTITUTE_NODAL_OFFICER: A,
      COMMITTEE: A,
      AUDITOR: A,
    },
  },
};

// A representative, valid identity per role (jurisdiction shape matches role).
const CLAIMS: Record<AppRole, AccessTokenClaims> = {
  APPLICANT: {
    sub: 'a0000000-0000-4000-8000-000000000001',
    role: AppRole.APPLICANT,
    officer_id: null,
    jurisdiction_state: null,
    jurisdiction_district: null,
  },
  SUPER_ADMIN: {
    sub: 'a0000000-0000-4000-8000-000000000002',
    role: AppRole.SUPER_ADMIN,
    officer_id: 'b0000000-0000-4000-8000-000000000002',
    jurisdiction_state: null,
    jurisdiction_district: null,
  },
  MINISTRY_OFFICER: {
    sub: 'a0000000-0000-4000-8000-000000000003',
    role: AppRole.MINISTRY_OFFICER,
    officer_id: 'b0000000-0000-4000-8000-000000000003',
    jurisdiction_state: null,
    jurisdiction_district: null,
  },
  STATE_NODAL_OFFICER: {
    sub: 'a0000000-0000-4000-8000-000000000004',
    role: AppRole.STATE_NODAL_OFFICER,
    officer_id: 'b0000000-0000-4000-8000-000000000004',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: null,
  },
  DISTRICT_NODAL_OFFICER: {
    sub: 'a0000000-0000-4000-8000-000000000005',
    role: AppRole.DISTRICT_NODAL_OFFICER,
    officer_id: 'b0000000-0000-4000-8000-000000000005',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
  },
  INSTITUTE_NODAL_OFFICER: {
    sub: 'a0000000-0000-4000-8000-000000000006',
    role: AppRole.INSTITUTE_NODAL_OFFICER,
    officer_id: 'b0000000-0000-4000-8000-000000000006',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
  },
  COMMITTEE: {
    sub: 'a0000000-0000-4000-8000-000000000007',
    role: AppRole.COMMITTEE,
    officer_id: 'b0000000-0000-4000-8000-000000000007',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
  },
  AUDITOR: {
    sub: 'a0000000-0000-4000-8000-000000000008',
    role: AppRole.AUDITOR,
    officer_id: 'b0000000-0000-4000-8000-000000000008',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: null,
  },
};

type Principal = AppRole | 'ANONYMOUS';
const PRINCIPALS: Principal[] = [...ALL_ROLES, 'ANONYMOUS'];

/** Every route that needs no login (Phase 17.2 adds GET /api/v1/schemes). */
const PUBLIC_ROUTES = [
  'GET /health/live',
  'GET /health/ready',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'GET /api/v1/schemes',
  'POST /api/v1/schemes/check-eligibility',
  'POST /api/v1/schemes/:code/versions/:version/check-eligibility',
  'GET /api/v1/schemes/:code/versions/:version/form-schema',
];

const CASES = Object.entries(ROUTES).flatMap(([route, spec]) =>
  PRINCIPALS.map((principal) => {
    const expected =
      principal === 'ANONYMOUS' ? ('unauthenticated' as const) : spec.matrix[principal];
    return { route, spec, principal, expected };
  }),
);

describe('RBAC role-permission matrix (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const run = jest.fn(<T>(actor: Actor, _ip: string | null, work: () => Promise<T>) =>
    RequestContext.run({ ...(RequestContext.current() ?? { requestId: '' }), actor }, work),
  );

  beforeAll(async () => {
    const view = { id: APP_ID };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ env: TEST_ENV }), DiscoveryModule],
    })
      .overrideProvider(ActorTransactionRunner)
      .useValue({ run })
      .overrideProvider(ApplicationsService)
      .useValue({
        list: () => Promise.resolve([view]),
        get: () => Promise.resolve(view),
        getForCaller: () => Promise.resolve(view),
        create: () => Promise.resolve(view),
        assignToMe: () => Promise.resolve(view),
      })
      .overrideProvider(EligibilityService)
      .useValue({ evaluateApplication: () => Promise.resolve({ outcome: 'ELIGIBLE' }) })
      .overrideProvider(WorkflowService)
      .useValue({
        queue: () => Promise.resolve({ applications: [view] }),
        findBreached: () => Promise.resolve({ applications: [view] }),
        slaStatus: () => Promise.resolve({ application_id: APP_ID }),
        act: () => Promise.resolve({ application: view }),
      })
      .overrideProvider(SelectionService)
      .useValue({ run: () => Promise.resolve({ selected: [] }) })
      .overrideProvider(DocumentsService)
      .useValue({
        upload: () => Promise.resolve({ status: 'PROCESSING', document_id: 'x' }),
        list: () => Promise.resolve({ documents: [] }),
        complete: () => Promise.resolve({ advanced: false }),
        get: () => Promise.resolve({ document_id: 'x' }),
        confirm: () => Promise.resolve({ document_id: 'x' }),
        file: () =>
          Promise.resolve({
            stream: Readable.from([Buffer.from('x')]),
            mime_type: 'image/png',
            id: 'x',
          }),
      })
      .overrideProvider(NotificationsService)
      .useValue({
        list: () => Promise.resolve({ count: 0, notifications: [] }),
        markRead: () => Promise.resolve({ read: true }),
      })
      .overrideProvider(SanctionService)
      .useValue({
        confirm: () => Promise.resolve({}),
        generate: () => Promise.resolve({}),
        get: () => Promise.resolve({}),
        pdf: () => Promise.resolve(Buffer.from('%PDF-1.4 matrix')),
        verify: () => Promise.resolve({ match: true }),
      })
      .overrideProvider(DisbursementService)
      .useValue({
        createSchedule: () => Promise.resolve({}),
        list: () => Promise.resolve([]),
        initiate: () => Promise.resolve({}),
        reconcile: () => Promise.resolve({}),
      })
      .overrideProvider(RenewalService)
      .useValue({
        listForApplication: () => Promise.resolve({}),
        submit: () => Promise.resolve({}),
        endorse: () => Promise.resolve({}),
        continuationCheck: () => Promise.resolve({}),
        decide: () => Promise.resolve({}),
      })
      .overrideProvider(GrievanceService)
      .useValue({
        raise: () => Promise.resolve({}),
        list: () => Promise.resolve([]),
        // An objection: the only grievance kind COMMITTEE may open.
        get: () => Promise.resolve({ subject_type: 'SELECTION_OBJECTION' }),
        start: () => Promise.resolve({}),
        resolve: () => Promise.resolve({}),
      })
      .overrideProvider(AuthorizationDenialsService)
      .useValue({ list: () => Promise.resolve({ denials: [] }) })
      .overrideProvider(NspCheckService)
      .useValue({ check: () => Promise.resolve({ duplicate_found: false, matches: [] }) })
      .overrideProvider(FraudReviewService)
      .useValue({
        flagsFor: () => Promise.resolve({ flags: [] }),
        runChecks: () => Promise.resolve({ flags: [] }),
        disposition: () => Promise.resolve({}),
      })
      // The hold guard's service: no application found -> the guard passes through.
      .overrideProvider(FraudDetectionService)
      .useValue({
        facts: () => Promise.resolve(null),
        runForApplication: () => Promise.resolve({ new_flags: 0, surge: null }),
        holdingFlags: () => Promise.resolve([]),
        backfill: () => Promise.resolve({ applications: 0, new_flags: 0 }),
        onTransition: () => Promise.resolve(),
      })
      .overrideProvider(BulkActionsService)
      .useValue({ run: () => Promise.resolve({ items: [] }) })
      .overrideProvider(AadhaarAuthenticationService)
      .useValue({
        authenticate: () => Promise.resolve({ authentication: null }),
        latest: () => Promise.resolve({ authentication: null }),
      })
      .overrideProvider(ApplicationDraftsService)
      .useValue({
        create: () => Promise.resolve({ id: 'd' }),
        list: () => Promise.resolve([]),
        get: () => Promise.resolve({ id: 'd' }),
        update: () => Promise.resolve({ id: 'd' }),
        submit: () => Promise.resolve({ draft: { id: 'd' } }),
      })
      .overrideProvider(PrivacyService)
      .useValue({
        consents: () => Promise.resolve({ purposes: [] }),
        recordConsent: () => Promise.resolve({ purposes: [] }),
        dataExport: () => Promise.resolve({ profile: {} }),
        fileCorrection: () => Promise.resolve({ id: 'c' }),
        corrections: () => Promise.resolve({ requests: [] }),
        requestErasure: () => Promise.resolve({ id: 'e' }),
        erasureRequests: () => Promise.resolve({ requests: [] }),
        correctionQueue: () => Promise.resolve({ requests: [] }),
        decideCorrection: () => Promise.resolve({ id: 'c' }),
        missingForSubmission: () => Promise.resolve([]),
      })
      .overrideProvider(OfficerPreferencesService)
      .useValue({
        mine: () => Promise.resolve({ preferred_language: 'en' }),
        setMine: () => Promise.resolve({ preferred_language: 'hi' }),
        set: () => Promise.resolve({ preferred_language: 'hi' }),
      })
      .overrideProvider(DocumentAccessService)
      .useValue({
        record: () => Promise.resolve(),
        list: () => Promise.resolve({ accesses: [] }),
      })
      .overrideProvider(RetentionService)
      .useValue({
        run: () => Promise.resolve({ counts: {} }),
        runs: () => Promise.resolve({ runs: [] }),
      })
      .overrideProvider(SlaSweepService)
      .useValue({
        sweep: () => Promise.resolve({ breaches: [] }),
        recorded: () => Promise.resolve({ breaches: [] }),
      })
      .overrideProvider(SchemeAuthoringService)
      .useValue({
        list: () => Promise.resolve({ schemes: [] }),
        createScheme: () => Promise.resolve({ ok: true }),
        diff: () => Promise.resolve({ changes: [] }),
        getVersion: () => Promise.resolve({ ok: true }),
        createDraft: () => Promise.resolve({ ok: true }),
        updateDraft: () => Promise.resolve({ ok: true }),
        validate: () => Promise.resolve({ valid: true }),
        preview: () => Promise.resolve({ ok: true }),
        publish: () => Promise.resolve({ ok: true }),
        retire: () => Promise.resolve({ ok: true }),
      })
      .overrideProvider(FairnessService)
      .useValue({
        report: () => Promise.resolve({ ok: true }),
        csv: () => Promise.resolve('csv'),
        table: () => Promise.resolve({ meta: {}, table: { columns: ['a'], rows: [] } }),
      })
      .overrideProvider(SelectionListsService)
      .useValue({
        lists: () => Promise.resolve({ ok: true }),
        get: () => Promise.resolve({ ok: true }),
        approve: () => Promise.resolve({ ok: true }),
        override: () => Promise.resolve({ ok: true }),
        decideObjection: () => Promise.resolve({ ok: true }),
        publishProvisional: () => Promise.resolve({ ok: true }),
        closeWindow: () => Promise.resolve({ ok: true }),
        publishFinal: () => Promise.resolve({ ok: true }),
        result: () => Promise.resolve({ ok: true }),
        createForRun: () => Promise.resolve('list'),
        objections: () => Promise.resolve({ selection_list_id: 'x', objections: [] }),
      })
      .overrideProvider(ApplicationHistoryService)
      .useValue({ history: () => Promise.resolve({ application_id: 'x', history: [] }) })
      .overrideProvider(MeService)
      .useValue({ me: (actor: unknown) => Promise.resolve(actor) })
      .overrideProvider(ApplicantsService)
      .useValue({
        me: () => Promise.resolve({ applicant_id: 'x' }),
        update: () => Promise.resolve({ applicant_id: 'x', changed_fields: [] }),
      })
      .overrideProvider(DeficienciesService)
      .useValue({
        issue: () => Promise.resolve({ dry_run: true, items: [] }),
        list: () => Promise.resolve({ deficiencies: [] }),
        resubmit: () => Promise.resolve({ resubmitted: false, items: [] }),
        crop: () => Promise.resolve(Buffer.from('png')),
        openItemised: () => Promise.resolve({ app: null, deficiencyId: null }),
        assertUploadAllowed: () => Promise.resolve(),
        markResubmitted: () => Promise.resolve(0),
      })
      .overrideProvider(SelectionReviewService)
      .useValue({ list: () => Promise.resolve({ selections: [], objections: [] }) })
      .overrideProvider(AuditService)
      .useValue({ verify: () => Promise.resolve({ ok: true }) })
      .overrideProvider(AnalyticsService)
      .useValue({
        funnel: () =>
          Promise.resolve({ steps: [], current: {}, held: { count: 0 }, state_dbt: { count: 0 } }),
        sla: () => Promise.resolve({ stages: [] }),
        schemes: () => Promise.resolve({ schemes: [] }),
        disbursements: () =>
          Promise.resolve({ scheduled: [], by_status: [], handled_by_state: [] }),
        fraud: () =>
          Promise.resolve({
            application_flags: [],
            institution_flags: [],
            held_applications: { by_stage: [] },
          }),
        jurisdiction: () =>
          Promise.resolve({ rows: [], states: [], meta: { group_by: 'district' } }),
        workload: () => Promise.resolve({ meta: {}, actions: [], queues: [] }),
        verificationQuality: () => Promise.resolve({ meta: {}, rows: [] }),
      })
      .overrideProvider(AdminService)
      .useValue({ provisionOfficer: () => Promise.resolve({ officer_id: 'x' }) })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => run.mockClear());

  it('covers exactly the set of non-public routes the app exposes', () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);
    const discovered = new Set<string>();

    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (methodPath === undefined) continue;
        if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype])) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const path = `/${base}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '');
        discovered.add(`${method} ${path}`);
      }
    }

    expect([...discovered].sort()).toEqual(Object.keys(ROUTES).sort());
  });

  // Phase 17.2: the matrix covers non-public routes; this pins the public ones, so a route
  // cannot become public (no login, no role check) without this list changing too.
  it('exposes exactly these public routes', () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);
    const pub = new Set<string>();
    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (methodPath === undefined) continue;
        if (!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype])) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        pub.add(`${method} ${`/${base}/${methodPath}`.replace(/\/+/g, '/').replace(/\/$/, '')}`);
      }
    }
    expect([...pub].sort()).toEqual(PUBLIC_ROUTES.slice().sort());
  });

  it(`enumerates ${CASES.length} cases (${Object.keys(ROUTES).length} routes x ${PRINCIPALS.length} principals)`, () => {
    expect(CASES).toHaveLength(Object.keys(ROUTES).length * PRINCIPALS.length);
  });

  it.each(CASES)('$route as $principal -> $expected', async ({ spec, principal, expected }) => {
    let req = request(app.getHttpServer())[spec.method](spec.path);
    if (principal !== 'ANONYMOUS') {
      req = req.set('Authorization', `Bearer ${jwt.sign({ ...CLAIMS[principal] })}`);
    }
    if (spec.body) req = req.send(spec.body);
    if (spec.file) {
      for (const [k, v] of Object.entries(spec.file.fields)) req = req.field(k, v);
      req = req.attach('file', spec.file.content, {
        filename: spec.file.name,
        contentType: spec.file.contentType,
      });
    }
    const res = await req;

    if (expected === 'allow') {
      expect(res.status).toBe(spec.okStatus);
      // Allowed requests run inside exactly one actor transaction.
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0].role).toBe(principal);
    } else if (expected === 'deny') {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(run).not.toHaveBeenCalled(); // rejected before any transaction opens
    } else {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(run).not.toHaveBeenCalled();
    }
  });

  describe('token validation', () => {
    const path = '/api/v1/auth/me';
    const claims = CLAIMS.DISTRICT_NODAL_OFFICER;

    it('rejects a token signed with a different secret', async () => {
      const forged = new JwtService({
        secret: 'another-secret-that-is-at-least-32-chars',
        signOptions: { issuer: 'vidyasetu-api', audience: 'vidyasetu-api' },
      }).sign({ ...claims });
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const expired = jwt.sign({ ...claims }, { expiresIn: -10 });
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body.details).toEqual({ reason: 'invalid_token' });
    });

    it('rejects a tampered payload (role escalation attempt)', async () => {
      const [header, , signature] = jwt.sign({ ...CLAIMS.APPLICANT }).split('.');
      const escalated = Buffer.from(JSON.stringify({ ...CLAIMS.SUPER_ADMIN })).toString(
        'base64url',
      );
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/officers')
        .set('Authorization', `Bearer ${header}.${escalated}.${signature}`)
        .send(ROUTES['POST /api/v1/admin/officers'].body);
      expect(res.status).toBe(401);
    });

    it('rejects a validly signed token carrying an unknown role', async () => {
      const bogus = jwt.sign({ ...claims, role: 'ROOT' });
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${bogus}`);
      expect(res.status).toBe(401);
    });
  });
});
