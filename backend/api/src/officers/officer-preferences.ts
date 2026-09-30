import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, OFFICER_ROLES } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { DEFAULT_LOCALE } from '../notifications/templates';

export class OfficerLanguageDto {
  @ApiProperty({ example: 'hi', description: 'One of SUPPORTED_LANGUAGES.' })
  @Matches(/^[a-z]{2,3}$/)
  preferred_language!: string;
}

/**
 * Phase 16 C1 (M50): an officer's notice language, in officer_preferences
 * (audited; the row holds no personal data). No row = DEFAULT_LOCALE.
 * Set by the officer, or by a SUPER_ADMIN for any officer.
 */
@Injectable()
export class OfficerPreferencesService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    @InjectPinoLogger(OfficerPreferencesService.name) private readonly logger: PinoLogger,
  ) {}

  private view(officerId: string, row: { preferred_language: string; updated_at: Date } | null) {
    return {
      officer_id: officerId,
      preferred_language: row?.preferred_language ?? DEFAULT_LOCALE,
      is_default: row === null,
      supported_languages: this.config.languages.supported,
      updated_at: row?.updated_at.toISOString() ?? null,
    };
  }

  private officerId(actor: Actor): string {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    return actor.officerId;
  }

  async get(officerId: string) {
    const row = await this.db.client.officerPreference.findUnique({
      where: { officer_id: officerId },
      select: { preferred_language: true, updated_at: true },
    });
    return this.view(officerId, row);
  }

  mine(actor: Actor) {
    return this.get(this.officerId(actor));
  }

  async set(actor: Actor, officerId: string, language: string) {
    if (!this.config.languages.supported.includes(language)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'preferred_language',
            constraints: {
              isIn: `preferred_language must be one of ${this.config.languages.supported.join(', ')}`,
            },
          },
        ],
      });
    }
    const officer = await this.db.client.officer.findUnique({
      where: { id: officerId },
      select: { id: true },
    });
    if (!officer) throw new AppError(ErrorCode.NOT_FOUND);
    const row = await this.db.client.officerPreference.upsert({
      where: { officer_id: officerId },
      create: {
        officer_id: officerId,
        preferred_language: language,
        updated_by_account_id: actor.accountId,
      },
      update: { preferred_language: language, updated_by_account_id: actor.accountId },
      select: { preferred_language: true, updated_at: true },
    });
    // Ids and the language only.
    this.logger.info({ officerId, language, byRole: actor.role }, 'officer language set');
    return this.view(officerId, row);
  }

  setMine(actor: Actor, language: string) {
    return this.set(actor, this.officerId(actor), language);
  }
}

/** Every officer role may read its own language; AUDITOR (read-only) cannot change it. */
const SETTING_ROLES = OFFICER_ROLES.filter((r) => r !== AppRole.AUDITOR);

@ApiTags('officers')
@ApiBearerAuth()
@Controller('api/v1')
export class OfficerPreferencesController {
  constructor(private readonly prefs: OfficerPreferencesService) {}

  @Get('officers/me/preferences')
  @Roles(...OFFICER_ROLES)
  @ApiOperation({ summary: 'My notice language (default English).' })
  mine(@CurrentActor() actor: Actor) {
    return this.prefs.mine(actor);
  }

  @Put('officers/me/preferences')
  @Roles(...SETTING_ROLES)
  @ApiOperation({ summary: 'Set my notice language (one of SUPPORTED_LANGUAGES).' })
  setMine(@CurrentActor() actor: Actor, @Body() dto: OfficerLanguageDto) {
    return this.prefs.setMine(actor, dto.preferred_language);
  }

  @Put('admin/officers/:id/preferences')
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set an officer’s notice language (SUPER_ADMIN).' })
  set(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OfficerLanguageDto,
  ) {
    return this.prefs.set(actor, id, dto.preferred_language);
  }
}
