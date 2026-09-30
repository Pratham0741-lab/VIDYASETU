import { DynamicModule, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationDenialsModule } from './authorization-denials/authorization-denials.module';
import { validationExceptionFactory } from './common/errors/validation-errors';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildLoggerOptions } from './common/logging/logger-options';
import { AppConfigModule, AppConfigModuleOptions } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { DocumentAccessModule } from './documents/document-access';
import { EventsModule } from './events/events.module';
import { FraudModule } from './fraud/fraud.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { SelectionReviewModule } from './selection-review/selection-review.module';
import { BulkActionsModule } from './bulk-actions/bulk-actions.module';
import { DeficienciesModule } from './deficiencies/deficiencies.module';
import { ApplicantsModule } from './applicants/applicants.module';
import { SelectionListsModule } from './selection-lists/selection-lists.module';
import { FairnessModule } from './fairness/fairness.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MlClientModule } from './ml-client/ml-client.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PostSelectionModule } from './post-selection/post-selection.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RetentionModule } from './retention/retention.module';
import { SchemesModule } from './schemes/schemes.module';
import { SelectionModule } from './selection/selection.module';
import { StorageModule } from './storage/storage.module';
import { WorkflowModule } from './workflow/workflow.module';

/**
 * Root module. Use AppModule.forRoot() in production; tests and the OpenAPI
 * exporter pass an explicit env object.
 *
 * Global request pipeline for authenticated routes (see src/database):
 *   JwtAuthGuard -> RolesGuard -> ActorTransactionInterceptor -> handler.
 * TODO(later phases): notification templates and delivery channels.
 */
@Module({})
export class AppModule {
  static forRoot(options: AppConfigModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(options),
        LoggerModule.forRootAsync({
          inject: [AppConfigService],
          useFactory: buildLoggerOptions,
        }),
        PrismaModule,
        // Before DatabaseModule: its interceptor must wrap the actor-transaction one.
        EventsModule,
        DatabaseModule,
        // Global: DenialRecorder for the exception filter and background workers.
        AuthorizationDenialsModule,
        RedisModule,
        StorageModule,
        MlClientModule,
        // Global: DigiLocker / PFMS / NSP adapters (Phase 10).
        IntegrationsModule,
        HealthModule,
        AuthModule,
        // After AuthModule: its global hold guard runs after JwtAuthGuard / RolesGuard.
        FraudModule,
        AdminModule,
        // Before ApplicationsModule: /applications/queue must precede /applications/:id.
        WorkflowModule,
        ApplicationsModule,
        SchemesModule,
        SelectionModule,
        DocumentsModule,
        // Phase 17: document view / download logging (global: used by several modules).
        DocumentAccessModule,
        NotificationsModule,
        PostSelectionModule,
        // Phase 12: read-only analytics (RLS-scoped aggregates, CSV exports).
        AnalyticsModule,
        // Phase 13A: audit chain verification.
        AuditModule,
        // Phase 13B: read-only selection review (COMMITTEE).
        SelectionReviewModule,
        // Phase 13B: bulk clearing of queue items.
        BulkActionsModule,
        // Phase 13C: the deficiency loop (itemised deficiencies, resubmission).
        DeficienciesModule,
        // Phase 13D: applicant profile and notification language.
        ApplicantsModule,
        // Phase 13E: committee review, publication and the final list.
        SelectionListsModule,
        // Phase 13E: fairness data (aggregates; the analytics rules).
        FairnessModule,
        // Phase 17: data retention (scheduled purge, off by default).
        RetentionModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        {
          provide: APP_PIPE,
          useFactory: () =>
            new ValidationPipe({
              whitelist: true,
              forbidNonWhitelisted: true,
              transform: true,
              // Never echo submitted values or DTO instances back in errors.
              validationError: { target: false, value: false },
              exceptionFactory: validationExceptionFactory,
            }),
        },
      ],
    };
  }
}
