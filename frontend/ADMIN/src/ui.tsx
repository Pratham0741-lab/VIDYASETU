import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "./i18n";
import { errorRequestId, errorText, isForbidden } from "./i18n/errors";

export type IconName =
  | "grid"
  | "sliders"
  | "scan"
  | "shield"
  | "ranking"
  | "audit"
  | "chevron"
  | "bell"
  | "search"
  | "check"
  | "lock"
  | "plus"
  | "file"
  | "sparkle"
  | "alert"
  | "arrow"
  | "more"
  | "users"
  | "bank"
  | "copy"
  | "fingerprint"
  | "download"
  | "refresh"
  | "edit"
  | "eye"
  | "clock";

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    sliders: <><path d="M4 6h10M18 6h2M4 18h2M10 18h10M14 4v4M6 16v4" /><path d="M4 12h4M12 12h8M8 10v4" /></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 9h8M8 12h8M8 15h5" /></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></>,
    ranking: <><path d="M4 20h16M6 17v-5h4v5M10 17V7h4v10M14 17v-8h4v8" /><path d="m12 3 .7 1.4 1.6.2-1.2 1.1.3 1.6L12 6.5l-1.4.8.3-1.6-1.2-1.1 1.6-.2L12 3Z" /></>,
    audit: <><path d="M7 3h10l3 3v15H4V3h3Z" /><path d="M8 9h8M8 13h8M8 17h5" /><path d="m15 17 1.5 1.5L20 15" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    file: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    sparkle: <><path d="m12 3 1.2 4.3L17 9l-3.8 1.7L12 15l-1.2-4.3L7 9l3.8-1.7L12 3Z" /><path d="m19 15 .6 2.1L22 18l-2.4.9L19 21l-.6-2.1L16 18l2.4-.9L19 15Z" /></>,
    alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17.5v.5" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    bank: <><path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18M12 3 3 7h18l-9-4Z" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    fingerprint: <><path d="M12 11a2 2 0 0 0-2 2c0 3-1 5-2 6M14 13c0 4-1 7-2 8M7 13a5 5 0 0 1 10 0c0 2-.2 4-1 6M5 13a7 7 0 0 1 14 0c0 1 0 2-.2 3" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 4" /></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg aria-hidden="true" className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Action({ children, variant = "secondary", icon, onClick, disabled = false, title }: { children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName; onClick?: () => void; disabled?: boolean; title?: string }) {
  const run = () => {
    if (!disabled) onClick?.();
  };
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run();
    }
  };
  return <div className={`action action-${variant}${disabled ? " action-disabled" : ""}`} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} title={title} onClick={run} onKeyDown={activate}>{icon && <Icon name={icon} size={16} />}<span>{children}</span></div>;
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "navy";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, value, suffix, editable = false, className = "" }: { label: string; value: ReactNode; suffix?: string; editable?: boolean; className?: string }) {
  return <div className={`field-wrap${className ? ` ${className}` : ""}`}><div className="field-label">{label}</div><div className="field"><span>{value}</span>{suffix && <span className="field-suffix">{suffix}</span>}{editable && <Icon name="edit" size={15} />}</div></div>;
}

export function SectionTitle({ eyebrow, eyebrowClassName, headingClassName, title, description, action }: { eyebrow?: string; eyebrowClassName?: string; headingClassName?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className={`section-heading${headingClassName ? ` ${headingClassName}` : ""}`}><div>{eyebrow && <div className={`eyebrow${eyebrowClassName ? ` ${eyebrowClassName}` : ""}`}>{eyebrow}</div>}<div className="section-title">{title}</div>{description && <div className="section-description">{description}</div>}</div>{action}</div>;
}

export function Toggle({ on = true }: { on?: boolean }) {
  return <div className={`toggle ${on ? "on" : ""}`}><span /></div>;
}

/** An API error as text (403 gets its own heading); never the response body. */
export function ErrorNote({ error }: { error: unknown }) {
  const i18n = useI18n();
  if (!error) return null;
  const id = errorRequestId(error);
  const forbidden = isForbidden(error);
  return <div className="note note-danger" role="alert"><Icon name="alert" size={16} /><div>{forbidden && <strong>{i18n.t("common.forbiddenTitle")}</strong>}<span>{errorText(error, i18n)}</span>{id && <small>{i18n.t("common.requestId", { id })}</small>}</div></div>;
}

export function Note({ tone = "info", title, children }: { tone?: "info" | "warning" | "success" | "danger"; title?: string; children?: ReactNode }) {
  return <div className={`note note-${tone}`}><Icon name={tone === "success" ? "check" : tone === "info" ? "eye" : "alert"} size={16} /><div>{title && <strong>{title}</strong>}{children && <span>{children}</span>}</div></div>;
}

/** Marks figures that are not live data. */
export function SampleData() {
  const { t } = useI18n();
  return <Badge tone="warning">{t("common.sampleData")}</Badge>;
}

export const REASON_MIN = 10;

/** Required reason (backend REASON_REQUIRED: at least 10 characters after trimming). */
export function ReasonField({ label, value, onChange, optional = false, max = 2000 }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; max?: number }) {
  const { t } = useI18n();
  const len = value.trim().length;
  const short = !optional && len < REASON_MIN;
  return <label className="form-control">
    <span className="field-label">{label}{optional ? ` (${t("common.optional")})` : ""}</span>
    <textarea value={value} maxLength={max} rows={3} onChange={(e) => onChange(e.target.value)} />
    <small className={short ? "hint-danger" : "hint"}>{optional ? t("reason.optionalHint") : t("reason.requiredHint", { min: REASON_MIN, n: len })}</small>
  </label>;
}

export function reasonOk(value: string): boolean {
  return value.trim().length >= REASON_MIN;
}

/** Async action runner with busy and error state. */
export function useRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function Loading() {
  const { t } = useI18n();
  return <div className="muted loading-line">{t("common.loading")}</div>;
}

/** A short id for display (first 8 characters of a UUID). */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "";
}
