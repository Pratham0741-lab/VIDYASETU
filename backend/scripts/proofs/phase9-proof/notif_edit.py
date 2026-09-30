p = 'src/notifications/templates.ts'
s = open(p, encoding='utf8').read()
old = r"""Reason: {reason}',
    },
    'officer.selection_run_summary': {"""
assert old in s, 'template anchor'
s = s.replace(old, r"""Reason: {reason}\nSelection run reference: {selection_run_id} (quote it if you raise an objection).',
    },
    'grievance.registered': {
      subject: 'Grievance registered for application {application_no}',
      body: 'Your grievance ({subject}) on application {application_no} is registered. Reference: {grievance_id}. It will be taken up by {due_at}.',
    },
    'grievance.in_progress': {
      subject: 'Grievance {grievance_id}: being examined',
      body: 'An officer has started examining your grievance ({subject}) on application {application_no}. Expected by {due_at}.',
    },
    'grievance.resolved': {
      subject: 'Grievance {grievance_id}: resolved',
      body: 'Your grievance ({subject}) on application {application_no} is resolved.\nOfficer note: {resolution_note}',
    },
    'grievance.rejected': {
      subject: 'Grievance {grievance_id}: closed without action',
      body: 'Your grievance ({subject}) on application {application_no} was closed without action.\nOfficer note: {resolution_note}',
    },
    'officer.grievance_raised': {
      subject: 'New grievance on application {application_no}',
      body: 'A grievance ({subject}) was raised on application {application_no} ({jurisdiction}). Reference: {grievance_id}. Respond by {due_at}.',
    },
    'officer.selection_run_summary': {""", 1)
open(p, 'w', encoding='utf8', newline='\n').write(s)

p = 'src/notifications/notification-intents.ts'
s = open(p, encoding='utf8').read()
old = "reason: REASON_TEXT[n.reason] ?? humanise(n.reason.toLowerCase()),"
assert old in s, 'intent anchor'
s = s.replace(old, old + "\n          selection_run_id: e.selection_run_id,", 1)
old = "  DocumentQualityRejectedEvent,\n"
assert old in s
s = s.replace(old, old + "  GrievanceStatusChangedEvent,\n", 1)
s += '''
const SUBJECT_TEXT: Record<string, string> = {
  APPLICATION: 'about the application',
  SELECTION: 'about the selection',
  DISBURSEMENT: 'about a disbursement',
  SELECTION_OBJECTION: 'objection to non-selection',
};

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
export function grievanceIntents(e: GrievanceStatusChangedEvent): NotificationIntent[] {
  const b = base(e, DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED, e.occurred_at);
  const p: Params = {
    ...common(e),
    grievance_id: e.grievance_id,
    subject: SUBJECT_TEXT[e.subject_type] ?? humanise(e.subject_type.toLowerCase()),
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
'''
open(p, 'w', encoding='utf8', newline='\n').write(s)

p = 'src/notifications/notification.listener.ts'
s = open(p, encoding='utf8').read()
old = "  DocumentQualityRejectedEvent,\n"
assert old in s
s = s.replace(old, old + "  GrievanceStatusChangedEvent,\n", 1)
old = "  consistencyIntents,\n"
assert old in s
s = s.replace(old, old + "  grievanceIntents,\n", 1)
old = """  onSelection(e: SelectionRunCompletedEvent) {
    return this.send(selectionIntents(e));
  }"""
assert old in s, 'listener anchor'
s = s.replace(old, old + """

  @OnEvent(DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED, ASYNC)
  onGrievance(e: GrievanceStatusChangedEvent) {
    return this.send(grievanceIntents(e));
  }""", 1)
open(p, 'w', encoding='utf8', newline='\n').write(s)
print('notifications updated')
