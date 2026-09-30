import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { ConsentPurpose, ConsentState } from "../api/responses";
import { useI18n } from "../i18n";
import { Button, Card, ErrorNote, Icon, ScreenTitle, Tag } from "../ui";

/**
 * Consent (DPDP). Purposes, notice version and notice texts all come from
 * GET /applicants/me/consents, in the applicant's preferred language. Each
 * give / withdraw is a new record on the server.
 */
export default function ConsentScreen() {
  const { t, lang, formatDate } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { next?: string } | null)?.next ?? "/apply";
  const [state, setState] = useState<ConsentState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await ep.getConsents());
    } catch (e) {
      setError(e);
    }
  }, []);

  // Reload when the language changes: the notice texts are served in the profile language.
  useEffect(() => {
    load();
  }, [load, lang]);

  const decide = async (purpose: ConsentPurpose, status: "GIVEN" | "WITHDRAWN") => {
    if (!state) return;
    setBusy(purpose.purpose);
    setError(null);
    try {
      setState(await ep.recordConsent({ purpose: purpose.purpose, status, notice_version: state.notice_version, language: state.language }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const missing = state?.missing_for_applications ?? [];
  const lastChange = state?.history.length ? state.history[state.history.length - 1].at : null;
  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={t("consent.eyebrow")}
        title={t("consent.title")}
        description={t("consent.description")}
        action={state ? <Tag tone="blue">{t("consent.noticeVersion", { version: state.notice_version })}</Tag> : undefined}
      />
      <div className="split">
        <Card>
          <div className="card-heading"><div><span className="eyebrow">{t("consent.purposesEyebrow")}</span><h2>{missing.length ? t("consent.missingTitle") : t("consent.completeTitle")}</h2><p>{missing.length ? t("consent.missingText") : t("consent.completeText")}</p></div></div>
          <ErrorNote error={error} />
          {!state && !error && <p>{t("common.loading")}</p>}
          {state && state.purposes.length === 0 && <p>{t("common.empty")}</p>}
          {state && state.purposes.length > 0 && (
            <div className="check-table">
              {state.purposes.map((p) => (
                <div className="check-row" key={p.purpose}>
                  <span className="rule-check">{p.current ? <Icon name="check" /> : <Icon name="warning" />}</span>
                  <div>
                    <small>{p.required_for_applications ? t("consent.required") : t("consent.optional")}</small>
                    <strong>{p.title}</strong>
                    <small>{p.text}</small>
                  </div>
                  <div>
                    <Tag tone={p.current ? "green" : p.status === "WITHDRAWN" ? "red" : "amber"}>{t(p.current ? "consent.status.GIVEN" : p.status === "WITHDRAWN" ? "consent.status.WITHDRAWN" : "consent.status.NOT_GIVEN")}</Tag>
                    <small>
                      {p.current ? (
                        <Button variant="ghost" disabled={busy !== null} onClick={() => decide(p, "WITHDRAWN")}>{t("consent.withdraw")}</Button>
                      ) : (
                        <Button variant="secondary" disabled={busy !== null} onClick={() => decide(p, "GIVEN")}>{busy === p.purpose ? t("common.pleaseWait") : t("consent.give")}</Button>
                      )}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="human-note"><Icon name="user" /><div><strong>{t("consent.noteTitle")}</strong><p>{t("consent.noteText")}</p></div></div>
          <div className="form-actions">
            <Button disabled={!state || missing.length > 0} onClick={() => navigate(next)}>{t("consent.continue")} <Icon name="arrow" /></Button>
          </div>
        </Card>
        <Card className="documents-card">
          <h3>{t("consent.historyTitle")}</h3>
          {state && state.history.length === 0 && <p>{t("consent.historyEmpty")}</p>}
          {state?.history.slice().reverse().slice(0, 8).map((h, i) => (
            <div className="doc-row" key={`${h.at}-${i}`}>
              <Icon name="document" />
              <div><strong>{state.purposes.find((p) => p.purpose === h.purpose)?.title ?? h.purpose}</strong><small>{formatDate(h.at, true)} · {h.notice_version}</small></div>
              {h.status === "GIVEN" ? <Icon name="check" /> : <Icon name="warning" />}
            </div>
          ))}
          {lastChange && <p>{t("consent.lastChange", { date: formatDate(lastChange, true) })}</p>}
        </Card>
      </div>
    </main>
  );
}
