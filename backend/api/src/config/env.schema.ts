import Joi from 'joi';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 'mock': documented mock fixtures (MockMlService); 'real': the ml service over HTTP. */
export const ML_MODES = ['mock', 'real'] as const;
export type MlMode = (typeof ML_MODES)[number];

/**
 * Integration adapters (Phase 10), same precedent as ML_MODE: 'mock' =
 * documented in-process mock; 'real' = the external service (not configured
 * in this build: the adapter reports unavailable and fails closed).
 */
export const INTEGRATION_MODES = ['mock', 'real'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/** Raw, validated environment. Only config/ code sees this shape. */
export interface Env {
  NODE_ENV: NodeEnv;
  API_PORT: number;
  LOG_LEVEL: LogLevel;
  CORS_ORIGINS: string;
  SWAGGER_ENABLED: boolean;
  BODY_LIMIT: string;

  DATABASE_URL: string;

  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD: string;

  MINIO_ENDPOINT: string;
  MINIO_PORT: number;
  MINIO_USE_SSL: boolean;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET_DOCUMENTS: string;

  ML_BASE_URL: string;
  ML_TIMEOUT_MS: number;
  ML_MODE: MlMode;

  UPLOAD_MAX_BYTES: number;
  DOC_REVIEW_THRESHOLDS: string;
  DOC_VALUE_TOLERANCE: number;
  DOC_CONSISTENCY_MIN_CONFIDENCE: number;
  DOCUMENT_WORKER_ENABLED: boolean;
  SLA_SWEEP_ENABLED: boolean;
  SLA_SWEEP_INTERVAL_MS: number;

  OBJECTION_WINDOW_DAYS: number;

  DEFICIENCY_DEADLINE_DAYS: number;
  SUPPORTED_LANGUAGES: string;
  SELECTION_LIST_APPROVALS_REQUIRED: number;
  SCHEME_AUTHOR_ROLES: string;
  CONSENT_NOTICE_VERSION: string;
  CONSENT_PURPOSES: string;
  CONSENT_REQUIRED_PURPOSES: string;
  RETENTION_ENABLED: boolean;
  RETENTION_DRY_RUN: boolean;
  RETENTION_INTERVAL_MS: number;
  RETENTION_NOTIFICATIONS_DAYS: number;
  RETENTION_REFRESH_TOKENS_DAYS: number;
  RETENTION_DRAFTS_DAYS: number;
  SCHEME_PUBLISHER_ROLES: string;
  DOCUMENT_VALIDITY_MONTHS: string;

  DIGILOCKER_MODE: IntegrationMode;
  PFMS_MODE: IntegrationMode;
  NSP_MODE: IntegrationMode;
  AADHAAR_MODE: IntegrationMode;
  PFMS_MOCK_SCENARIOS: string;

  FRAUD_MATCH_KEY: string;
  FRAUD_SURGE_WINDOW_DAYS: number;
  FRAUD_SURGE_BASELINE_WINDOWS: number;
  FRAUD_SURGE_MULTIPLE: number;
  FRAUD_SURGE_MIN_COUNT: number;

  HEALTH_CHECK_TIMEOUT_MS: number;

  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_SECONDS: number;

  SMTP_HOST: string;
  SMTP_PORT: number;
  MAIL_FROM: string;
}

/** Comma-separated list of explicit http(s) origins. Wildcards are rejected. */
const corsOrigins = Joi.string()
  .trim()
  .custom((value: string, helpers) => {
    const origins = value
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (origins.length === 0) {
      return helpers.message({ custom: '{{#label}} must list at least one origin' });
    }
    for (const origin of origins) {
      if (origin.includes('*')) {
        return helpers.message({ custom: '{{#label}} must not contain wildcards' });
      }
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return helpers.message({ custom: '{{#label}} must contain only valid http(s) origins' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        return helpers.message({
          custom:
            '{{#label}} entries must be bare origins like https://example.gov.in (no path or trailing slash)',
        });
      }
    }
    return value;
  });

/**
 * JSON object of per-document-type field-confidence thresholds in [0, 1],
 * with a required "default", e.g. {"default":0.85,"Family Income Certificate":0.9}.
 */
const reviewThresholds = Joi.string().custom((value: string, helpers) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return helpers.message({ custom: '{{#label}} must be a JSON object' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return helpers.message({ custom: '{{#label}} must be a JSON object' });
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.some(([k]) => k === 'default')) {
    return helpers.message({ custom: '{{#label}} must contain a "default" threshold' });
  }
  for (const [, v] of entries) {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) {
      return helpers.message({ custom: '{{#label}} thresholds must be numbers in [0, 1]' });
    }
  }
  return value;
});

/**
 * JSON object: canonical document type -> validity in whole months, e.g.
 * {"INCOME_CERTIFICATE":12}. A type not listed has no validity check.
 */
const validityMonths = Joi.string().custom((value: string, helpers) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return helpers.message({ custom: '{{#label}} must be a JSON object' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return helpers.message({ custom: '{{#label}} must be a JSON object' });
  }
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      !/^[A-Z][A-Z_]+$/.test(k) ||
      !Number.isInteger(v) ||
      (v as number) < 1 ||
      (v as number) > 240
    ) {
      return helpers.message({
        custom: '{{#label}} maps UPPER_CASE document types to whole months (1-240)',
      });
    }
  }
  return value;
});

// S3 bucket naming rules (lowercase, digits, dots, hyphens; 3-63 chars).
/** Officer roles that may administer schemes (never APPLICANT or the read-only AUDITOR). */
export const SCHEME_ADMIN_ROLE_CHOICES = [
  'SUPER_ADMIN',
  'MINISTRY_OFFICER',
  'STATE_NODAL_OFFICER',
  'DISTRICT_NODAL_OFFICER',
  'INSTITUTE_NODAL_OFFICER',
  'COMMITTEE',
] as const;

const schemeRoleList = Joi.string().custom((value: string, helpers) => {
  const roles = value.split(',').map((r) => r.trim());
  const bad = roles.filter((r) => !(SCHEME_ADMIN_ROLE_CHOICES as readonly string[]).includes(r));
  if (roles.length === 0 || bad.length > 0) {
    return helpers.message({
      custom: `{{#label}} must be a comma list of ${SCHEME_ADMIN_ROLE_CHOICES.join(', ')} (got ${bad.join(', ') || 'nothing'})`,
    });
  }
  return roles.join(',');
});

const bucketName = Joi.string().pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);

export const envSchema = Joi.object<Env, true>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVS)
    .default('development'),
  API_PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
  CORS_ORIGINS: corsOrigins.required(),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  BODY_LIMIT: Joi.string()
    .pattern(/^\d+(b|kb|mb)$/i)
    .default('1mb'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  MINIO_ENDPOINT: Joi.string().hostname().required(),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().min(3).required(),
  MINIO_SECRET_KEY: Joi.string().min(8).required(),
  MINIO_BUCKET_DOCUMENTS: bucketName.required(),

  ML_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  ML_TIMEOUT_MS: Joi.number().integer().min(100).max(120_000).default(5000),
  ML_MODE: Joi.string()
    .valid(...ML_MODES)
    .default('mock'),

  // Document intelligence (Phase 7).
  UPLOAD_MAX_BYTES: Joi.number()
    .integer()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  DOC_REVIEW_THRESHOLDS: reviewThresholds.default('{"default":0.85}'),
  // Relative tolerance between an extracted number and the value used in eligibility.
  DOC_VALUE_TOLERANCE: Joi.number().min(0).max(1).default(0.05),
  // A consistency result below this confidence is UNCERTAIN, not a clean pass/fail.
  DOC_CONSISTENCY_MIN_CONFIDENCE: Joi.number().min(0).max(1).default(0.8),
  DOCUMENT_WORKER_ENABLED: Joi.boolean().default(true),
  // Phase 14 loose ends (Part B): the scheduled SLA breach sweep (BullMQ
  // repeatable job). false: no scheduler and no worker (the e2e environment,
  // which has no Redis); the manual sweep route still works.
  SLA_SWEEP_ENABLED: Joi.boolean().default(true),
  SLA_SWEEP_INTERVAL_MS: Joi.number().integer().min(10_000).max(86_400_000).default(900_000),

  // Post-selection (Phase 9): days after a selection run completes during
  // which objections are open and confirmation needs an override.
  OBJECTION_WINDOW_DAYS: Joi.number().integer().min(0).max(365).default(15),

  // Deficiency loop (Phase 13C): the default days an applicant has to fix a
  // deficiency item (a scheme version's config may set its own), and how old
  // a certificate may be, per canonical document type.
  DEFICIENCY_DEADLINE_DAYS: Joi.number().integer().min(1).max(365).default(15),
  DOCUMENT_VALIDITY_MONTHS: validityMonths.default('{"INCOME_CERTIFICATE":12}'),

  // Phase 13D: languages an applicant may choose (ISO 639 codes; must include
  // en). A language without notification texts falls back to English.
  SUPPORTED_LANGUAGES: Joi.string()
    .pattern(/^[a-z]{2,3}(,[a-z]{2,3})*$/)
    .custom((v: string, helpers) =>
      v.split(',').includes('en') ? v : helpers.message({ custom: '{{#label}} must include en' }),
    )
    .default('en,hi,sat'),

  // Phase 13E: committee approvals a provisional list needs before it can be
  // published (distinct committee members, given after the last override).
  SELECTION_LIST_APPROVALS_REQUIRED: Joi.number().integer().min(1).max(20).default(1),

  // Phase 14 loose ends (Part A): who may author (create schemes, draft and
  // edit versions) and who may publish / retire them. Comma lists of officer
  // roles; AUDITOR is read-only and APPLICANT has no scheme administration.
  // Phase 17 (B2): consent. The notice version the applicant must have
  // consented to; every purpose offered; those an application needs.
  CONSENT_NOTICE_VERSION: Joi.string()
    .pattern(/^[A-Za-z0-9._-]{1,40}$/)
    .default('2026-10-v1'),
  CONSENT_PURPOSES: Joi.string()
    .pattern(/^[a-z][a-z_]{2,40}(,[a-z][a-z_]{2,40})*$/)
    .default('application_processing,government_verification,notifications'),
  CONSENT_REQUIRED_PURPOSES: Joi.string()
    .pattern(/^[a-z][a-z_]{2,40}(,[a-z][a-z_]{2,40})*$/)
    .default('application_processing,government_verification'),
  // Phase 17 (C): data retention. The scheduled purge is OFF by default and,
  // when on, a dry run (counts only) unless RETENTION_DRY_RUN=false. Days per
  // data class; 0 = that class is never purged.
  RETENTION_ENABLED: Joi.boolean().default(false),
  RETENTION_DRY_RUN: Joi.boolean().default(true),
  RETENTION_INTERVAL_MS: Joi.number().integer().min(60_000).max(604_800_000).default(86_400_000),
  RETENTION_NOTIFICATIONS_DAYS: Joi.number().integer().min(0).max(3650).default(365),
  RETENTION_REFRESH_TOKENS_DAYS: Joi.number().integer().min(0).max(3650).default(30),
  RETENTION_DRAFTS_DAYS: Joi.number().integer().min(0).max(3650).default(180),
  SCHEME_AUTHOR_ROLES: schemeRoleList.default('SUPER_ADMIN,MINISTRY_OFFICER'),
  SCHEME_PUBLISHER_ROLES: schemeRoleList.default('SUPER_ADMIN,MINISTRY_OFFICER'),

  // Integration adapters (Phase 10): default mock, like ML_MODE.
  DIGILOCKER_MODE: Joi.string()
    .valid(...INTEGRATION_MODES)
    .default('mock'),
  PFMS_MODE: Joi.string()
    .valid(...INTEGRATION_MODES)
    .default('mock'),
  NSP_MODE: Joi.string()
    .valid(...INTEGRATION_MODES)
    .default('mock'),
  // Phase 14 loose ends (Part E): Aadhaar authentication. real is not
  // configured in this build and fails closed (never falls back to mock).
  AADHAAR_MODE: Joi.string()
    .valid(...INTEGRATION_MODES)
    .default('mock'),
  // PFMS mock only: JSON {application_no: scenario}; unlisted -> SUCCESS.
  PFMS_MOCK_SCENARIOS: Joi.string()
    .custom((value: string) => {
      const parsed: unknown = JSON.parse(value);
      const ok =
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((v) =>
          ['SUCCESS', 'INSUFFICIENT_BALANCE', 'ACCOUNT_INVALID', 'TIMEOUT', 'PENDING'].includes(
            v as string,
          ),
        );
      if (!ok) throw new Error('must be a JSON object of application_no -> PFMS mock scenario');
      return value;
    })
    .default('{}'),

  HEALTH_CHECK_TIMEOUT_MS: Joi.number().integer().min(100).max(30_000).default(3000),

  // HS256 signing key for access tokens: at least 32 characters.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),

  // Fraud detection (Phase 11). HMAC key for the exact-match index: a 32-byte
  // base64 secret, separate from PII_ENCRYPTION_KEY (never the same value).
  FRAUD_MATCH_KEY: Joi.string()
    .base64()
    .custom((value: string) => {
      if (Buffer.from(value, 'base64').length !== 32) throw new Error('must decode to 32 bytes');
      return value;
    })
    .required(),
  // Institution surge: current window vs the median of the preceding windows.
  FRAUD_SURGE_WINDOW_DAYS: Joi.number().integer().min(1).max(90).default(7),
  FRAUD_SURGE_BASELINE_WINDOWS: Joi.number().integer().min(2).max(52).default(8),
  FRAUD_SURGE_MULTIPLE: Joi.number().min(1.5).max(20).default(3),
  FRAUD_SURGE_MIN_COUNT: Joi.number().integer().min(2).max(1000).default(5),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: Joi.number().integer().min(3600).max(2_592_000).default(604_800),

  // TODO(notifications phase): consumed by the mailer; validated now so the
  // compose wiring to Mailpit is checked from day one.
  SMTP_HOST: Joi.string().hostname().default('mailpit'),
  SMTP_PORT: Joi.number().port().default(1025),
  MAIL_FROM: Joi.string().email({ tlds: false }).default('no-reply@vidyasetu.local'),
});
