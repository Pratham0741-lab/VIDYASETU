import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { FORBIDDEN_SEGMENTS } from '../rules-engine';

/** Limits on caller-supplied profile data (public route input). */
export const PROFILE_LIMITS = {
  maxKeys: 100,
  maxDepth: 3,
  maxStringLength: 1000,
  maxArrayLength: 50,
} as const;

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

type FieldError = { field: string; constraints: Record<string, string> };

/**
 * Validates and copies an applicant-shaped profile into null-prototype
 * objects: plain JSON values only (numbers, text, booleans, null, short
 * lists of those, nested objects up to maxDepth), identifier-shaped keys,
 * no __proto__/prototype/constructor keys. Anything else is a 400.
 */
export function sanitizeProfile(input: unknown, field = 'applicant'): Record<string, unknown> {
  const errors: FieldError[] = [];
  let keyCount = 0;

  const copy = (value: unknown, path: string, depth: number): unknown => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      errors.push({
        field: path,
        constraints: { finiteNumber: `${path} must be a finite number` },
      });
      return undefined;
    }
    if (typeof value === 'string') {
      if (value.length <= PROFILE_LIMITS.maxStringLength) return value;
      errors.push({ field: path, constraints: { maxLength: `${path} is too long` } });
      return undefined;
    }
    if (Array.isArray(value)) {
      if (value.length > PROFILE_LIMITS.maxArrayLength) {
        errors.push({ field: path, constraints: { arrayMaxSize: `${path} has too many items` } });
        return undefined;
      }
      return value.map((item, i) => {
        if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
          return copy(item, `${path}.${i}`, depth);
        }
        errors.push({
          field: `${path}.${i}`,
          constraints: { primitive: 'list items must be plain values' },
        });
        return undefined;
      });
    }
    if (typeof value === 'object') {
      if (depth >= PROFILE_LIMITS.maxDepth) {
        errors.push({ field: path, constraints: { maxDepth: `${path} is nested too deeply` } });
        return undefined;
      }
      const out = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = `${path}.${key}`;
        if (++keyCount > PROFILE_LIMITS.maxKeys) {
          errors.push({ field: path, constraints: { maxKeys: 'profile has too many fields' } });
          break;
        }
        if (!KEY.test(key) || FORBIDDEN_SEGMENTS.has(key)) {
          errors.push({
            field: childPath,
            constraints: { key: 'field names must be identifiers' },
          });
          continue;
        }
        out[key] = copy(child, childPath, depth + 1);
      }
      return out;
    }
    errors.push({ field: path, constraints: { type: `${path} has an unsupported type` } });
    return undefined;
  };

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    errors.push({ field, constraints: { isObject: `${field} must be an object` } });
  }
  const result = errors.length === 0 ? (copy(input, field, 0) as Record<string, unknown>) : null;
  if (errors.length > 0 || !result) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, { details: errors });
  }
  return result;
}
