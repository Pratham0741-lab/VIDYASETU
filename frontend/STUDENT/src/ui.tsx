import type { ReactNode } from 'react';
import { useI18n } from './i18n';
import { errorRequestId, errorText } from './i18n/errors';

export type IconName =
  | 'arrow'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'document'
  | 'download'
  | 'home'
  | 'lock'
  | 'menu'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'upload'
  | 'user'
  | 'warning'
  | 'logout';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M5 20h14" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-7h6v7" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    refresh: <><path d="M20 7h-6V1" /><path d="M20 7a9 9 0 1 0 1 8" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    shield: <><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M4 16v4h16v-4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    warning: <><path d="M12 3 2.5 20h19z" /><path d="M12 9v5m0 3h.01" /></>,
    logout: <><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4M6 12h11" /></>,
  };
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Button({
  children,
  variant = "primary",
  onClick,
  icon,
  className = "",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  icon?: IconName;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button type={type} className={`btn btn-${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export type Tone = "blue" | "green" | "amber" | "red" | "gray";

export function Tag({ children, tone = "blue" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function ScreenTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="screen-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

/** An error in the existing alert style, with the backend request id for support. */
export function ErrorNote({ error }: { error: unknown }) {
  const i18n = useI18n();
  if (!error) return null;
  const requestId = errorRequestId(error);
  return (
    <div className="alert-danger" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{errorText(error, i18n)}</strong>
        {requestId && <p>{i18n.t('common.requestId', { id: requestId })}</p>}
      </div>
    </div>
  );
}

/** A neutral notice in the existing info-banner style. */
export function InfoNote({ title, text, icon = "shield" }: { title: string; text?: string; icon?: IconName }) {
  return (
    <div className="quality-banner">
      <Icon name={icon} />
      <div>
        <strong>{title}</strong>
        {text && <p>{text}</p>}
      </div>
    </div>
  );
}

/** "Sample data" label for anything not backed by an endpoint. */
export function SampleLabel() {
  const { t } = useI18n();
  return <Tag tone="amber">{t('common.sampleData')}</Tag>;
}
