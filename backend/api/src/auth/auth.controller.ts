import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Actor } from './actor';
import { AccessToken, AuthService, TokenPair } from './auth.service';
import { CurrentActor, Public, Roles } from './decorators';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto';
import { MeDto, MeService } from './me';
import { ALL_ROLES } from './roles';

/** Per client IP, per route: 5 requests per 60 s on login and register. */
export const AUTH_THROTTLE = { auth: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly meService: MeService,
  ) {}

  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @HttpCode(201)
  @ApiOperation({ summary: 'Applicant self-registration (account + applicant profile).' })
  register(@Body() dto: RegisterDto): Promise<{ account_id: string; applicant_id: string }> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange email + password for an access token and a refresh token.' })
  login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a valid refresh token for a new access token.' })
  refresh(@Body() dto: RefreshTokenDto): Promise<AccessToken> {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent).' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refresh_token);
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'The authenticated caller as seen by the api (officers: also name and institution code).',
  })
  @ApiOkResponse({ type: MeDto })
  me(@CurrentActor() actor: Actor): Promise<MeDto> {
    return this.meService.me(actor);
  }
}
