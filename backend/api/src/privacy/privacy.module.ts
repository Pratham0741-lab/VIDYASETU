import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

/** Phase 17 (Part B): consent, data export, correction and erasure requests. */
@Module({
  imports: [ApplicantsModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
