import { SelectionListsModule } from '../selection-lists/selection-lists.module';
import { Module } from '@nestjs/common';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  // Phase 13E: a committed run opens its selection list.
  imports: [SelectionListsModule],
  controllers: [SelectionController],
  providers: [SelectionService],
})
export class SelectionModule {}
