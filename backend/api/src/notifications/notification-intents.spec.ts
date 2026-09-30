import {
  DocumentConsistencyEvaluatedEvent,
  DocumentEligibilityMismatchEvent,
  DocumentNeedsReviewEvent,
  DocumentQualityRejectedEvent,
  SelectionRunCompletedEvent,
  SlaBreachedEvent,
  WorkflowTransitionEvent,
} from '../events/domain-events';
import {
  consistencyIntents,
  mismatchIntents,
  needsReviewIntents,
  NotificationIntent,
  qualityRejectedIntents,
  rolesActingAt,
  selectionIntents,
  slaBreachIntents,
  workflowIntents,
} from './notification-intents';
import { officerCovers } from './recipients';
import {
  fillTemplate,
  qualityIssueMessage,
  REDACTED,
  redactedParams,
  render,
  TEMPLATE_KEYS,
} from './templates';

const ref = {
  application_id: 'app-1',
  application_no: 'VS-2026-27-X',
  applicant_id: 'applicant-1',
  jurisdiction_state: 'Jharkhand',
  jurisdiction_district: 'Ranchi',
};
const transition = (over: Partial<WorkflowTransitionEvent>): WorkflowTransitionEvent => ({
  ...ref,
  workflow_transition_id: 't1',
  from_stage: 'SUBMITTED',
  to_stage: 'INO_VERIFIED',
  transition: 'x',
  actor: { type: 'SYSTEM', role: 'SYSTEM', account_id: null, officer_id: null },
  decision_record_id: null,
  deficiency_id: null,
  deficiency: null,
  stage_due_at: '2026-10-04T00:00:00.000Z',
  eligibility_gate: null,
  occurred_at: '2026-09-27T00:00:00.000Z',
  ...over,
});
const gate = (outcome: 'ELIGIBLE' | 'INELIGIBLE' | 'INDETERMINATE', to_stage: string) =>
  transition({
    to_stage,
    eligibility_gate: {
      outcome,
      needs_eligibility_review: outcome === 'INDETERMINATE',
      evaluation_run_id: 'run',
      failed_rules:
        outcome === 'INELIGIBLE'
          ? [{ rule_id: 'income_ceiling', message_key: 'err.income_ceiling_exceeded' }]
          : [],
      error_rules: outcome === 'INDETERMINATE' ? ['education_level_match'] : [],
    },
  });
const kinds = (xs: NotificationIntent[]) => xs.map((x) => `${x.audience.kind}:${x.template_key}`);
const text = (i: NotificationIntent) =>
  render(i.template_key, i.params, { forStorage: false }).body;

describe('notification intents', () => {
  it('maps a stage to the role responsible for it (Phase 4 graph)', () => {
    expect(rolesActingAt('INO_VERIFIED')).toEqual(['INSTITUTE_NODAL_OFFICER']);
    expect(rolesActingAt('SNO_VERIFIED')).toEqual(['STATE_NODAL_OFFICER']);
    expect(rolesActingAt('DEFECTIVE')).toEqual([]);
  });

  it('distinguishes the three eligibility-gate routings', () => {
    expect(kinds(workflowIntents(gate('ELIGIBLE', 'INO_VERIFIED')))).toEqual([
      'APPLICANT:application.eligible_under_review',
      'OFFICERS:officer.application_arrived',
    ]);
    const inel = workflowIntents(gate('INELIGIBLE', 'DEFECTIVE'));
    expect(kinds(inel)).toEqual(['APPLICANT:application.ineligible_defective']);
    // Phase 3's message_key text, no value.
    expect(text(inel[0])).toContain(
      "Your family's annual income is above this scheme's income ceiling.",
    );
    expect(kinds(workflowIntents(gate('INDETERMINATE', 'INO_VERIFIED')))).toEqual([
      'APPLICANT:application.manual_eligibility_review',
      'OFFICERS:officer.manual_eligibility_review_needed',
    ]);
  });

  it('mark-defective carries the deficiency code and title', () => {
    const [i] = workflowIntents(
      transition({
        from_stage: 'INO_VERIFIED',
        to_stage: 'DEFECTIVE',
        transition: 'mark_defective',
        deficiency_id: 'd1',
        deficiency: { code: 'DEF_X', title: 'Unsigned certificate' },
      }),
    );
    expect(text(i)).toContain('Code: DEF_X\nIssue: Unsigned certificate');
    expect(i.channels).toEqual(['IN_APP', 'EMAIL', 'SMS']);
  });

  const doc = { ...ref, document_id: 'd', extraction_id: 'x', occurred_at: '' };
  it('routes document notifications to the stage role only', () => {
    const e: DocumentNeedsReviewEvent = {
      ...doc,
      current_stage: 'DNO_VERIFIED',
      document_slot: 'marksheet',
      fields_needing_review: ['certificate_number'],
      reasons: ['low confidence'],
      ml_engine: 'MOCK_ML',
    };
    expect(needsReviewIntents(e)[0].audience).toEqual({
      kind: 'OFFICERS',
      roles: ['DISTRICT_NODAL_OFFICER'],
      jurisdiction_state: 'Jharkhand',
      jurisdiction_district: 'Ranchi',
    });
    expect(needsReviewIntents({ ...e, current_stage: 'DEFECTIVE' })).toEqual([]);
  });

  it('consistency: one candidate per status, tagged for de-duplication', () => {
    const e: DocumentConsistencyEvaluatedEvent = {
      ...ref,
      current_stage: 'INO_VERIFIED',
      status: 'INCONSISTENT',
      checks: { names_match: false },
      confidence: { names_match: 0.95 },
      documents_compared: 13,
      ml_engine: 'MOCK_ML',
      occurred_at: '',
    };
    expect(consistencyIntents(e).map((i) => [i.template_key, i.consistency_status])).toEqual([
      ['officer.documents_inconsistent', 'INCONSISTENT'],
    ]);
    expect(consistencyIntents({ ...e, status: 'CONSISTENT' })[0].template_key).toBe(
      'officer.documents_now_consistent',
    );
  });

  it('eligibility mismatch intents name fields, never values', () => {
    const e: DocumentEligibilityMismatchEvent = {
      ...doc,
      current_stage: 'INO_VERIFIED',
      fields: [{ field: 'family_income_annual', sensitive: true, source: 'recorded' }],
    };
    const [i] = mismatchIntents(e);
    expect(i.params.fields).toBe('family income annual');
    expect(text(i)).not.toMatch(/\d{5,}/);
  });

  it('selection: per-applicant intents plus one ministry summary', () => {
    const e: SelectionRunCompletedEvent = {
      selection_run_id: 'r',
      scheme_code: 'NOS',
      academic_year: '2026-27',
      scheme_version_id: 'v',
      basis: 'QUOTA',
      actor: { type: 'OFFICER', role: 'MINISTRY_OFFICER', account_id: 'a', officer_id: 'o' },
      selected: [
        {
          selection_id: 's1',
          application_id: 'a1',
          application_no: 'N1',
          applicant_id: 'p1',
          merit_rank: 3,
          vertical_category: 'PVTG',
          horizontal_reservation: 'FEMALE',
        },
      ],
      not_selected: [
        {
          application_id: 'a2',
          application_no: 'N2',
          applicant_id: 'p2',
          merit_rank: 2,
          reason: 'DISPLACED_BY_RESERVATION',
        },
      ],
      reservations: [],
      occurred_at: '',
    };
    const intents = selectionIntents(e);
    expect(kinds(intents)).toEqual([
      'APPLICANT:selection.provisionally_selected',
      'APPLICANT:selection.not_selected',
      'OFFICERS:officer.selection_run_summary',
    ]);
    expect(text(intents[0])).toContain('Reservation: female reservation');
    expect(text(intents[1])).toContain('reserved-category candidate');
  });
});

describe('templates', () => {
  it('every intent the mappers can produce has a template (en)', () => {
    for (const key of [
      'application.eligible_under_review',
      'application.ineligible_defective',
      'application.manual_eligibility_review',
      'application.advanced',
      'application.rejected',
      'application.deficiency_raised',
      'document.retake_required',
      'officer.application_arrived',
      'officer.manual_eligibility_review_needed',
      'officer.application_resubmitted',
      'officer.document_needs_review',
      'officer.documents_inconsistent',
      'officer.documents_consistency_uncertain',
      'officer.documents_now_consistent',
      'officer.eligibility_recheck_needed',
      'selection.provisionally_selected',
      'selection.not_selected',
      'officer.selection_run_summary',
    ]) {
      expect(TEMPLATE_KEYS).toContain(key);
    }
  });

  it('the stored copy redacts any parameter named on the Phase 3 sensitive list', () => {
    // No current template has such a parameter (so none is listed) - the
    // rule is still enforced by the real filler for any text.
    expect(TEMPLATE_KEYS.flatMap((k) => redactedParams(k))).toEqual([]);
    const text = 'Application {application_no}: income {family_income_annual}, bank {bank_account}';
    const params = { application_no: 'N1', family_income_annual: 700000, bank_account: 'SBIN1:99' };
    expect(fillTemplate(text, params, false)).toBe('Application N1: income 700000, bank SBIN1:99');
    expect(fillTemplate(text, params, true)).toBe(
      `Application N1: income ${REDACTED}, bank ${REDACTED}`,
    );
  });

  it('renders quality issue codes as sentences in the retake notification, never raw codes', () => {
    const e: DocumentQualityRejectedEvent = {
      ...ref,
      document_id: 'doc-1',
      document_type: 'Family Income Certificate',
      issues: ['blurred', 'low_resolution', 'glare_detected', 'cut_off_edge', 'underexposed'],
      ml_engine: 'ML_SERVICE',
      occurred_at: '2026-09-27T00:00:00.000Z',
    };
    const [intent] = qualityRejectedIntents(e);
    const body = render(intent.template_key, intent.params, { forStorage: false }).body;
    expect(body).toBe(
      [
        'The file you uploaded for "Family Income Certificate" could not be read:',
        '- The image is blurred, so the text cannot be read clearly.',
        '- The image resolution is too low for the text to be read.',
        '- Part of the page is washed out by glare or a reflection.',
        '- Part of the document is cut off at the edge of the image.',
        '- The image is too dark for the text to be read.',
        'Please upload a clearer copy.',
      ].join('\n'),
    );
    // Machine codes (low_resolution, ...) never reach the applicant.
    for (const code of e.issues.filter((c) => c.includes('_'))) expect(body).not.toContain(code);
  });

  it('maps mock "code: detail" issues and unknown codes to sentences', () => {
    expect(
      qualityIssueMessage('image_blurred: text edge sharpness 0.21 is below the 0.45 minimum'),
    ).toBe('The image is blurred, so the text cannot be read clearly.');
    expect(qualityIssueMessage('page_cropped: the bottom edge of the document is cut off')).toBe(
      'Part of the document is cut off at the edge of the image.',
    );
    expect(qualityIssueMessage('some_new_code')).toBe(
      'The image has a quality problem that prevents it from being read.',
    );
  });

  it('a locale without templates falls back to English (Phase 13D: hi exists, sat does not)', () => {
    expect(
      render('application.rejected', { application_no: 'N1' }, { forStorage: true, locale: 'sat' })
        .locale,
    ).toBe('en');
    expect(
      render('application.rejected', { application_no: 'N1' }, { forStorage: true, locale: 'hi' })
        .locale,
    ).toBe('hi');
  });
});

describe('officerCovers (mirror of the applications RLS rule)', () => {
  const app = { jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Ranchi' };
  it.each([
    [{ jurisdiction_state: null, jurisdiction_district: null }, true],
    [{ jurisdiction_state: 'Jharkhand', jurisdiction_district: null }, true],
    [{ jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Ranchi' }, true],
    [{ jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Dumka' }, false],
    [{ jurisdiction_state: 'Odisha', jurisdiction_district: null }, false],
  ])('%j covers Jharkhand/Ranchi: %s', (officer, expected) => {
    expect(officerCovers(officer, app)).toBe(expected);
  });
});

describe('SLA breach notices (Phase 14 loose ends, Part B)', () => {
  const breach = (stage: string): SlaBreachedEvent => ({
    ...ref,
    sla_breach_id: 'b1',
    stage,
    stage_entered_at: '2026-09-01T00:00:00.000Z',
    stage_due_at: '2026-09-08T00:00:00.000Z',
    sla_days: 7,
    detected_at: '2026-09-10T00:00:00.000Z',
    sweep_run_id: 'run-1',
    occurred_at: '2026-09-10T00:00:00.000Z',
  });

  it.each([
    ['INO_VERIFIED', ['INSTITUTE_NODAL_OFFICER']],
    ['DNO_VERIFIED', ['DISTRICT_NODAL_OFFICER']],
    ['SNO_VERIFIED', ['STATE_NODAL_OFFICER']],
    ['MINISTRY_APPROVED', ['MINISTRY_OFFICER']],
  ])('%s: the role acting at the stage, in the application jurisdiction', (stage, roles) => {
    const [intent] = slaBreachIntents(breach(stage));
    expect(intent.template_key).toBe('officer.sla_breached');
    expect(intent.audience).toEqual({
      kind: 'OFFICERS',
      roles,
      jurisdiction_state: 'Jharkhand',
      jurisdiction_district: 'Ranchi',
    });
    const hi = render('officer.sla_breached', intent.params, { forStorage: true, locale: 'hi' });
    expect(hi.locale).toBe('hi');
    expect(render('officer.sla_breached', intent.params, { forStorage: true }).body).toContain(
      '7-day SLA',
    );
  });

  it('DEFECTIVE (the applicant resubmission window): recorded, no officer notice', () => {
    expect(slaBreachIntents(breach('DEFECTIVE'))).toEqual([]);
  });
});
