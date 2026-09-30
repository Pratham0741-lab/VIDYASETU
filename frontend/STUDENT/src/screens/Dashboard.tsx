import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { Application, ApplicationDocuments, ConsentState, HistoryEntry, Notification, Stage } from "../api/responses";
import { ApplicationPicker, useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
import { NOTIFICATIONS_CHANGED } from "../layout";
import { useI18n, type MessageKey } from "../i18n";
import { humanise } from "../i18n/labels";
import { Button, Card, ErrorNote, Icon, ScreenTitle, Tag, type Tone } from "../ui";

/** The review path of the backend workflow (vidyasetu-scrutiny/v1), in order. */
const PATH: Stage[] = ["SUBMITTED", "INO_VERIFIED", "DNO_VERIFIED", "SNO_VERIFIED", "MINISTRY_APPROVED"];

const STATUS_TONE: Record<string, Tone> = {
  PENDING: "blue",
  UNDER_REVIEW: "blue",
  DEFECTIVE: "red",
  APPROVED: "green",
  REJECTED: "red",
  DISBURSED: "green",
};

type Step = { key: string; stage: string; state: "complete" | "current" | ""; meta: string };

/**
 * Timeline from GET /applications/{id}/history (oldest first): the
 * submission, then one step per recorded transition (its action and date),
 * then the review stages still ahead. Without history (request failed) it
 * falls back to the stage order with the dates on the application record.
 */
function buildSteps(app: Application, history: HistoryEntry[] | null, i18n: ReturnType<typeof useI18n>): Step[] {
  const { t, tk, formatDate } = i18n;
  const action = (a: string) => tk(`history.action.${a}`, humanise(a));
  const stageName = (stage: string) => tk(`stage.${stage}`, humanise(stage));
  /** The action label, unless it says the same as the stage name shown above it (then only once). */
  const actionFor = (a: string, stage: string) => {
    const text = action(a);
    return text.trim().toLocaleLowerCase() === stageName(stage).trim().toLocaleLowerCase() ? "" : text;
  };
  const currentMeta = () => {
    let meta = app.stage_entered_at ? t("timeline.since", { date: formatDate(app.stage_entered_at) }) : "";
    if (app.stage_due_at) meta += `${meta ? " · " : ""}${t("timeline.target", { date: formatDate(app.stage_due_at) })}`;
    return meta;
  };
  if (!history) {
    const reached = app.current_stage === "DISBURSED" ? PATH.length : PATH.indexOf(app.current_stage);
    return PATH.map((stage, index) => {
      const done = reached >= 0 && index < reached;
      const current = index === reached;
      const meta = stage === "SUBMITTED" && app.submitted_at ? formatDate(app.submitted_at, true) : current ? currentMeta() : done ? t("timeline.passed") : "";
      return { key: stage, stage, state: done ? "complete" : current ? "current" : "", meta };
    });
  }
  const steps: Step[] = [
    { key: "submitted", stage: "SUBMITTED", state: "complete", meta: app.submitted_at ? formatDate(app.submitted_at, true) : history[0] ? formatDate(history[0].at, true) : "" },
  ];
  history.forEach((h, i) => {
    const last = i === history.length - 1;
    const terminal = h.to_stage === "REJECTED" || h.to_stage === "DISBURSED";
    const label = actionFor(h.trigger_action, h.to_stage);
    const base = label ? `${label} · ${formatDate(h.at, true)}` : formatDate(h.at, true);
    const extra = last && !terminal ? currentMeta() : "";
    steps.push({ key: `${i}-${h.to_stage}`, stage: h.to_stage, state: last && !terminal ? "current" : "complete", meta: extra ? `${base} · ${extra}` : base });
  });
  if (history.length === 0) steps[0].state = "current";
  // Review stages still ahead: after the last on-path stage reached (a DEFECTIVE application returns there).
  const lastOnPath = [...history].reverse().find((h) => PATH.includes(h.to_stage as Stage))?.to_stage ?? "SUBMITTED";
  const ended = app.current_stage === "REJECTED" || app.current_stage === "DISBURSED";
  if (!ended) PATH.slice(PATH.indexOf(lastOnPath as Stage) + 1).forEach((stage) => steps.push({ key: `next-${stage}`, stage, state: "", meta: "" }));
  return steps;
}

function Timeline({ app, history }: { app: Application; history: HistoryEntry[] | null }) {
  const i18n = useI18n();
  const steps = buildSteps(app, history, i18n);
  return (
    <ol className="journey">
      {steps.map((step, index) => (
        <li className={step.state} key={step.key} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="journey-node num" aria-hidden="true">{step.state === "complete" ? <Icon name="check" /> : index + 1}</span>
          <span className="sr-only">{i18n.t("dash.journeyStep", { n: index + 1 })}</span>
          <strong>{i18n.tk(`stage.${step.stage}`, humanise(step.stage))}</strong>
          {step.meta && <small className="num">{step.meta}</small>}
        </li>
      ))}
    </ol>
  );
}

export default function DashboardScreen() {
  const { t, formatDate } = useI18n();
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { apps, selected, select, error: appsError } = useMyApplications();
  const [docs, setDocs] = useState<ApplicationDocuments | null>(null);
  const [notes, setNotes] = useState<Notification[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setDocs(null);
    setHistory(null);
    setHistoryError(null);
    if (!selected) return;
    ep.listDocuments(selected.id).then(setDocs, setError);
    ep.getApplicationHistory(selected.id).then((h) => setHistory(h.history), setHistoryError);
  }, [selected]);

  const loadNotes = useCallback(() => {
    ep.listNotifications().then((r) => setNotes(r.notifications), setError);
  }, []);
  useEffect(loadNotes, [loadNotes]);
  useEffect(() => {
    // The Contact card only; a failure hides the consent line.
    ep.getConsents().then(setConsents, () => setConsents(null));
  }, []);

  const markRead = async (id: string) => {
    try {
      await ep.markNotificationRead(id);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      setNotes((list) => list?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) ?? null);
    } catch (e) {
      setError(e);
    }
  };

  const uploaded = docs ? docs.slots.filter((s) => s.state !== "MISSING").length : 0;
  const needsAction = docs ? docs.slots.filter((s) => s.state === "QUALITY_REJECTED" || s.state === "FAILED").length : 0;
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;
  const appNotes = notes?.filter((n) => !selected || !n.application_id || n.application_id === selected.id) ?? [];

  const firstName = profile?.first_name?.trim();
  const given = consents?.purposes.filter((p) => p.status === "GIVEN").length ?? 0;
  const language = profile?.preferred_language === "hi" ? t("lang.hi") : profile?.preferred_language === "en" ? t("lang.en") : null;

  return (
    <main className="app-page track-page">
      <ScreenTitle
        eyebrow={t("dash.eyebrow")}
        title={firstName ? t("dash.hello", { name: firstName }) : t("dash.titleNoName")}
        description={t("dash.description")}
        action={selected ? <Button variant="secondary" icon="document" onClick={() => navigate(`/apply?app=${encodeURIComponent(selected.id)}`)}>{t("dash.viewDocuments")}</Button> : undefined}
      />
      <ApplicationPicker apps={apps} selected={selected} onSelect={select} />
      <ErrorNote error={appsError || error} />
      {apps && !selected && (
        <Card><div className="card-heading"><div><h2>{t("dash.noAppTitle")}</h2><p>{t("dash.noAppText")}</p></div><Button onClick={() => navigate("/apply")}>{t("checker.toApply")} <Icon name="arrow" /></Button></div></Card>
      )}
      {!apps && !appsError && <p>{t("common.loading")}</p>}
      {selected && (
        <>
          <section className={`banner status-banner is-${selected.status.toLowerCase()}`} aria-labelledby="status-title">
            <span className="status-icon" aria-hidden="true"><Icon name={selected.current_stage === "DEFECTIVE" ? "warning" : "info"} size={24} /></span>
            <div className="status-copy">
              <Tag tone={STATUS_TONE[selected.status] ?? "gray"}>{t(`status.${selected.status}` as MessageKey)}</Tag>
              <h2 id="status-title">{t(`stageHero.${selected.current_stage}` as MessageKey)}</h2>
              <p>{t(`stageHelp.${selected.current_stage}` as MessageKey)}</p>
              {selected.current_stage === "DEFECTIVE" && <Button variant="secondary" onClick={() => navigate(`/deficiencies?app=${encodeURIComponent(selected.id)}`)}>{t("dash.toDeficiencies")} <Icon name="arrow" /></Button>}
            </div>
            <dl className="id-block">
              <dt>{t("dash.applicationId")}</dt>
              <dd className="num">{selected.application_no}</dd>
              {(selected.submitted_at || selected.academic_year) && (
                <dd className="id-meta num">{[selected.submitted_at ? t("dash.submittedOn", { date: formatDate(selected.submitted_at) }) : "", selected.academic_year].filter(Boolean).join(" · ")}</dd>
              )}
            </dl>
          </section>
          <Card className="journey-card">
            <div className="card-heading"><div><h2>{t("dash.journeyTitle")}</h2><p>{history ? t("dash.journeyText") : t("dash.journeyFallback")}</p></div></div>
            <ErrorNote error={historyError} />
            <Timeline app={selected} history={history} />
          </Card>
          <div className="card-grid track-cards">
            <Card className="info-card">
              <span className="info-icon"><Icon name="calendar" size={24} /></span>
              <div>
                <h3>{t("dash.cardStage")}</h3>
                <p className="num">{selected.stage_due_at ? t("dash.dueBy", { date: formatDate(selected.stage_due_at) }) : t("dash.noDue")}</p>
                {selected.stage_due_at && <p className="muted">{t("dash.slaNote")}</p>}
              </div>
            </Card>
            <Card className="info-card accent-green">
              <span className="info-icon"><Icon name="document" size={24} /></span>
              <div>
                <h3>{t("dash.cardDocs")}</h3>
                <p className="num">{docs ? t("dash.docsCount", { n: uploaded, m: docs.slots.length }) : t("common.loading")}</p>
                {docs && <p className="muted">{needsAction ? t("dash.docsAction", { n: needsAction }) : t("dash.docsOk")}</p>}
              </div>
            </Card>
            <Card className="info-card accent-amber">
              <span className="info-icon"><Icon name="mail" size={24} /></span>
              <div>
                <h3>{t("dash.cardContact")}</h3>
                <p className="num">{notes ? t("dash.contactInApp", { n: unread }) : t("common.loading")}</p>
                {language && <p className="muted">{t("dash.contactLanguage", { lang: language })}</p>}
                {consents && consents.purposes.length > 0 && <p className="muted num">{t("dash.consentsGiven", { n: given, m: consents.purposes.length })}</p>}
                <Link to="/consent" className="text-link">{t("dash.manageConsent")}</Link>
              </div>
            </Card>
          </div>
        </>
      )}
      <Card className="notifications-card" id="notifications">
        <div className="card-heading"><div><h2>{t("dash.notesTitle")}</h2><p>{t("dash.notesText")}</p></div></div>
        {!notes && <p>{t("common.loading")}</p>}
        {notes && appNotes.length === 0 && <p>{t("dash.notesEmpty")}</p>}
        {appNotes.length > 0 && (
          <div className="check-table">
            {appNotes.map((n) => (
              <div className="check-row" key={n.id}>
                <span className="rule-check">{n.read_at ? <Icon name="check" /> : <Icon name="bell" />}</span>
                <div><small className="num">{formatDate(n.created_at, true)}</small><strong>{n.subject ?? n.event_type}</strong>{n.body && <p className="note-body">{n.body}</p>}</div>
                <div>{n.read_at ? <Tag tone="gray">{t("dash.read")}</Tag> : <Button variant="secondary" className="btn-sm" onClick={() => markRead(n.id)}>{t("dash.markRead")}</Button>}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
