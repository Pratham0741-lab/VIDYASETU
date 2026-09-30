import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims } from './actor';
import { LoginDto, RegisterDto } from './dto';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { generateRefreshToken, hashRefreshToken } from './refresh-tokens';
import { unsupportedLanguage } from '../applicants/applicants.service';
import { AppRole, isAppRole } from './roles';

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

// Phase 17 (M45): applicants has row-level security and these flows run
// before an actor exists, so whether an account is an applicant comes from
// applicant_id_for_account() (the id only), not from an include.
const IDENTITY_INCLUDE = {
  officer: { include: { role: true } },
} satisfies Prisma.AccountInclude;

type AccountWithIdentity = Prisma.AccountGetPayload<{ include: typeof IDENTITY_INCLUDE }>;

function invalidCredentials(): AppError {
  // One reason for unknown email, wrong password and inactive account alike.
  return new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'invalid_credentials' } });
}

/**
 * Public auth flows (register, login, refresh, logout). These run before an
 * actor exists, so they use the base PrismaService, not an actor
 * transaction. The one RLS-protected table they touch is applicants:
 * registration inserts the row as its new owner (the transaction sets the
 * actor to the new account), login / refresh ask applicant_id_for_account().
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  /** Applicant self-registration: account + applicant row in one transaction. */
  async register(dto: RegisterDto): Promise<{ account_id: string; applicant_id: string }> {
    const email = dto.email.trim().toLowerCase();
    const dob = parseDateOfBirth(dto.dob);
    // Phase 13D: the same supported-language list as the profile route.
    if (
      dto.preferred_language !== undefined &&
      !this.config.languages.supported.includes(dto.preferred_language)
    ) {
      throw unsupportedLanguage(this.config.languages.supported);
    }
    if (dto.disability_percentage !== undefined && dto.is_disabled !== true) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'disability_percentage',
            constraints: { requiresDisability: 'disability_percentage requires is_disabled: true' },
          },
        ],
      });
    }
    const passwordHash = await hashPassword(dto.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: { email, password_hash: passwordHash },
          select: { id: true },
        });
        // The applicant row is inserted by its owner: RLS (M45) checks user_id.
        await tx.$executeRaw`SELECT set_config('app.actor_id', ${account.id}, true), set_config('app.actor_role', 'APPLICANT', true)`;
        // PII is plaintext here; the PII extension encrypts it on write.
        const applicant = await tx.applicant.create({
          data: {
            user_id: account.id,
            email,
            first_name: dto.first_name,
            last_name: dto.last_name,
            phone: dto.phone,
            category: dto.category,
            domicile_state: dto.domicile_state,
            domicile_district: dto.domicile_district,
            caste_cert_number: dto.caste_cert_number as unknown as Uint8Array<ArrayBuffer>,
            income: dto.annual_income as unknown as Uint8Array<ArrayBuffer>,
            bank_account: dto.bank_account as unknown as Uint8Array<ArrayBuffer>,
            gender: dto.gender,
            dob,
            is_disabled: dto.is_disabled ?? false,
            disability_percentage: dto.disability_percentage,
            ...(dto.preferred_language ? { preferred_language: dto.preferred_language } : {}),
          },
          select: { id: true },
        });
        return { account_id: account.id, applicant_id: applicant.id };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, { details: { field: 'email' } });
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const email = dto.email.trim().toLowerCase();
    const account = await this.prisma.account.findUnique({
      where: { email },
      include: IDENTITY_INCLUDE,
    });

    if (!account) {
      await verifyAgainstDummy(dto.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(account.password_hash, dto.password))) {
      throw invalidCredentials();
    }

    const claims = await this.claimsFor(account);
    if (!claims) throw invalidCredentials();

    const refreshToken = generateRefreshToken();
    const refreshTtl = this.config.auth.refreshTtlSeconds;
    await this.prisma.refreshToken.create({
      data: {
        account_id: account.id,
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    this.logger.info({ accountId: account.id, role: claims.role }, 'Login succeeded');
    return {
      ...(await this.accessTokenFor(claims)),
      refresh_token: refreshToken,
      refresh_expires_in: refreshTtl,
    };
  }

  /** Valid, unexpired, unrevoked refresh token -> new access token (no rotation). */
  async refresh(refreshToken: string): Promise<AccessToken> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token_hash: hashRefreshToken(refreshToken) },
      include: { account: { include: IDENTITY_INCLUDE } },
    });

    const invalid = () =>
      new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'invalid_refresh_token' } });
    if (!stored || stored.revoked_at !== null || stored.expires_at <= new Date()) throw invalid();

    // Re-derive role/jurisdiction from the database: changes since login apply.
    const claims = await this.claimsFor(stored.account);
    if (!claims) throw invalid();
    return this.accessTokenFor(claims);
  }

  /** Idempotent: unknown or already-revoked tokens are not an error. */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token_hash: hashRefreshToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** null when the account may not log in (inactive, or no usable identity). */
  private async claimsFor(account: AccountWithIdentity): Promise<AccessTokenClaims | null> {
    if (!account.is_active) return null;

    if (account.officer) {
      const role = account.officer.role.name;
      if (!account.officer.is_active || !isAppRole(role) || role === AppRole.APPLICANT) {
        return null;
      }
      return {
        sub: account.id,
        role,
        officer_id: account.officer.id,
        jurisdiction_state: account.officer.jurisdiction_state,
        jurisdiction_district: account.officer.jurisdiction_district,
      };
    }

    const [row] = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT applicant_id_for_account(${account.id}::uuid) AS id`;
    if (row?.id) {
      return {
        sub: account.id,
        role: AppRole.APPLICANT,
        officer_id: null,
        jurisdiction_state: null,
        jurisdiction_district: null,
      };
    }
    return null;
  }

  private async accessTokenFor(claims: AccessTokenClaims): Promise<AccessToken> {
    return {
      access_token: await this.jwt.signAsync({ ...claims }),
      token_type: 'Bearer',
      expires_in: this.config.auth.accessTtlSeconds,
    };
  }
}

/** YYYY-MM-DD -> a real calendar date not in the future, else a validation error. */
function parseDateOfBirth(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  const valid =
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getTime() <= Date.now() &&
    date.getUTCFullYear() >= 1900;
  if (!valid) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      details: [
        { field: 'dob', constraints: { date: 'dob must be a real past date (YYYY-MM-DD)' } },
      ],
    });
  }
  return date;
}
