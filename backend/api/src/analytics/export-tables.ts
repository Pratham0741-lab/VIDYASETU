import type { AnalyticsService } from './analytics.service';
import type { ExportTable } from './exports';

/**
 * The export table of each analytics view: the rows and columns its CSV has
 * always had (moved here unchanged from the controller in Phase 16, so the
 * CSV bytes do not change) and, for the Phase 16 views, one table per view.
 * XLSX and PDF use exactly the same table.
 */
type Result<K extends keyof AnalyticsService> = Awaited<ReturnType<AnalyticsService[K]>>;

export function funnelTable(r: Result<'funnel'>): ExportTable {
  const rows = [
    ...r.steps.map((x) => ({
      metric: x.step,
      count: x.count,
      of: x.of,
      conversion: x.conversion,
    })),
    ...Object.entries(r.current).map(([k, v]) => ({ metric: `current_${k}`, count: v })),
    { metric: 'held_by_fraud_review', count: r.held.count },
    { metric: 'selected_disbursement_by_state_dbt', count: r.state_dbt.count },
  ];
  return { columns: ['metric', 'count', 'of', 'conversion'], rows };
}

export function slaTable(r: Result<'sla'>): ExportTable {
  return { columns: Object.keys(r.stages[0] ?? { stage: null }), rows: r.stages };
}

export function schemesTable(r: Result<'schemes'>): ExportTable {
  const columns = [
    'scheme_code',
    'academic_year',
    'disbursement_mode',
    'applications',
    'under_review',
    'approved',
    'selected',
    'held',
    'rejected',
    'defective',
    'rejected_at_institute',
    'rejected_at_district',
    'rejected_at_state',
    'seats_available',
    'seats_used',
    'seats_note',
  ];
  return { columns, rows: r.schemes };
}

export function disbursementsTable(r: Result<'disbursements'>): ExportTable {
  const rows = [
    ...r.scheduled.map((x) => ({ ...x, status: 'SCHEDULED' })),
    ...r.by_status,
    ...r.handled_by_state.map((x) => ({ ...x, currency: null })),
  ];
  const columns = ['scheme_code', 'currency', 'status', 'instalments', 'applications', 'amount'];
  return { columns, rows };
}

export function fraudTable(r: Result<'fraud'>): ExportTable {
  const rows = [
    ...r.application_flags.map((x) => ({ subject: 'APPLICATION', ...x })),
    ...r.institution_flags.map((x) => ({ subject: 'INSTITUTION', ...x })),
    ...r.held_applications.by_stage.map((x) => ({
      subject: 'HELD_APPLICATIONS',
      status: x.stage,
      applications: x.applications,
    })),
  ];
  const columns = ['subject', 'flag_type', 'severity', 'status', 'flags', 'applications'];
  return { columns, rows };
}

export function jurisdictionTable(r: Result<'jurisdiction'>): ExportTable {
  const rows = [
    ...r.rows.map((x) => ({ level: 'detail', ...x })),
    ...r.states.map((x) => ({ level: 'state', ...x })),
  ];
  const columns = [
    'level',
    'state',
    'district',
    ...(r.meta.group_by === 'institution' ? ['institution_code'] : []),
    'applications',
    'under_review',
    'approved',
    'selected',
    'held',
    'rejected',
    'defective',
    'past_sla_now',
    'state_dbt',
    'paid_amount_inr',
  ];
  return { columns, rows };
}

/** Phase 16: both parts of the workload view in one table (section column). */
export function workloadTable(r: Result<'workload'>): ExportTable {
  const columns = [
    'section',
    'role',
    'level',
    'actions_total',
    'verify',
    'reject',
    'defective',
    'document_confirm',
    'fraud_review',
    'selection_confirm',
    'committee_decision',
    'other',
    'overrides',
    'bulk_actions',
    'officers_active',
    'median_handling_hours',
    'p90_handling_hours',
    'stage',
    'sla_days',
    'in_queue_now',
    'past_sla_now',
    'breaches_recorded',
  ];
  const rows = [
    ...r.actions.map((x) => ({ section: 'actions', ...x })),
    ...r.queues.map((x) => ({ section: 'queue', ...x })),
  ];
  return { columns, rows };
}

export function verificationQualityTable(r: Result<'verificationQuality'>): ExportTable {
  const columns = [
    'scheme_code',
    'document_type',
    'source',
    'uploaded',
    'rejected_unreadable',
    'processed',
    'extraction_failed',
    'auto_verified',
    'sent_to_review',
    'awaiting_officer',
    'officer_decided',
    'officer_corrected',
    'type_overridden',
    'overridden',
    'auto_accept_rate',
    'override_rate',
  ];
  return { columns, rows: r.rows };
}
