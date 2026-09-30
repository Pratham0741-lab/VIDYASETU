import { AppRole } from '../auth/roles';
import {
  ApplicationRef,
  DeficiencyIssuedEvent,
  SelectionListPublishedEvent,
  DOMAIN_EVENTS,
  DocumentConsistencyEvaluatedEvent,
  DocumentEligibilityMismatchEvent,
  DocumentNeedsReviewEvent,
  DocumentQualityRejectedEvent,
  GrievanceStatusChangedEvent,
  SelectionRunCompletedEvent,
  SlaBreachedEvent,
  CorrectionDecidedEvent,
  WorkflowTransitionEvent,
} from '../events/domain-events';
import { isStage, T, VIDYASETU_WORKFLOW } from '../workflow/vidyasetu-workflow';
import { canonicalTypeForSlot } from '../documents/document-types';
import type { MsgParam, Params } from './templates';
import { qualityIssueKey } from './templates';

/**
 * Pure mapping from a domain event to notification intents: WHO is told
 * WHICH template with WHICH parameters on WHICH channels. No I/O; everything
 * comes from the event payload. Parameters never include extracted or
 * sensitive values (the events carry none); a template parameter named like
 * a sensitive field would still be redacted in the stored copy (templates.ts).
 */
export type Channel = 'IN_APP' | 'EMAIL' | 'SMS';

export type Audience =
  | { kind: 'APPLICANT'; applicant_id: string }
  /** Officers of these roles whose jurisdiction covers the application. */
  | {
      kind: 'OFFICERS';
      roles: AppRole[];
      jurisdiction_state: string | null;
      jurisdiction_district: string | null;
    };

export interface NotificationIntent {
  template_key: string;
  audience: Audience;
  channels: Channel[];
  application_id: string | null;
  application_no: string | null;
  params: Params;
  source_event: string;
  occurred_at: string;
  /**
   * Phase 13C: the items of an itemised deficiency notice. The notice is
   * rendered from notice_templates in the applicant's language (delivery).
   */
  deficiency_items?: DeficiencyIssuedEvent['items'];
  /** Consistency notifications are de-duplicated against the last one sent (listener). */
  consistency_status?: 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN';
}

/** Phase 13C: the itemised deficiency notice (notice_templates code) and deficiency code. */
export const DEFICIENCY_NOTICE_TEMPLATE = 'DEFICIENCY_NOTICE';
export const ITEMISED_DEFICIENCY_CODE = 'DEF_ITEMISED';

const OFFICER_CHANNELS: Channel[] = ['IN_APP', 'EMAIL'];
const APPLICANT_CHANNELS: Channel[] = ['IN_APP', 'EMAIL'];
/** Applicant outcomes that need action or are final: SMS too (if a phone is on record). */
const APPLICANT_URGENT: Channel[] = ['IN_APP', 'EMAIL', 'SMS'];

/**
 * Phase 13D: texts shown to applicants are passed as message keys and
 * resolved in the notice's language (param-messages.ts, templates.hi.ts).
 */
const label = (stage: string): MsgParam => ({ msg: `stage.${stage}`, fallback: stage });
const humanise = (key: string) => key.replace(/_/g, ' ');

/**
 * The officer role(s) responsible for an application at `stage`: the roles
 * the Phase 4 workflow graph lets act from it (SYSTEM and APPLICANT
 * excluded). Empty for SUBMITTED, DEFECTIVE and final stages.
 */
export function rolesActingAt(stage: string): AppRole[] {
  if (!isStage(stage)) return [];
  const roles = new Set<AppRole>();
  for (const t of Object.values(VIDYASETU_WORKFLOW.states[stage].transitions)) {
    for (const p of t.by) if (p !== 'SYSTEM' && p !== AppRole.APPLICANT) roles.add(p);
  }
  return [...roles];
}

const applicant = (ref: ApplicationRef): Audience => ({
  kind: 'APPLICANT',
  applicant_id: ref.applicant_id,
});
const officers = (ref: ApplicationRef, roles: AppRole[]): Audience => ({
  kind: 'OFFICERS',
  roles,
  jurisdiction_state: ref.jurisdiction_state,
  jurisdiction_district: ref.jurisdiction_district,
});

function base(ref: ApplicationRef, source: string, occurred_at: string) {
  return {
    application_id: ref.application_id,
    application_no: ref.application_no,
    source_event: source,
    occurred_at,
  };
}
const common = (ref: ApplicationRef): Params => ({
  application_no: ref.application_no,
  jurisdiction: [ref.jurisdiction_state, ref.jurisdiction_district].filter(Boolean).join(' / '),
});

export function workflowIntents(e: WorkflowTransitionEvent): NotificationIntent[] {
  const b = base(e, DOMAIN_EVENTS.WORKFLOW_TRANSITION, e.occurred_at);
  const next = rolesActingAt(e.to_stage);
  const p: Params = { ...common(e), stage_label: label(e.to_stage), due_at: e.stage_due_at };
  const arrived = (): NotificationIntent[] =>
    next.length === 0
      ? []
      : [
          {
            ...b,
            template_key: 'officer.application_arrived',
            audience: officers(e, next),
            channels: OFFICER_CHANNELS,
            params: p,
          },
        ];

  if (e.eligibility_gate) {
    const g = e.eligibility_gate;
    if (g.outcome === 'ELIGIBLE') {
      return [
        {
          ...b,
          template_key: 'application.eligible_under_review',
          audience: applicant(e),
          channels: APPLICANT_CHANNELS,
          params: p,
        },
        ...arrived(),
      ];
    }
    if (g.outcome === 'INELIGIBLE') {
      const failed = g.failed_rules.map((r): MsgParam => ({
        msg: r.message_key ?? '',
        fallback: humanise(r.rule_id),
      }));
      return [
        {
          ...b,
          template_key: 'application.ineligible_defective',
          audience: applicant(e),
          channels: APPLICANT_URGENT,
          params: { ...p, failed_rules: { list: failed, prefix: '- ', join: '\n' } },
        },
      ];
    }
    return [
      {
        ...b,
        template_key: 'application.manual_eligibility_review',
        audience: applicant(e),
        channels: APPLICANT_CHANNELS,
        params: p,
      },
      {
        ...b,
        template_key: 'officer.manual_eligibility_review_needed',
        audience: officers(e, next),
        channels: OFFICER_CHANNELS,
        params: { ...p, error_rules: g.error_rules.map(humanise).join(', ') },
      },
    ];
  }

  const pp: Params = { ...p, from_label: label(e.from_stage), to_label: label(e.to_stage) };
  switch (e.transition) {
    case T.VERIFY:
    case T.DISBURSE:
      return [
        {
          ...b,
          template_key: 'application.advanced',
          audience: applicant(e),
          channels: APPLICANT_CHANNELS,
          params: pp,
        },
        ...arrived(),
      ];
    case T.REJECT:
      return [
        {
          ...b,
          template_key: 'application.rejected',
          audience: applicant(e),
          channels: APPLICANT_URGENT,
          params: pp,
        },
      ];
    case T.MARK_DEFECTIVE:
      // An itemised deficiency (Phase 13C) gets its own notice listing every
      // item (deficiencyIntents), not this generic one.
      if (e.deficiency?.code === ITEMISED_DEFICIENCY_CODE) return [];
      return [
        {
          ...b,
          template_key: 'application.deficiency_raised',
          audience: applicant(e),
          channels: APPLICANT_URGENT,
          params: {
            ...pp,
            deficiency_code: e.deficiency?.code,
            deficiency_title: e.deficiency?.title,
          },
        },
      ];
    case T.RESUBMIT:
      return next.length === 0
        ? []
        : [
            {
              ...b,
              template_key: 'officer.application_resubmitted',
              audience: officers(e, next),
              channels: OFFICER_CHANNELS,
              params: pp,
            },
          ];
    default:
      return [];
  }
}

export function qualityRejectedIntents(e: DocumentQualityRejectedEvent): NotificationIntent[] {
  return [
    {
      ...base(e, DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, e.occurred_at),
      template_key: 'document.retake_required',
      audience: applicant(e),
      channels: APPLICANT_URGENT,
      params: {
        ...common(e),
        document_type: {
          msg: `document.${canonicalTypeForSlot(e.document_type) ?? 'UNKNOWN'}`,
          fallback: e.document_type,
          en: e.document_type,
        },
        issues: {
          list: e.issues.map((i) => ({ msg: qualityIssueKey(i), fallbackMsg: 'quality.unknown' })),
          prefix: '- ',
          join: '\n',
        },
      },
    },
  ];
}

/**
 * Document events go to the role responsible for the application's stage
 * (current_stage in the event, Phase 4 graph mapping) - not every reviewer.
 * No officer acts at SUBMITTED / DEFECTIVE / final stages, so none is told
 * (a DEFECTIVE application's officer hears about it on resubmission).
 */
function stageOfficers(e: ApplicationRef & { current_stage: string }): Audience | null {
  const roles = rolesActingAt(e.current_stage);
  return roles.length === 0 ? null : officers(e, roles);
}

export function needsReviewIntents(e: DocumentNeedsReviewEvent): NotificationIntent[] {
  const audience = stageOfficers(e);
  if (!audience) return [];
  return [
    {
      ...base(e, DOMAIN_EVENTS.DOCUMENT_NEEDS_REVIEW, e.occurred_at),
      template_key: 'officer.document_needs_review',
      audience,
      channels: OFFICER_CHANNELS,
      params: {
        ...common(e),
        document_slot: e.document_slot,
        fields: e.fields_needing_review.map(humanise).join(', ') || '-',
        reasons: e.reasons.join('; '),
      },
    },
  ];
}

/**
 * One candidate per evaluation; the listener decides whether to send it by
 * comparing with the last consistency notification for the application.
 */
export function consistencyIntents(e: DocumentConsistencyEvaluatedEvent): NotificationIntent[] {
  const audience = stageOfficers(e);
  if (!audience) return [];
  const key =
    e.status === 'INCONSISTENT'
      ? 'officer.documents_inconsistent'
      : e.status === 'UNCERTAIN'
        ? 'officer.documents_consistency_uncertain'
        : 'officer.documents_now_consistent';
  const checks = Object.entries(e.checks)
    .map(([k, v]) => `${humanise(k)}: ${v ? 'yes' : 'no'} (confidence ${e.confidence[k] ?? '-'})`)
    .join(', ');
  return [
    {
      ...base(e, DOMAIN_EVENTS.DOCUMENT_CONSISTENCY_EVALUATED, e.occurred_at),
      template_key: key,
      audience,
      channels: OFFICER_CHANNELS,
      params: { ...common(e), checks },
      consistency_status: e.status,
    },
  ];
}

export function mismatchIntents(e: DocumentEligibilityMismatchEvent): NotificationIntent[] {
  const audience = stageOfficers(e);
  if (!audience) return [];
  return [
    {
      ...base(e, DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH, e.occurred_at),
      template_key: 'officer.eligibility_recheck_needed',
      audience,
      channels: OFFICER_CHANNELS,
      // Field NAMES only - never values.
      params: { ...common(e), fields: e.fields.map((f) => humanise(f.field)).join(', ') },
    },
  ];
}

export function selectionIntents(e: SelectionRunCompletedEvent): NotificationIntent[] {
  const b = { source_event: DOMAIN_EVENTS.SELECTION_RUN_COMPLETED, occurred_at: e.occurred_at };
  const scheme = { scheme_code: e.scheme_code, academic_year: e.academic_year };
  // Phase 13E: a list-managed run tells applicants when the committee-approved
  // list is published (selectionListIntents); only the officers' summary now.
  if (e.list_managed) return runSummary(e, b, scheme);
  return [
    ...e.selected.map((s): NotificationIntent => ({
      ...b,
      template_key: 'selection.provisionally_selected',
      audience: { kind: 'APPLICANT', applicant_id: s.applicant_id },
      channels: APPLICANT_URGENT,
      application_id: s.application_id,
      application_no: s.application_no,
      params: {
        ...scheme,
        application_no: s.application_no,
        merit_rank: s.merit_rank ?? { msg: 'selection.not_ranked' },
        vertical_category: s.vertical_category,
        reservation: s.horizontal_reservation
          ? {
              msg: `selection.reservation.${s.horizontal_reservation}`,
              fallback: `${s.horizontal_reservation.toLowerCase()} reservation`,
            }
          : { msg: 'selection.general_seat' },
      },
    })),
    ...e.not_selected.map((n): NotificationIntent => ({
      ...b,
      template_key: 'selection.not_selected',
      audience: { kind: 'APPLICANT', applicant_id: n.applicant_id },
      channels: APPLICANT_URGENT,
      application_id: n.application_id,
      application_no: n.application_no,
      params: {
        ...scheme,
        application_no: n.application_no,
        merit_rank: n.merit_rank ?? { msg: 'selection.not_ranked' },
        reason: { msg: `selection.reason.${n.reason}`, fallback: humanise(n.reason.toLowerCase()) },
        selection_run_id: e.selection_run_id,
      },
    })),
    ...runSummary(e, b, scheme),
  ];
}

function runSummary(
  e: SelectionRunCompletedEvent,
  b: { source_event: string; occurred_at: string },
  scheme: { scheme_code: string; academic_year: string },
): NotificationIntent[] {
  return [
    {
      ...b,
      template_key: 'officer.selection_run_summary',
      audience: {
        kind: 'OFFICERS',
        roles: [AppRole.MINISTRY_OFFICER],
        jurisdiction_state: null,
        jurisdiction_district: null,
      },
      channels: OFFICER_CHANNELS,
      application_id: null,
      application_no: null,
      params: {
        ...scheme,
        basis: e.basis,
        selected: e.selected.length,
        not_selected: e.not_selected.length,
      },
    },
  ];
}

const GRIEVANCE_TEMPLATE: Record<string, string> = {
  OPEN: 'grievance.registered',
  IN_PROGRESS: 'grievance.in_progress',
  RESOLVED: 'grievance.resolved',
  REJECTED: 'grievance.rejected',
};

/**
 * Grievances (Phase 9): the applicant hears about every status; officers of
 * the role responsible for the application's stage hear about new ones - or,
 * where no officer acts at that stage (DISBURSED, final stages), the
 * ministry, which owns post-selection decisions.
 */
/** Phase 13E: each candidate hears their own outcome when a list is published. */
/**
 * Phase 14 loose ends (Part B): an SLA breach found by the scheduled sweep
 * goes to the officer role(s) that act at the stage, in the application's
 * jurisdiction. DEFECTIVE's SLA is the applicant's resubmission window: no
 * officer acts there, so the breach is recorded but no officer is told.
 */
export function slaBreachIntents(e: SlaBreachedEvent): NotificationIntent[] {
  const roles = rolesActingAt(e.stage);
  if (roles.length === 0) return [];
  return [
    {
      template_key: 'officer.sla_breached',
      audience: officers(e, roles),
      channels: OFFICER_CHANNELS,
      ...base(e, DOMAIN_EVENTS.SLA_BREACHED, e.occurred_at),
      params: {
        ...common(e),
        stage_label: label(e.stage),
        stage_entered_at: e.stage_entered_at,
        sla_days: e.sla_days,
        due_at: e.stage_due_at,
      },
    },
  ];
}

/** Phase 17 (B4): the applicant hears the decision on their correction request. */
export function correctionIntents(e: CorrectionDecidedEvent): NotificationIntent[] {
  return [
    {
      template_key: 'privacy.correction_decided',
      audience: { kind: 'APPLICANT', applicant_id: e.applicant_id },
      channels: APPLICANT_CHANNELS,
      application_id: null,
      application_no: null,
      source_event: DOMAIN_EVENTS.CORRECTION_DECIDED,
      occurred_at: e.occurred_at,
      params: {
        request_id: e.correction_request_id,
        field_label: { msg: `privacy.field.${e.field}`, fallback: e.field },
        decision_label: { msg: `privacy.decision.${e.decision}`, fallback: e.decision },
        officer_reason: e.reason,
      },
    },
  ];
}

export function selectionListIntents(e: SelectionListPublishedEvent): NotificationIntent[] {
  return e.entries.map((x) => ({
    source_event: DOMAIN_EVENTS.SELECTION_LIST_PUBLISHED,
    occurred_at: e.occurred_at,
    template_key: e.phase === 'PROVISIONAL' ? 'selection.list_provisional' : 'selection.list_final',
    audience: { kind: 'APPLICANT', applicant_id: x.applicant_id },
    channels: APPLICANT_URGENT,
    application_id: x.application_id,
    application_no: x.application_no,
    params: {
      scheme_code: e.scheme_code,
      academic_year: e.academic_year,
      application_no: x.application_no,
      outcome: { msg: `selection.outcome.${x.outcome}`, fallback: x.outcome },
      merit_rank: x.rank ?? { msg: 'selection.not_ranked' },
      window_closes_at: e.window_closes_at ? e.window_closes_at.slice(0, 10) : null,
    },
  }));
}

/** Phase 13C: one notice per itemised deficiency, listing every item. */
export function deficiencyIntents(e: DeficiencyIssuedEvent): NotificationIntent[] {
  return [
    {
      ...base(e, DOMAIN_EVENTS.DEFICIENCY_ISSUED, e.occurred_at),
      template_key: DEFICIENCY_NOTICE_TEMPLATE,
      audience: applicant(e),
      channels: APPLICANT_URGENT,
      params: { application_no: e.application_no },
      deficiency_items: e.items,
    },
  ];
}

export function grievanceIntents(e: GrievanceStatusChangedEvent): NotificationIntent[] {
  const b = base(e, DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED, e.occurred_at);
  const p: Params = {
    ...common(e),
    grievance_id: e.grievance_id,
    subject: {
      msg: `grievance.subject.${e.subject_type}`,
      fallback: humanise(e.subject_type.toLowerCase()),
    },
    due_at: e.sla_due_at,
    resolution_note: e.resolution_note,
  };
  const intents: NotificationIntent[] = [
    {
      ...b,
      template_key: GRIEVANCE_TEMPLATE[e.status],
      audience: applicant(e),
      channels: e.status === 'OPEN' ? APPLICANT_CHANNELS : APPLICANT_URGENT,
      params: p,
    },
  ];
  if (e.status === 'OPEN') {
    const roles = rolesActingAt(e.current_stage);
    intents.push({
      ...b,
      template_key: 'officer.grievance_raised',
      audience: officers(e, roles.length > 0 ? roles : [AppRole.MINISTRY_OFFICER]),
      channels: OFFICER_CHANNELS,
      params: p,
    });
  }
  return intents;
}
