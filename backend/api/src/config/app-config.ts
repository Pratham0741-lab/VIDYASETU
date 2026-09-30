import { Env, envSchema, IntegrationMode, LogLevel, MlMode, NodeEnv } from './env.schema';

/** Typed, grouped application configuration. */
export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: LogLevel;
  cors: { origins: string[] };
  swagger: { enabled: boolean };
  http: { bodyLimit: string };
  database: { url: string };
  redis: { host: string; port: number; password: string | undefined };
  storage: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    documentsBucket: string;
  };
  ml: { baseUrl: string; timeoutMs: number; mode: MlMode };
  documents: {
    maxUploadBytes: number;
    /** Field-confidence threshold per document type; 'default' for the rest. */
    reviewThresholds: Readonly<Record<string, number>>;
    valueTolerance: number;
    consistencyMinConfidence: number;
    workerEnabled: boolean;
  };
  postSelection: { objectionWindowDays: number };
  deficiencies: {
    /** Default days to fix an item (a scheme version's config may override). */
    deadlineDays: number;
    /** Canonical document type -> validity in months. */
    validityMonths: Readonly<Record<string, number>>;
  };
  /** Phase 13D: languages an applicant may choose. */
  languages: { supported: readonly string[] };
  /** Phase 13E: committee approvals a list needs before publication. */
  selectionLists: { approvalsRequired: number };
  /** Phase 17 (B2): consent notice version and purposes. */
  consent: { noticeVersion: string; purposes: readonly string[]; required: readonly string[] };
  /** Phase 17 (C): data retention (days per class; 0 = never purged). */
  retention: {
    enabled: boolean;
    dryRun: boolean;
    intervalMs: number;
    notificationsDays: number;
    refreshTokensDays: number;
    draftsDays: number;
  };
  /** Phase 14 loose ends (Part B): the scheduled SLA breach sweep. */
  slaSweep: { enabled: boolean; intervalMs: number };
  /** Phase 14 loose ends (Part A): roles that may author / publish schemes. */
  schemes: { authorRoles: readonly string[]; publisherRoles: readonly string[] };
  fraud: {
    /** Base64 (the config object is deep-frozen; Buffers cannot be). */
    matchKeyBase64: string;
    surge: { windowDays: number; baselineWindows: number; multiple: number; minCount: number };
  };
  integrations: {
    digilocker: { mode: IntegrationMode };
    pfms: { mode: IntegrationMode; mockScenarios: Readonly<Record<string, string>> };
    nsp: { mode: IntegrationMode };
    aadhaar: { mode: IntegrationMode };
  };
  health: { timeoutMs: number };
  auth: { accessSecret: string; accessTtlSeconds: number; refreshTtlSeconds: number };
  mail: { smtpHost: string; smtpPort: number; from: string };
}

export interface InvalidVariable {
  variable: string;
  message: string;
}

export class ConfigValidationError extends Error {
  constructor(readonly invalidVariables: InvalidVariable[]) {
    super(
      `Invalid environment configuration: ${invalidVariables.map((v) => v.variable).join(', ')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Validates the raw environment and maps it into AppConfig.
 * Throws ConfigValidationError listing every failing variable (never values).
 */
export function validateEnv(source: EnvSource): AppConfig {
  const result = envSchema.validate(source, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
    convert: true,
    errors: { wrap: { label: false } },
  });

  if (result.error) {
    const invalidVariables = result.error.details.map((d) => ({
      variable: d.path.join('.'),
      message: d.message,
    }));
    throw new ConfigValidationError(invalidVariables);
  }

  return toAppConfig(result.value);
}

function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    cors: {
      origins: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    },
    swagger: { enabled: env.SWAGGER_ENABLED },
    http: { bodyLimit: env.BODY_LIMIT },
    database: { url: env.DATABASE_URL },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD === '' ? undefined : env.REDIS_PASSWORD,
    },
    storage: {
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      documentsBucket: env.MINIO_BUCKET_DOCUMENTS,
    },
    ml: {
      baseUrl: env.ML_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: env.ML_TIMEOUT_MS,
      mode: env.ML_MODE,
    },
    documents: {
      maxUploadBytes: env.UPLOAD_MAX_BYTES,
      reviewThresholds: JSON.parse(env.DOC_REVIEW_THRESHOLDS) as Record<string, number>,
      valueTolerance: env.DOC_VALUE_TOLERANCE,
      consistencyMinConfidence: env.DOC_CONSISTENCY_MIN_CONFIDENCE,
      workerEnabled: env.DOCUMENT_WORKER_ENABLED,
    },
    postSelection: { objectionWindowDays: env.OBJECTION_WINDOW_DAYS },
    deficiencies: {
      deadlineDays: env.DEFICIENCY_DEADLINE_DAYS,
      validityMonths: JSON.parse(env.DOCUMENT_VALIDITY_MONTHS) as Record<string, number>,
    },
    languages: { supported: env.SUPPORTED_LANGUAGES.split(',') },
    selectionLists: { approvalsRequired: env.SELECTION_LIST_APPROVALS_REQUIRED },
    consent: {
      noticeVersion: env.CONSENT_NOTICE_VERSION,
      purposes: env.CONSENT_PURPOSES.split(','),
      required: env.CONSENT_REQUIRED_PURPOSES.split(','),
    },
    retention: {
      enabled: env.RETENTION_ENABLED,
      dryRun: env.RETENTION_DRY_RUN,
      intervalMs: env.RETENTION_INTERVAL_MS,
      notificationsDays: env.RETENTION_NOTIFICATIONS_DAYS,
      refreshTokensDays: env.RETENTION_REFRESH_TOKENS_DAYS,
      draftsDays: env.RETENTION_DRAFTS_DAYS,
    },
    slaSweep: { enabled: env.SLA_SWEEP_ENABLED, intervalMs: env.SLA_SWEEP_INTERVAL_MS },
    schemes: {
      authorRoles: env.SCHEME_AUTHOR_ROLES.split(','),
      publisherRoles: env.SCHEME_PUBLISHER_ROLES.split(','),
    },
    fraud: {
      matchKeyBase64: env.FRAUD_MATCH_KEY,
      surge: {
        windowDays: env.FRAUD_SURGE_WINDOW_DAYS,
        baselineWindows: env.FRAUD_SURGE_BASELINE_WINDOWS,
        multiple: env.FRAUD_SURGE_MULTIPLE,
        minCount: env.FRAUD_SURGE_MIN_COUNT,
      },
    },
    integrations: {
      digilocker: { mode: env.DIGILOCKER_MODE },
      pfms: {
        mode: env.PFMS_MODE,
        mockScenarios: JSON.parse(env.PFMS_MOCK_SCENARIOS) as Record<string, string>,
      },
      nsp: { mode: env.NSP_MODE },
      aadhaar: { mode: env.AADHAAR_MODE },
    },
    health: { timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    },
    mail: { smtpHost: env.SMTP_HOST, smtpPort: env.SMTP_PORT, from: env.MAIL_FROM },
  };
}

/**
 * Startup entry point: validate or terminate. Logs exactly which variables
 * failed as a single JSON line on stderr (the pino logger does not exist
 * yet at this point), then exits non-zero.
 */
export function loadConfigOrExit(source: EnvSource): AppConfig {
  try {
    return validateEnv(source);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      process.stderr.write(
        `${JSON.stringify({
          level: 'fatal',
          time: Date.now(),
          msg: 'Invalid environment configuration; refusing to start',
          invalidVariables: err.invalidVariables,
        })}\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}
