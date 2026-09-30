import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles, RequestWithActor } from '../auth/decorators';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { SCHEME_ADMIN_ROLE_CHOICES } from '../config/env.schema';

export type SchemeCapability = 'author' | 'publish';
const CAPABILITY_KEY = 'schemes:capability';

/**
 * Phase 14 loose ends (Part A): who may author and who may publish is
 * configuration (SCHEME_AUTHOR_ROLES / SCHEME_PUBLISHER_ROLES, default
 * SUPER_ADMIN and MINISTRY_OFFICER). The global RolesGuard admits every role
 * that could ever be configured (never APPLICANT or AUDITOR); this guard
 * then admits only the configured ones. A refusal is the same FORBIDDEN as
 * the RolesGuard's, so it is recorded as an authorization denial alike.
 */
@Injectable()
export class SchemeRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const capability = this.reflector.get<SchemeCapability>(CAPABILITY_KEY, context.getHandler());
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    const allowed =
      capability === 'publish'
        ? this.config.schemes.publisherRoles
        : this.config.schemes.authorRoles;
    if (!actor || !allowed.includes(actor.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        details: { reason: 'role_not_permitted', configured_by: `scheme_${capability}_roles` },
      });
    }
    return true;
  }
}

/** A scheme-administration write: role admitted by configuration. */
export const SchemeAdmin = (capability: SchemeCapability) =>
  applyDecorators(
    Roles(...(SCHEME_ADMIN_ROLE_CHOICES as readonly AppRole[])),
    SetMetadata(CAPABILITY_KEY, capability),
    UseGuards(SchemeRoleGuard),
  );
