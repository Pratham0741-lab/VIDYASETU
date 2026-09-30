import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NotApplicantError, useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle } from "../ui";

export default function LoginScreen() {
  const { t } = useI18n();
  const { login, signOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";
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
      if (e instanceof NotApplicantError) setRefused(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const notApplicant = refused || signOutReason === "not-applicant";
  return (
    <main className="app-page">
      <ScreenTitle eyebrow={t("login.eyebrow")} title={t("login.title")} description={t("login.description")} />
      <div className="split auth-grid">
        <Card>
          <div className="card-heading"><div><h2>{t("login.heading")}</h2><p>{t("login.subheading")}</p></div></div>
          {signOutReason === "expired" && !notApplicant && <InfoNote icon="clock" title={t("auth.expiredTitle")} text={t("auth.expiredText")} />}
          {notApplicant && (
            <div className="alert-danger" role="alert"><Icon name="warning" /><div><strong>{t("auth.notApplicantTitle")}</strong><p>{t("auth.notApplicantText")}</p></div></div>
          )}
          <ErrorNote error={error} id="form-error" />
          <form onSubmit={submit} aria-describedby={error ? "form-error" : undefined}>
            <label>{t("field.email")}
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>{t("field.password")}
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => navigate("/register")}>{t("login.toRegister")}</Button>
              <Button type="submit" disabled={busy}>{busy ? t("common.pleaseWait") : t("login.submit")} <Icon name="arrow" /></Button>
            </div>
          </form>
        </Card>
        <aside className="stack">
          <Card className="tip-card"><Icon name="shield" /><h3>{t("login.tipTitle")}</h3><ul><li>{t("login.tip1")}</li><li>{t("login.tip2")}</li><li>{t("login.tip3")}</li></ul></Card>
          <Card className="help-card"><h3>{t("login.newTitle")}</h3><p>{t("login.newText")}</p><Link to="/register" className="btn btn-secondary">{t("header.register")}</Link></Card>
        </aside>
      </div>
    </main>
  );
}
