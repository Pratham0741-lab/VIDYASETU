import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Phase 17.2: response documents for the portal routes of selection lists. */

export class SelectionResultListDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The selection run: POST /grievances needs it for a SELECTION_OBJECTION (subject_type SELECTION_OBJECTION, selection_run_id).',
  })
  selection_run_id!: string;

  @ApiProperty({ example: 'NFST' }) scheme_code!: string;
  @ApiProperty({ example: '2025-26' }) academic_year!: string;

  @ApiProperty({ enum: ['PROVISIONAL_PUBLISHED', 'OBJECTION_WINDOW_CLOSED', 'FINAL_PUBLISHED'] })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the objection window closes.',
  })
  window_closes_at!: string | null;
}

export class SelectionResultDto {
  @ApiProperty({ format: 'uuid' }) application_id!: string;
  @ApiProperty() application_no!: string;
  @ApiProperty({ type: SelectionResultListDto }) list!: SelectionResultListDto;
  @ApiProperty({ enum: ['SELECTED', 'NOT_SELECTED', 'HELD'] }) computed_outcome!: string;
  @ApiProperty({ nullable: true, type: Number }) computed_rank!: number | null;
  @ApiProperty({ nullable: true, type: String }) not_selected_reason!: string | null;
  @ApiProperty() vertical_category!: string;
  @ApiProperty({ nullable: true, type: String }) horizontal_reservation!: string | null;
  @ApiProperty({ nullable: true, enum: ['INCLUDE', 'EXCLUDE'] }) committee_decision!: string | null;
  @ApiProperty({ nullable: true, enum: ['SELECTED', 'NOT_SELECTED', 'HELD'] }) final_outcome!:
    string | null;
  @ApiProperty({ enum: ['SELECTED', 'NOT_SELECTED', 'HELD'] }) current_outcome!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'The merit score and its breakdown (null without a merit basis).',
  })
  score!: Record<string, unknown> | null;
}

/** One objection to a list: ids, state and dates only - no names, no text. */
export class ObjectionDto {
  @ApiProperty({ format: 'uuid' }) grievance_id!: string;
  @ApiProperty() application_no!: string;

  @ApiProperty({
    enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
    description: 'Label keys objection.status.<status> (English and Hindi).',
  })
  status!: string;

  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ description: 'True once the committee has decided it (RESOLVED or REJECTED).' })
  decided!: boolean;
}

export class ListObjectionsDto {
  @ApiProperty({ format: 'uuid' }) selection_list_id!: string;
  @ApiProperty({
    type: [ObjectionDto],
    description: 'Oldest first; only objections in the caller’s scope.',
  })
  objections!: ObjectionDto[];
}
