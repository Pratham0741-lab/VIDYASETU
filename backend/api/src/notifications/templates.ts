import { SENSITIVE_PROFILE_KEYS } from '../schemes/sensitive-fields';
import { PARAM_MESSAGES } from './param-messages';
import { QUALITY_ISSUE_MESSAGES_HI, RULE_MESSAGES_HI, TEMPLATES_HI } from './templates.hi';

/**
 * Notification templates, resolved by (template key, locale).
 *
 * Locale (Phase 13D): the applicant's preferred_language; officers have none
 * (DEFAULT_LOCALE). English and Hindi texts exist for every key (Hindi in
 * templates.hi.ts; templates.spec.ts enforces parity). A locale without a
 * template falls back to English as a whole - the parameters too - and the
 * caller records it (notifications.requested_locale).
 *
 * A parameter may be a message key ({ msg }) or a list of them ({ list })
 * instead of text: it is resolved in the notice's language when rendered.
 *
 * Phase 3 message keys (err.* / info.*, carried by the eligibility gate's
 * failed rules) are reused as-is: RULE_MESSAGES holds their text.
 *
 * Plain text only (emails are sent text/plain): no HTML to escape.
 */
export const DEFAULT_LOCALE = 'en';
export const REDACTED = '[redacted]';

/** A text given by message key, resolved in the notice's language (Phase 13D). */
export interface MsgParam {
  msg: string;
  /** Another key to use when `msg` has no text (e.g. quality.unknown). */
  fallbackMsg?: string;
  /** Literal text when neither key has one (e.g. a humanised code). */
  fallback?: string;
  /** Literal English text that wins over the key in English (e.g. the scheme's own slot name). */
  en?: string;
}
export interface MsgListParam {
  list: MsgParam[];
  prefix?: string;
  join?: string;
}
export type Params = Record<
  string,
  string | number | boolean | null | undefined | MsgParam | MsgListParam
>;

interface Template {
  subject: string;
  body: string;
}

/** Text for the rule message_key values used by the seeded scheme rules (Phase 3). */
export const RULE_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    'err.age_limit_exceeded': 'Your age is above the limit for this scheme.',
    'err.category_ineligible': 'Your category is not eligible for this scheme.',
    'err.course_duration_exceeded': 'The course year is beyond the duration this scheme supports.',
    'err.education_level_ineligible': 'Your level of education is not covered by this scheme.',
    'err.fellowship_tenure_exceeded':
      'The fellowship tenure limit for your degree has been exceeded.',
    'err.income_ceiling_exceeded':
      "Your family's annual income is above this scheme's income ceiling.",
    'err.overseas_tenure_exceeded': 'The course tenure is above the limit for overseas study.',
    'err.pre_matric_class_or_tenure_exceeded':
      'The class or tenure is outside what this scheme supports.',
    'err.top_class_tenure_exceeded': 'The course tenure is beyond what this scheme supports.',
    'info.disbursement_schedule': 'Disbursement follows the scheme schedule.',
    'info.nfst_merit_score': 'Merit is based on the NFST merit score.',
    'info.no_income_ceiling': 'This scheme has no income ceiling.',
    'info.nos_selection_priority': 'Selection priority follows the NOS rules.',
    'info.slots_distribution': 'Slots are distributed as the scheme specifies.',
  },
  hi: RULE_MESSAGES_HI,
};

/**
 * Text for image-quality issue codes, keyed `quality.<code>`. Codes come from
 * the ml quality gate (blurred, low_resolution, glare_detected, underexposed,
 * cut_off_edge) and the mock fixtures (image_blurred, page_cropped, ...).
 */
export const QUALITY_ISSUE_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    'quality.blurred': 'The image is blurred, so the text cannot be read clearly.',
    'quality.image_blurred': 'The image is blurred, so the text cannot be read clearly.',
    'quality.low_resolution': 'The image resolution is too low for the text to be read.',
    'quality.glare_detected': 'Part of the page is washed out by glare or a reflection.',
    'quality.underexposed': 'The image is too dark for the text to be read.',
    'quality.cut_off_edge': 'Part of the document is cut off at the edge of the image.',
    'quality.page_cropped': 'Part of the document is cut off at the edge of the image.',
    'quality.unknown': 'The image has a quality problem that prevents it from being read.',
    // Phase 13E: PDF uploads the ml service cannot use.
    'quality.pdf_encrypted': 'The PDF is password-protected. Upload a copy without a password.',
    'quality.pdf_unreadable': 'The PDF file is damaged or cannot be opened.',
    'quality.pdf_too_large': 'The PDF page is too large. Upload a scan of a normal-sized page.',
  },
  hi: QUALITY_ISSUE_MESSAGES_HI,
};
const QUALITY_ISSUE_FALLBACK = QUALITY_ISSUE_MESSAGES.en['quality.unknown'];

const TEMPLATES: Record<string, Record<string, Template>> = {
  en: {
    'application.eligible_under_review': {
      subject: 'Application {application_no}: passed the eligibility check',
      body: 'Your application {application_no} passed the automatic eligibility check and is now with the {stage_label} for verification (due by {due_at}).',
    },
    'application.ineligible_defective': {
      subject: 'Application {application_no}: action needed',
      body: 'Your application {application_no} did not pass the automatic eligibility check:\n{failed_rules}\nYou can correct your details and resubmit the application.',
    },
    'application.manual_eligibility_review': {
      subject: 'Application {application_no}: under manual review',
      body: 'The automatic check could not decide the eligibility of application {application_no}. An officer will review it manually; no action is needed from you now.',
    },
    'application.advanced': {
      subject: 'Application {application_no}: verified',
      body: 'Your application {application_no} was verified and moved from {from_label} to {to_label}.',
    },
    'application.rejected': {
      subject: 'Application {application_no}: rejected',
      body: 'Your application {application_no} was rejected at the {from_label} stage.',
    },
    'application.deficiency_raised': {
      subject: 'Application {application_no}: deficiency {deficiency_code}',
      body: 'An officer found a deficiency in your application {application_no}.\nCode: {deficiency_code}\nIssue: {deficiency_title}\nPlease correct it and resubmit by {due_at}.',
    },
    'document.retake_required': {
      subject: 'Application {application_no}: please upload "{document_type}" again',
      body: 'The file you uploaded for "{document_type}" could not be read:\n{issues}\nPlease upload a clearer copy.',
    },
    'officer.application_arrived': {
      subject: 'New application {application_no} awaiting your verification',
      body: 'Application {application_no} ({jurisdiction}) is now at {stage_label} and awaits your action (due by {due_at}).',
    },
    'officer.manual_eligibility_review_needed': {
      subject: 'Application {application_no} needs a manual eligibility review',
      body: 'The automatic check could not decide application {application_no} ({jurisdiction}). Rules that could not be evaluated: {error_rules}. Confirm the review when you verify it.',
    },
    'officer.application_resubmitted': {
      subject: 'Application {application_no} was resubmitted',
      body: 'Application {application_no} ({jurisdiction}) was resubmitted and is back at {stage_label}.',
    },
    'officer.document_needs_review': {
      subject: 'Application {application_no}: document "{document_slot}" needs review',
      body: 'The document "{document_slot}" on application {application_no} was routed for review.\nFields to check: {fields}\nReasons: {reasons}',
    },
    'officer.documents_inconsistent': {
      subject: 'Application {application_no}: documents are inconsistent',
      body: 'The documents on application {application_no} do not agree with each other ({checks}). Please review them before acting on the application.',
    },
    'officer.documents_consistency_uncertain': {
      subject: 'Application {application_no}: document consistency uncertain',
      body: 'The consistency check on application {application_no} was inconclusive ({checks}). Please review the documents.',
    },
    'officer.documents_now_consistent': {
      subject: 'Application {application_no}: documents now consistent',
      body: 'The documents on application {application_no} now agree with each other; the earlier consistency alert is resolved.',
    },
    'officer.eligibility_recheck_needed': {
      subject: 'Application {application_no}: document contradicts eligibility data',
      body: 'A document on application {application_no} disagrees with data used in its eligibility evaluation: {fields}. The application is flagged for a manual eligibility review.',
    },
    'selection.provisionally_selected': {
      subject: '{scheme_code} {academic_year}: provisionally selected',
      body: 'Your application {application_no} is provisionally selected for {scheme_code} {academic_year}.\nMerit rank: {merit_rank}\nCategory seat: {vertical_category}\nReservation: {reservation}',
    },
    'selection.not_selected': {
      subject: '{scheme_code} {academic_year}: selection result',
      body: 'Your application {application_no} was not selected for {scheme_code} {academic_year}.\nMerit rank: {merit_rank}\nReason: {reason}\nSelection run reference: {selection_run_id} (quote it if you raise an objection).',
    },
    'grievance.registered': {
      subject: 'Grievance registered for application {application_no}',
      body: 'Your grievance ({subject}) on application {application_no} is registered. Reference: {grievance_id}. It will be taken up by {due_at}.',
    },
    'grievance.in_progress': {
      subject: 'Grievance {grievance_id}: being examined',
      body: 'An officer has started examining your grievance ({subject}) on application {application_no}. Expected by {due_at}.',
    },
    'privacy.correction_decided': {
      subject: 'Your correction request {request_id}: {decision_label}',
      body: 'Your request to correct your {field_label} was {decision_label}.\nOfficer note: {officer_reason}',
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
    'selection.list_provisional': {
      subject: '{scheme_code} {academic_year}: provisional list published',
      body: 'The provisional selection list for {scheme_code} {academic_year} is published.\nYour application {application_no}: {outcome}\nMerit rank: {merit_rank}\nObjections can be raised until {window_closes_at}.',
    },
    'selection.list_final': {
      subject: '{scheme_code} {academic_year}: final list published',
      body: 'The final selection list for {scheme_code} {academic_year} is published.\nYour application {application_no}: {outcome}\nMerit rank: {merit_rank}',
    },
    'officer.sla_breached': {
      subject: 'SLA breached: application {application_no}',
      body: 'Application {application_no} ({jurisdiction}) has been at {stage_label} since {stage_entered_at} and passed its {sla_days}-day SLA at {due_at}. Please act on it.',
    },
    'officer.selection_run_summary': {
      subject: 'Selection run for {scheme_code} {academic_year} completed',
      body: 'Selection ({basis}) for {scheme_code} {academic_year} completed: {selected} selected, {not_selected} not selected.',
    },
  },
  hi: TEMPLATES_HI,
};

/** Every message-key catalogue a parameter may name, per locale. */
const CATALOGUES = [RULE_MESSAGES, QUALITY_ISSUE_MESSAGES, PARAM_MESSAGES];

/** The text of a message key in `locale` (else English), or undefined. */
export function messageText(key: string, locale = DEFAULT_LOCALE): string | undefined {
  for (const loc of [locale, DEFAULT_LOCALE]) {
    for (const c of CATALOGUES) {
      const t = c[loc]?.[key];
      if (t !== undefined) return t;
    }
  }
  return undefined;
}

function resolveMsg(p: MsgParam, locale: string): string {
  if (locale === DEFAULT_LOCALE && p.en !== undefined) return p.en;
  return (
    messageText(p.msg, locale) ??
    (p.fallbackMsg ? messageText(p.fallbackMsg, locale) : undefined) ??
    p.fallback ??
    p.msg
  );
}

function paramText(v: Params[string], locale: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'object') return String(v);
  if ('list' in v) {
    return v.list.map((m) => `${v.prefix ?? ''}${resolveMsg(m, locale)}`).join(v.join ?? ', ');
  }
  return resolveMsg(v, locale);
}

export class MissingTemplateError extends Error {}

export interface Rendered {
  locale: string;
  subject: string;
  body: string;
}

/**
 * Fills {param} placeholders; with `redact`, sensitive-named params become
 * [redacted]. Message-key parameters are resolved in `locale`.
 */
export function fillTemplate(
  text: string,
  params: Params,
  redact: boolean,
  locale = DEFAULT_LOCALE,
): string {
  return text.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    if (redact && SENSITIVE_PROFILE_KEYS.has(key)) return REDACTED;
    return paramText(params[key], locale) ?? '-';
  });
}

/**
 * Renders a template. `forStorage` replaces every parameter whose name is on
 * Phase 3's sensitive-field list with "[redacted]" - the persisted copy -
 * while live delivery gets the real value.
 */
export function render(
  key: string,
  params: Params,
  { forStorage, locale = DEFAULT_LOCALE }: { forStorage: boolean; locale?: string },
): Rendered {
  const t = TEMPLATES[locale]?.[key] ?? TEMPLATES[DEFAULT_LOCALE][key];
  if (!t) throw new MissingTemplateError(`no template "${key}"`);
  // A fallback is English as a whole: the parameters resolve in English too.
  const used = TEMPLATES[locale]?.[key] ? locale : DEFAULT_LOCALE;
  return {
    locale: used,
    subject: fillTemplate(t.subject, params, forStorage, used),
    body: fillTemplate(t.body, params, forStorage, used),
  };
}

/** Names of the template's parameters that were redacted in the stored copy. */
export function redactedParams(key: string, locale = DEFAULT_LOCALE): string[] {
  const t = TEMPLATES[locale]?.[key] ?? TEMPLATES[DEFAULT_LOCALE][key];
  if (!t) return [];
  const names = [...`${t.subject} ${t.body}`.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => SENSITIVE_PROFILE_KEYS.has(n)))];
}

export function ruleMessage(
  messageKey: string | null,
  fallback: string,
  locale = DEFAULT_LOCALE,
): string {
  if (!messageKey) return fallback;
  return (
    RULE_MESSAGES[locale]?.[messageKey] ?? RULE_MESSAGES[DEFAULT_LOCALE][messageKey] ?? fallback
  );
}

/**
 * A quality issue as a sentence. An issue is a code, optionally followed by
 * ": detail" (mock fixtures); an unknown code gets a generic sentence, never
 * the raw code.
 */
export function qualityIssueMessage(issue: string, locale = DEFAULT_LOCALE): string {
  const key = `quality.${issue.split(':')[0].trim().toLowerCase()}`;
  return (
    QUALITY_ISSUE_MESSAGES[locale]?.[key] ??
    QUALITY_ISSUE_MESSAGES[DEFAULT_LOCALE][key] ??
    QUALITY_ISSUE_FALLBACK
  );
}

export const TEMPLATE_KEYS: readonly string[] = Object.keys(TEMPLATES[DEFAULT_LOCALE]);

/** Phase 13D: the locales with texts, and each catalogue per locale (for the parity test). */
export const TEMPLATE_LOCALES: readonly string[] = Object.keys(TEMPLATES);
export const CATALOGUES_FOR_TEST = {
  TEMPLATES,
  RULE_MESSAGES,
  QUALITY_ISSUE_MESSAGES,
  PARAM_MESSAGES,
};

/** The key of a quality issue ("code" or "code: detail"), for a { msg } parameter. */
export function qualityIssueKey(issue: string): string {
  return `quality.${issue.split(':')[0].trim().toLowerCase()}`;
}
