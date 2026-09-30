import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { IS_PUBLIC_KEY, RequestWithActor, ROLES_KEY } from './decorators';
import type { AppRole } from './roles';

/**
 * Global guard #2: authorization. Runs after JwtAuthGuard.
 * Fails closed: a non-public route without @Roles() is denied for everyone,
 * so a forgotten decorator can never expose a route.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    if (!actor) {
      throw new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'missing_token' } });
    }

    const allowed = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, targets);
    if (!allowed || allowed.length === 0) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_role_policy' } });
    }
    if (!allowed.includes(actor.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'role_not_permitted' } });
    }
    return true;
  }
}
