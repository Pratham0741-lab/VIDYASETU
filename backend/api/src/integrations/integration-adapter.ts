import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { IntegrationMode } from '../config/env.schema';

export interface AdapterAvailability {
  available: boolean;
  mode: IntegrationMode;
}

/**
 * The shape every external-system adapter implements (Phase 10): DigiLocker,
 * PFMS, NSP. Each adds its own operation(s); each is chosen once, by its
 * <NAME>_MODE setting (default 'mock', the ML_MODE precedent), in
 * IntegrationsModule - callers inject the abstract class and never see which
 * implementation they got.
 *
 * Error contract, the same for all:
 *   - the service is down / unreachable / not configured -> DEPENDENCY_UNAVAILABLE (503);
 *   - a refusal of the external system's own making the caller can act on
 *     gets a specific code (DIGILOCKER_*, INSUFFICIENT_BALANCE);
 *   - an outcome that is data, not failure (a document not found, a
 *     duplicate NSP record, a failed payment status) is RETURNED, not thrown,
 *     where the caller decides what it means.
 */
export interface IntegrationAdapter {
  /** Short system name: 'digilocker' | 'pfms' | 'nsp'. */
  readonly service: string;
  checkAvailability(): Promise<AdapterAvailability>;
}

/**
 * MODE=real in this build: no government endpoint is reachable (each needs
 * partner onboarding - OAuth client, DSC-signed payment files, agency
 * credentials), so the real adapter fails closed: unavailable, and every
 * operation raises DEPENDENCY_UNAVAILABLE. No API contract is invented.
 */
export function notConfigured(service: string): AppError {
  return new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
    details: { service, reason: 'integration_not_configured', mode: 'real' },
  });
}
