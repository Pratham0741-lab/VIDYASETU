/**
 * The document-intelligence contract between the api and the ml service.
 *
 * HTTP endpoints on ML_BASE_URL (ML_MODE=real), all POST with a JSON body;
 * images travel base64-encoded:
 *   /v1/documents/quality      { image_base64 }                  -> QualityResult
 *   /v1/documents/classify     { image_base64 }                  -> ClassificationResult
 *   /v1/documents/extract      { image_base64, document_type? }  -> ExtractionResult
 *   /v1/documents/consistency  { extractions }                   -> ConsistencyResult
 *   /v1/documents/crop         { image_base64, x, y, width, height, margin } -> CropResult (Phase 13D)
 * document_type and the classifier's `value` are canonical document types
 * (INCOME_CERTIFICATE, CASTE_CERTIFICATE, ... - see
 * src/documents/document-types.ts), never checklist slot text. Implemented by
 * the ml service (ml/app/routes); with ML_MODE=mock the same interface is
 * served by MockMlService from documented fixtures.
 */
export interface QualityResult {
  /** usable: readable as a file at all; warnings: findings that never block OCR. */
  value: { usable: boolean; issues: string[]; warnings?: string[] };
  confidence: number;
  details: Record<string, unknown>;
}

export interface ClassificationResult {
  /** Document type. */
  value: string;
  confidence: number;
  alternatives: { type: string; confidence: number }[];
}

/**
 * Phase 13D: where a field was read, in the stored image's own pixel grid
 * (EXIF orientation undone). Single images: page 1.
 */
export interface FieldBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinate_space: string;
}

export interface ExtractionResult {
  value: Record<string, unknown>;
  /** Per-field confidence. */
  confidence: Record<string, number>;
  raw_text: string;
  /** Phase 13D (optional): per field, its box, or null when not tied to one place. */
  boxes?: Record<string, FieldBox | null>;
}

/** Phase 13D: the cropped region (PNG) and where it was cut from. */
export interface CropResult {
  png_base64: string;
  region: { x: number; y: number; width: number; height: number; page: number };
}

export interface ConsistencyResult {
  /** e.g. names_match, dob_match */
  value: Record<string, boolean>;
  confidence: Record<string, number>;
  details: Record<string, unknown>;
}

export const ML_DOCUMENT_PATHS = {
  quality: '/v1/documents/quality',
  classify: '/v1/documents/classify',
  extract: '/v1/documents/extract',
  consistency: '/v1/documents/consistency',
  crop: '/v1/documents/crop',
} as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const numRecord = (v: unknown) => isRecord(v) && Object.values(v).every(isNum);

/** Shape checks for ml responses: a malformed reply is an ml fault, not data. */
export const RESPONSE_SHAPES = {
  quality: (r: unknown): r is QualityResult =>
    isRecord(r) &&
    isRecord(r.value) &&
    typeof r.value.usable === 'boolean' &&
    Array.isArray(r.value.issues) &&
    r.value.issues.every((i) => typeof i === 'string') &&
    isNum(r.confidence) &&
    isRecord(r.details),
  classify: (r: unknown): r is ClassificationResult =>
    isRecord(r) &&
    typeof r.value === 'string' &&
    isNum(r.confidence) &&
    Array.isArray(r.alternatives) &&
    r.alternatives.every((a) => isRecord(a) && typeof a.type === 'string' && isNum(a.confidence)),
  extract: (r: unknown): r is ExtractionResult =>
    isRecord(r) && isRecord(r.value) && numRecord(r.confidence) && typeof r.raw_text === 'string',
  crop: (r: unknown): r is CropResult =>
    isRecord(r) && typeof r.png_base64 === 'string' && isRecord(r.region),
  consistency: (r: unknown): r is ConsistencyResult =>
    isRecord(r) &&
    isRecord(r.value) &&
    Object.values(r.value).every((b) => typeof b === 'boolean') &&
    numRecord(r.confidence) &&
    isRecord(r.details),
};
