import { Component, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { modulesFor, type ModuleId } from "./auth/permissions";
import { LANGS, useI18n, type MessageKey } from "./i18n";
import { Icon, type IconName } from "./ui";

const MODULE_ICONS: Record<ModuleId, IconName> = {
  studio: "sliders",
  scrutiny: "scan",
  fraud: "shield",
  selection: "ranking",
  audit: "audit",
  analytics: "grid",
};

/** Catches render errors so one broken screen never blanks the portal. */
class ScreenBoundary extends Component<{ children: ReactNode; title: string; text: string; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <div className="screen"><div className="note note-danger" role="alert"><div><strong>{this.props.title}</strong><span>{this.props.text}</span></div></div></div>;
    return this.props.children;
  }
}

function initials(text: string): string {
  return text.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** "Jharkhand · Gumla", or "National scope" for officers without a state. */
export function useJurisdiction(): string {
  const { me } = useAuth();
  const { t } = useI18n();
  if (!me?.jurisdictionState) return t("shell.national");
  return [me.jurisdictionState, me.jurisdictionDistrict].filter(Boolean).join(" · ");
}

export default function AppShell() {
  const { me, logout, changeLanguage } = useAuth();
  const { t, lang } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const modules = modulesFor(me?.role);
  const active = (location.pathname.split("/")[1] || "") as ModuleId;
  const roleLabel = me ? t(`role.${me.role}` as MessageKey) : "";
  // /auth/me returns the officer's name and institution code (F2-B); older servers do not.
  const officerName = me?.name?.trim() || "";
  const jurisdiction = useJurisdiction();

  return <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
    <div className="brand brand-fixed">
      <div className="emblem"><div className="emblem-wheel">✦</div></div>
      <div><div className="brand-kicker">{t("brand.kicker")}</div><div className="brand-name">{t("brand.name")}</div></div>
    </div>
    <div
      className="sidebar-toggle"
      role="button"
      tabIndex={0}
      aria-label={sidebarOpen ? t("shell.closeNav") : t("shell.openNav")}
      aria-expanded={sidebarOpen}
      onClick={() => setSidebarOpen((open) => !open)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setSidebarOpen((open) => !open);
      }}
    >
      <Icon name="chevron" size={20} />
    </div>
    <aside className="sidebar">
      <div className="sidebar-label">{t("shell.suite")}</div>
      <nav className="nav-list">
        {modules.map((id) => <NavLink key={id} to={`/${id}`} className={({ isActive }) => `nav-item nav-${id}${isActive ? " active" : ""}${id === "studio" || id === "scrutiny" ? " nav-transparent" : ""}`}>
          {({ isActive }) => <><div className="nav-icon"><Icon name={MODULE_ICONS[id]} /></div><div className="nav-copy"><div>{t(`module.${id}` as MessageKey)}</div></div>{isActive && <Icon name="chevron" size={15} />}</>}
        </NavLink>)}
        {modules.length === 0 && <div className="muted nav-empty">{t("shell.noModules")}</div>}
      </nav>
      <div className="sidebar-spacer" />
      <div className="system-card"><div className="system-line"><span>{t("brand.prototype")}</span></div><div className="system-meta">{t("brand.notOfficial")}</div></div>
      <div className="officer">
        <div className="avatar">{initials(officerName || roleLabel)}</div>
        <div>
          <div className="officer-name">{officerName || roleLabel}</div>
          <div className="officer-role">{officerName ? `${roleLabel} · ` : ""}{jurisdiction}{me?.institution_code ? ` · ${me.institution_code}` : ""}</div>
        </div>
        <div className="officer-logout" role="button" tabIndex={0} title={t("shell.logout")} aria-label={t("shell.logout")} onClick={() => void logout()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && void logout()}><Icon name="arrow" /></div>
      </div>
    </aside>
    <main className="main">
      <header className={`topbar${active === "audit" ? " audit-topbar" : ""}${active === "studio" ? " scheme-topbar" : ""}${active === "scrutiny" ? " scrutiny-topbar" : ""}${active === "fraud" ? " fraud-topbar" : ""}${active === "selection" ? " selection-topbar" : ""}`}>
        <div className="breadcrumb"><span>{jurisdiction}</span><Icon name="chevron" size={19} className={active === "studio" ? "scheme-breadcrumb-chevron" : ""} /><strong>{modules.includes(active) ? t(`module.${active}` as MessageKey) : ""}</strong></div>
        <div className="top-actions">
          <div className="lang-switch" role="group" aria-label={t("lang.label")}>
            {LANGS.map((l) => <button key={l} type="button" className={`filter-pill${lang === l ? " lang-active" : ""}`} aria-pressed={lang === l} onClick={() => changeLanguage(l)}>{t(`lang.${l}` as MessageKey)}</button>)}
          </div>
          <button type="button" className="filter-pill" onClick={() => void logout()}>{t("shell.logout")}</button>
        </div>
      </header>
      <div className={`page${active === "studio" ? " scheme-page" : ""}${active === "scrutiny" ? " scrutiny-page" : ""}${active === "fraud" ? " fraud-page" : ""}`}>
        <ScreenBoundary title={t("common.crashTitle")} text={t("common.crashText")} resetKey={location.pathname}><Outlet /></ScreenBoundary>
      </div>
    </main>
  </div>;
}
