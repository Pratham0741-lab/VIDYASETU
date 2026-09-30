import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeService } from './me';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

export const JWT_ISSUER = 'vidyasetu-api';
export const JWT_AUDIENCE = 'vidyasetu-api';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.accessSecret,
        signOptions: {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: config.auth.accessTtlSeconds,
        },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
    // In-memory counters: correct for the single api container; move to a
    // shared (Redis) store before running more than one api instance.
    // TODO(deployment phase): set 'trust proxy' so req.ip is the client, not the proxy.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'auth', limit: 5, ttl: 60_000 }] }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MeService,
    // Order matters: authenticate, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtModule],
})
export class AuthModule {}
