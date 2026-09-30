import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/decorators';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { ErrorResponseDto } from '../common/errors/error-response';
import { MlClientService } from '../ml-client/ml-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { DependencyHealthIndicator, ProbeFailure } from './dependency-health.indicator';

class LivenessDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

class ReadinessDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({
    type: 'object',
    description: 'Per-dependency status keyed by dependency name.',
    additionalProperties: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['up', 'down'] },
        latencyMs: { type: 'number' },
        reason: { type: 'string' },
      },
    },
    example: {
      database: { status: 'up', latencyMs: 2 },
      redis: { status: 'up', latencyMs: 1 },
      storage: { status: 'up', latencyMs: 4 },
      ml: { status: 'up', latencyMs: 6 },
    },
  })
  details!: Record<string, { status: 'up' | 'down' }>;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dependency: DependencyHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly ml: MlClientService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running. Checks no dependencies.' })
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck({ swaggerDocumentation: false })
  @ApiOperation({
    summary: 'Readiness: database, Redis, MinIO bucket and ml service are reachable.',
  })
  @ApiOkResponse({ type: ReadinessDto })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'code DEPENDENCY_UNAVAILABLE; details holds the per-dependency status.',
  })
  async ready(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.dependency.probe('database', () => this.prisma.ping()),
        () => this.dependency.probe('redis', () => this.redis.ping()),
        () =>
          this.dependency.probe('storage', async () => {
            if (!(await this.storage.documentsBucketExists())) {
              throw new ProbeFailure('bucket_missing');
            }
          }),
        () =>
          this.dependency.probe('ml', async () => {
            const mlHealth = await this.ml.getHealth();
            if (mlHealth.status !== 'ok') {
              throw new ProbeFailure('not_ok');
            }
          }),
      ]);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const result = err.getResponse() as HealthCheckResult;
        throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, { details: result.details });
      }
      throw err;
    }
  }
}
