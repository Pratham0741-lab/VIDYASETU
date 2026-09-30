import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AccessTokenClaims, actorFromClaims } from './actor';
import { IS_PUBLIC_KEY, RequestWithActor } from './decorators';
import { isAppRole } from './roles';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

function isClaims(value: unknown): value is AccessTokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  return (
    typeof c.sub === 'string' &&
    isAppRole(c.role) &&
    nullableString(c.officer_id) &&
    nullableString(c.jurisdiction_state) &&
    nullableString(c.jurisdiction_district)
  );
}

/**
 * Global guard #1: authentication. Verifies the Bearer access token
 * (HS256, issuer + audience + expiry, via JwtModule config) and attaches the
 * Actor to the request. Routes marked @Public() skip it and carry no actor.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'missing_token' } });
    }

    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync(token);
    } catch (err) {
      throw new AppError(ErrorCode.UNAUTHORIZED, {
        details: { reason: 'invalid_token' },
        cause: err,
      });
    }
    if (!isClaims(claims)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'invalid_token' } });
    }

    req.actor = actorFromClaims(claims);
    return true;
  }
}
