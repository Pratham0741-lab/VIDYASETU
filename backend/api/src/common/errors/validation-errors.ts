import type { ValidationError } from 'class-validator';
import { AppError } from './app-error';
import { ErrorCode } from './error-code.enum';

export interface FieldError {
  /** Dotted path to the offending field, e.g. "address.pincode" or "items.0.name". */
  field: string;
  /** Constraint name -> message, e.g. { isEmail: "email must be an email" }. */
  constraints: Record<string, string>;
}

/**
 * Flattens class-validator's nested ValidationError tree into field-level
 * entries suitable for the `details` array of a VALIDATION_ERROR response.
 *
 * TODO(i18n): constraint messages come from class-validator in English; map
 * constraint names to message keys when i18n lands.
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints && Object.keys(error.constraints).length > 0) {
      result.push({ field, constraints: { ...error.constraints } });
    }
    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }
  return result;
}

/** exceptionFactory for the global ValidationPipe. */
export function validationExceptionFactory(errors: ValidationError[]): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, {
    details: flattenValidationErrors(errors),
  });
}
