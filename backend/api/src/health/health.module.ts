import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DependencyHealthIndicator } from './dependency-health.indicator';
import { HealthController } from './health.controller';

@Module({
  // Failures are logged by DependencyHealthIndicator and the exception filter.
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController],
  providers: [DependencyHealthIndicator],
})
export class HealthModule {}
