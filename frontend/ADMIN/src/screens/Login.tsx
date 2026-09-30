import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApplicantRefusedError, useAuth } from "../auth/AuthProvider";
import { LANGS, useI18n, type MessageKey } from "../i18n";
import { ErrorNote, Icon, Note } from "../ui";

/** Officer sign-in, in the admin card style. */
export default function LoginScreen() {
  const { t, lang } = useI18n();
  const { login, signOutReason, changeLanguage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setRefused(false);
    try {
      await login(email.trim(), password);
      setPassword("");
      navigate(from, { replace: true });
    } catch (e) {
      setPassword("");
      if (e instanceof ApplicantRefusedError) setRefused(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const applicant = refused || signOutReason === "applicant";
  return <div className="login-page">
    <div className="brand brand-fixed">
      <div className="emblem"><div className="emblem-wheel">✦</div></div>
      <div><div className="brand-kicker">{t("brand.kicker")}</div><div className="brand-name">{t("brand.name")}</div></div>
      <div className="login-lang lang-switch" role="group" aria-label={t("lang.label")}>
        {LANGS.map((l) => <button key={l} type="button" className={`filter-pill${lang === l ? " lang-active" : ""}`} aria-pressed={lang === l} onClick={() => changeLanguage(l)}>{t(`lang.${l}` as MessageKey)}</button>)}
      </div>
    </div>
    <section className="card login-card">
      <div className="eyebrow">{t("login.eyebrow")}</div>
      <div className="page-title">{t("login.title")}</div>
      <div className="section-description">{t("login.description")}</div>
      {signOutReason === "expired" && !applicant && <Note tone="warning" title={t("auth.expiredTitle")}>{t("auth.expiredText")}</Note>}
      {applicant && <Note tone="danger" title={t("auth.applicantTitle")}>{t("auth.applicantText")}</Note>}
      <ErrorNote error={error} />
      <form onSubmit={submit} className="login-form">
        <label className="form-control"><span className="field-label">{t("login.email")}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="form-control"><span className="field-label">{t("login.password")}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="action action-primary" disabled={busy}><span>{busy ? t("common.pleaseWait") : t("login.submit")}</span><Icon name="arrow" size={16} /></button>
      </form>
      <div className="login-foot"><Icon name="lock" size={14} /><span>{t("login.note")}</span></div>
      <div className="login-foot muted">{t("brand.prototype")} · {t("brand.notOfficial")}</div>
    </section>
  </div>;
}
