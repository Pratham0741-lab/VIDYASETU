import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { LANGS, useI18n, type MessageKey } from "./i18n";
import ErrorBoundary from "./ErrorBoundary";
import { Button, Icon } from "./ui";

/**
 * Screens in the module bar. DigiLocker "Verify" and "Post-award" are hidden
 * for now (Stage F3); their design code stays in src/screens/hidden.
 */
const modules: Array<{ path: string; label: MessageKey }> = [
  { path: "/", label: "nav.eligibility" },
  { path: "/apply", label: "nav.apply" },
  { path: "/dashboard", label: "nav.track" },
  { path: "/deficiencies", label: "nav.deficiencies" },
  { path: "/result", label: "nav.merit" },
];

export function Brand() {
  const { t } = useI18n();
  return (
    <div className="brand" aria-label={t("brand.full")}>
      <div className="emblem"><span>अ</span></div>
      <div>
        <strong>{t("brand.name")}</strong>
        <span>{t("brand.tagline")}</span>
      </div>
    </div>
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

function Header({ landing }: { landing: boolean }) {
  const { t } = useI18n();
  const { status, profile, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const signedIn = status === "signed-in";
  const doLogout = async () => {
    await logout();
    navigate("/");
  };
  return (
    <>
      <div className={`gov-strip ${landing ? "landing-hidden" : ""}`}>
        <span>{t("brand.strip")}</span>
        <div className="gov-strip-right"><a className="skip-link" href="#main">{t("header.skip")}</a><LanguageSwitch /></div>
      </div>
      <header className={`topbar ${landing ? "landing-topbar" : ""}`}>
        <Brand />
        <nav className="top-links" aria-label={t("header.primaryNav")}>
          <button onClick={() => navigate("/")} className={landing ? "active-link" : ""}>{t("header.home")}</button>
          <button onClick={() => navigate("/schemes")} className={pathname.startsWith("/schemes") ? "active-link" : ""} aria-current={pathname.startsWith("/schemes") ? "page" : undefined}>{t("header.schemes")}</button>
          {landing && <button onClick={() => document.getElementById("checker")?.scrollIntoView({ behavior: "smooth" })}>{t("header.checkEligibility")}</button>}
          <button onClick={() => navigate("/dashboard")}>{t("header.track")}</button>
        </nav>
        {landing ? (
          <div className="landing-auth">
            <LanguageSwitch />
            {signedIn ? (
              <><Button variant="secondary" className="landing-login" onClick={() => navigate("/dashboard")}>{profile?.first_name ?? t("header.account")}</Button><Button onClick={doLogout}>{t("header.logout")}</Button></>
            ) : (
              <><Button variant="secondary" className="landing-login" onClick={() => navigate("/login")}>{t("header.login")}</Button><Button onClick={() => navigate("/register")}>{t("header.register")}</Button></>
            )}
          </div>
        ) : signedIn ? (
          <>
            <Button variant="secondary" icon="user" onClick={doLogout}>{t("header.logoutNamed", { name: profile?.first_name ?? "" })}</Button>
            {/* Narrow screens: the design hides the button above below 650px; this 44x44 icon button takes its place. */}
            <button type="button" className="mobile-logout" aria-label={t("header.logout")} title={t("header.logout")} onClick={doLogout}><Icon name="logout" size={20} /></button>
          </>
        ) : (
          <Button variant="secondary" icon="lock" onClick={() => navigate("/login")}>{t("header.login")}</Button>
        )}
      </header>
    </>
  );
}

function ModuleNav() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <div className="module-nav" aria-label={t("header.screens")}>
      {modules.map((module, index) => (
        <button key={module.path} className={pathname === module.path ? "selected" : ""} aria-current={pathname === module.path ? "page" : undefined} onClick={() => navigate(module.path)}>
          <span>{index + 1}</span>{t(module.label)}
        </button>
      ))}
    </div>
  );
}

export default function Shell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const landing = pathname === "/";
  return (
    <div className="site-shell">
      <Header landing={landing} />
      {!landing && <ModuleNav />}
      <div id="main">
        <ErrorBoundary><Outlet /></ErrorBoundary>
      </div>
      {!landing && <footer><Brand /><p>{t("footer.notice")}</p><span>{t("footer.data")}</span></footer>}
    </div>
  );
}
