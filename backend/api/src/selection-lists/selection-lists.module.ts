import { Module } from '@nestjs/common';
import { PostSelectionModule } from '../post-selection/post-selection.module';
import { SelectionListsController, SelectionResultController } from './selection-lists.controller';
import { SelectionListsService } from './selection-lists.service';

/** Phase 13E: committee review, publication, objections and the final list. */
@Module({
  imports: [PostSelectionModule],
  controllers: [SelectionListsController, SelectionResultController],
  providers: [SelectionListsService],
  exports: [SelectionListsService],
})
export class SelectionListsModule {}
