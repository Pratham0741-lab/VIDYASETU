import { Module } from '@nestjs/common';
import { SelectionReviewController } from './selection-review.controller';
import { SelectionReviewService } from './selection-review.service';

/** Phase 13B: read-only selection review (COMMITTEE and reviewers). */
@Module({ controllers: [SelectionReviewController], providers: [SelectionReviewService] })
export class SelectionReviewModule {}
