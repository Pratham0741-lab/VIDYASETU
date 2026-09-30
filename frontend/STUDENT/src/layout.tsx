import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as ep from "./api/endpoints";
import type { Application } from "./api/responses";
import { useAuth } from "./auth/AuthProvider";
import { LANGS, useI18n, type MessageKey } from "./i18n";
import ErrorBoundary from "./ErrorBoundary";
import { Icon } from "./ui";

/** Fired after a notification is marked read, so the header badge refreshes. */
export const NOTIFICATIONS_CHANGED = "vidyasetu:notifications-changed";

/**
 * Screens in the step bar. DigiLocker "Verify" and "Post-award" are hidden
 * for now (Stage F3); their design code stays in src/screens/hidden.
 */
const modules: Array<{ path: string; label: MessageKey; step: "eligibility" | "apply" | "other" }> = [
  { path: "/", label: "nav.eligibility", step: "eligibility" },
  { path: "/apply", label: "nav.apply", step: "apply" },
  { path: "/dashboard", label: "nav.track", step: "other" },
  { path: "/deficiencies", label: "nav.deficiencies", step: "other" },
  { path: "/result", label: "nav.merit", step: "other" },
];

export function Brand() {
  const { t } = useI18n();
  return (
    <Link to="/" className="brand" aria-label={t("brand.full")}>
      <span className="emblem"><Icon name="cap" /></span>
      <span className="brand-text">
        <strong>{t("brand.name")}</strong>
        <span>{t("brand.tagline")}</span>
      </span>
    </Link>
  );
}

function LanguageSwitch() {
  const { lang, t } = useI18n();
  const { changeLanguage } = useAuth();
  return (
    <span className="lang-switch" role="group" aria-label={t("lang.label")}>
      {LANGS.map((code) => (
        <button key={code} type="button" className={lang === code ? "active" : ""} aria-pressed={lang === code} onClick={() => changeLanguage(code)} lang={code}>
          {t(code === "en" ? "lang.en" : "lang.hi")}
        </button>
      ))}
    </span>
  );
}

/** Unread count from GET /notifications; refreshed on navigation. Hidden at zero. */
function useUnread(signedIn: boolean, pathname: string) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!signedIn) return setUnread(0);
    let live = true;
    const load = () =>
      ep.listNotifications().then(
        (r) => live && setUnread(r.notifications.filter((n) => !n.read_at).length),
        () => live && setUnread(0),
      );
    load();
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [signedIn, pathname]);
  return unread;
}

/** The newest application, for the completed marks in the step bar. */
function useNewestApplication(signedIn: boolean, pathname: string) {
  const [app, setApp] = useState<Application | null>(null);
  useEffect(() => {
    if (!signedIn) return setApp(null);
    let live = true;
    ep.listApplications().then((list) => live && setApp(list[0] ?? null), () => live && setApp(null));
    return () => {
      live = false;
    };
  }, [signedIn, pathname]);
  return app;
}

function Header() {
  const { t } = useI18n();
  const { status, profile, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const signedIn = status === "signed-in";
  const unread = useUnread(signedIn, pathname);
  const doLogout = async () => {
    await logout();
    navigate("/");
  };
  const links: Array<{ to: string; label: MessageKey; active: boolean }> = [
    { to: "/", label: "header.home", active: pathname === "/" },
    { to: "/schemes", label: "header.schemes", active: pathname.startsWith("/schemes") },
    { to: "/dashboard", label: "header.track", active: pathname === "/dashboard" },
  ];
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">{t("header.skip")}</a>
      <div className="topbar-inner">
        <Brand />
        <nav className="top-links" aria-label={t("header.primaryNav")}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={l.active ? "active-link" : ""} aria-current={l.active ? "page" : undefined}>{t(l.label)}</Link>
          ))}
        </nav>
        <div className="top-actions">
          <LanguageSwitch />
          {signedIn && (
            <Link to="/dashboard#notifications" className="icon-btn bell" aria-label={unread ? t("header.notificationsUnread", { n: unread }) : t("header.notifications")} title={t("header.notifications")}>
              <Icon name="bell" />
              {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
            </Link>
          )}
          {signedIn ? (
            <button type="button" className="btn btn-secondary btn-sm account-btn" onClick={doLogout} aria-label={t("header.logoutNamed", { name: profile?.first_name ?? "" }).trim()}>
              <Icon name="logout" /><span className="label-wide">{t("header.logout")}</span>
            </button>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary btn-sm account-btn" aria-label={t("header.login")}><Icon name="login" /><span className="label-wide">{t("header.login")}</span></Link>
              <Link to="/register" className="btn btn-primary btn-sm register-btn">{t("header.register")}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function StepNav() {
  const { t } = useI18n();
  const { status } = useAuth();
  const { pathname } = useLocation();
  const app = useNewestApplication(status === "signed-in", pathname);
  const current = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    // Below 768px the bar scrolls sideways; keep the current step centred in it
    // (scrolls only the bar, never the page).
    const centre = () => {
      const a = current.current;
      const bar = a?.closest("ol");
      if (a && bar) bar.scrollLeft = a.offsetLeft - (bar.clientWidth - a.offsetWidth) / 2;
    };
    centre();
    window.addEventListener("resize", centre);
    return () => window.removeEventListener("resize", centre);
  }, [pathname]);
  const done = (step: string) => (step === "eligibility" ? !!app : step === "apply" ? !!app?.submitted_at : false);
  return (
    <nav className="step-nav" aria-label={t("header.screens")}>
      <ol>
        {modules.map((module, index) => {
          const isCurrent = pathname === module.path;
          const isDone = !isCurrent && done(module.step);
          return (
            <li key={module.path}>
              <Link
                to={module.path}
                ref={isCurrent ? current : undefined}
                className={isCurrent ? "current" : isDone ? "done" : ""}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className="step-num">{isDone ? <Icon name="check" /> : index + 1}</span>
                <span>{t(module.label)}</span>
                {isDone && <span className="sr-only">{t("nav.stepDone")}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function Shell() {
  const { t } = useI18n();
  return (
    <div className="site-shell">
      <Header />
      <StepNav />
      <div id="main" className="main-region">
        <ErrorBoundary><Outlet /></ErrorBoundary>
      </div>
      <footer className="site-footer">
        <div className="footer-inner">
          <Brand />
          <div className="footer-copy">
            <p>{t("footer.notice")}</p>
            <p>{t("footer.data")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
