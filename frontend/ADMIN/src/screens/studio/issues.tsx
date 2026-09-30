import { ApiError } from "../../api/client";
import type { ConfigIssue } from "../../api/responses";
import { useI18n, type I18n } from "../../i18n";
import { Icon } from "../../ui";

/** The config issues of a 400 VALIDATION_ERROR (details is an array of {field, message_key, params, constraints}). */
export function issuesOf(err: unknown): ConfigIssue[] {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return [];
  return err.details.filter((d): d is ConfigIssue => !!d && typeof d === "object" && typeof (d as ConfigIssue).field === "string");
}

/**
 * Text for one issue: the backend message key rendered from src/i18n (the
 * backend's own en/hi catalogue, mirrored), else the backend's English
 * constraint text.
 */
export function issueText(i18n: I18n, issue: ConfigIssue): string {
  const vars: Record<string, string | number> = { ...(issue.params ?? {}) };
  const fallback = Object.values(issue.constraints ?? {})[0] ?? issue.field;
  return issue.message_key ? i18n.tk(`api.${issue.message_key}`, fallback, vars) : fallback;
}

/** Issues whose field starts with the given prefix (e.g. "config.rules[2]"). */
export function issuesAt(issues: ConfigIssue[], prefix: string): ConfigIssue[] {
  return issues.filter((i) => i.field === prefix || i.field.startsWith(`${prefix}.`) || i.field.startsWith(`${prefix}[`));
}

export function IssueList({ issues, title }: { issues: ConfigIssue[]; title?: string }) {
  const i18n = useI18n();
  if (issues.length === 0) return null;
  return <div className="issue-list" role="alert">
    {title && <strong>{title}</strong>}
    {issues.map((issue, k) => <div key={k} className="issue"><Icon name="alert" size={14} /><div><span>{issueText(i18n, issue)}</span><small className="mono">{issue.field}{issue.message_key ? ` · ${issue.message_key}` : ""}</small></div></div>)}
  </div>;
}
