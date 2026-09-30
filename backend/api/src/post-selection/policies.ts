/**
 * Phase 9 policy data (concrete VIDYASETU values, kept out of the services).
 */

/**
 * Decision A: renewal exists only where the frozen version has a
 * machine-checkable (eligibility-type, in-grammar) tenure rule. Keyed on the
 * rule id, which must also exist in the application's frozen config.
 */
export const RENEWAL_TENURE_RULES: Readonly<Record<string, string>> = {
  NFST: 'fellowship_tenure_limit',
  NOS: 'overseas_tenure_limit',
};

/** Why each other scheme is refused (verified against the seeded configs). */
export const NOT_RENEWABLE_REASON: Readonly<Record<string, string>> = {
  PRE_MATRIC:
    "PRE_MATRIC's tenure rule (pre_matric_class_tenure) is outside the rules grammar and always evaluates to ERROR, so its tenure is not machine-checkable by this system.",
  POST_MATRIC:
    "POST_MATRIC's tenure rule (post_matric_course_tenure) is operational, not an eligibility gate, and depends on an input no record holds (enrolled_course_duration_years), so its tenure is not machine-checkable by this system.",
  TOP_CLASS:
    "TOP_CLASS's tenure rule (top_class_course_tenure) is operational, not an eligibility gate, and depends on an input no record holds (notified_course_duration_years), so its tenure is not machine-checkable by this system.",
};

/**
 * Grievance SLA per status, in days from entering it - the same shape as
 * Phase 4's STAGE_SLA_DAYS (a plain object + a due-at helper). Final
 * statuses have none. Policy defaults for this build, not from scheme data.
 */
export const GRIEVANCE_SLA_DAYS: Readonly<Record<string, number>> = {
  OPEN: 7,
  IN_PROGRESS: 21,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function grievanceDueAt(status: string, enteredAt: Date): Date | null {
  const days = GRIEVANCE_SLA_DAYS[status];
  return days === undefined ? null : new Date(enteredAt.getTime() + days * DAY_MS);
}

export function objectionWindowClosesAt(runCompletedAt: Date, days: number): Date {
  return new Date(runCompletedAt.getTime() + days * DAY_MS);
}
