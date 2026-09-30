import { Module } from '@nestjs/common';
import { ApplicationEligibilityController } from './application-eligibility.controller';
import { EligibilityService } from './eligibility.service';
import { SchemeAuthoringController } from './scheme-authoring.controller';
import { SchemeAuthoringService } from './scheme-authoring.service';
import { SchemeCatalogueService } from './scheme-catalogue';
import { SchemeRoleGuard } from './scheme-role.guard';
import { SchemesController } from './schemes.controller';

@Module({
  controllers: [SchemesController, ApplicationEligibilityController, SchemeAuthoringController],
  providers: [EligibilityService, SchemeAuthoringService, SchemeRoleGuard, SchemeCatalogueService],
  exports: [EligibilityService],
})
export class SchemesModule {}
