import type { ReactNode } from 'react';
import {
  ArrowRight, Award, Bell, Calendar, Check, ChevronRight, CircleAlert, Clock, Download, FileText, GraduationCap, House,
  Info, Lock, LogIn, LogOut, Mail, Menu, RefreshCw, Search, ShieldCheck, TriangleAlert, Upload, User, X, type LucideIcon,
} from 'lucide-react';
import { useI18n } from './i18n';
import { errorRequestId, errorText } from './i18n/errors';

const ICONS = {
  arrow: ArrowRight,
  award: Award,
  bell: Bell,
  calendar: Calendar,
  cap: GraduationCap,
  check: Check,
  chevron: ChevronRight,
  alert: CircleAlert,
  clock: Clock,
  document: FileText,
  download: Download,
  home: House,
  info: Info,
  lock: Lock,
  login: LogIn,
  logout: LogOut,
  mail: Mail,
  menu: Menu,
  refresh: RefreshCw,
  search: Search,
  shield: ShieldCheck,
  upload: Upload,
  user: User,
  warning: TriangleAlert,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** lucide-react icon: one stroke width, 20 or 24px, in a fixed-size box. */
export function Icon({ name, size = 20 }: { name: IconName; size?: 20 | 24 }) {
  const Glyph = ICONS[name];
  return <Glyph className="icon" width={size} height={size} strokeWidth={2} aria-hidden="true" focusable="false" />;
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
  variant?: "primary" | "blue" | "secondary" | "ghost";
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

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section className={`card ${className}`} id={id}>{children}</section>;
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
export function ErrorNote({ error, id }: { error: unknown; id?: string }) {
  const i18n = useI18n();
  if (!error) return null;
  const requestId = errorRequestId(error);
  return (
    <div className="alert-danger" role="alert" id={id}>
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
