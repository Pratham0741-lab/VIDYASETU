import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { Actor } from './actor';
import type { AppRole } from './roles';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/**
 * Marks a route (or controller) as reachable without an access token.
 * Public routes never get an actor, so no actor transaction is opened.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Roles allowed on a route. Every non-public route MUST declare it:
 * RolesGuard denies routes without a role policy (fail closed).
 */
export const Roles = (...roles: AppRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export type RequestWithActor = Request & { actor?: Actor };

/** Injects the authenticated Actor (only valid on non-public routes). */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<RequestWithActor>().actor;
  if (!actor) {
    throw new AppError(ErrorCode.UNAUTHORIZED);
  }
  return actor;
});
