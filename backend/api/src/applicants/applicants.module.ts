import { Module } from '@nestjs/common';
import { ApplicantsController } from './applicants.controller';
import { ApplicantsService } from './applicants.service';

/** Phase 13D: applicant profile view and update. */
@Module({
  controllers: [ApplicantsController],
  providers: [ApplicantsService],
  // Phase 17: the privacy module reuses the profile view and the verified correction path.
  exports: [ApplicantsService],
})
export class ApplicantsModule {}
