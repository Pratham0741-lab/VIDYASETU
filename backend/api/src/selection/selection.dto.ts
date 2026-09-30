import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class RunSelectionDto {
  /**
   * Compute and return the full result without writing anything (allowed
   * even after a selection exists). Identical input gives identical output.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}
