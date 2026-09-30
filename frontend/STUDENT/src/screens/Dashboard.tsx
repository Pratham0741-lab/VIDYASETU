import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { Application, ApplicationDocuments, HistoryEntry, Notification, Stage } from "../api/responses";
import { ApplicationPicker, useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
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
    <div className="timeline" style={steps.length !== 5 ? { gridTemplateColumns: `repeat(${steps.length}, minmax(150px, 1fr))` } : undefined}>
      {steps.map((step, index) => (
        <div className={step.state} key={step.key}>
          <span>{step.state === "complete" ? <Icon name="check" /> : index + 1}</span>
          <strong>{i18n.tk(`stage.${step.stage}`, humanise(step.stage))}</strong>
          <small>{step.meta}</small>
        </div>
      ))}
    </div>
  );
}

export default function DashboardScreen() {
  const { t, formatDate } = useI18n();
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

  const markRead = async (id: string) => {
    try {
      await ep.markNotificationRead(id);
      setNotes((list) => list?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) ?? null);
    } catch (e) {
      setError(e);
    }
  };

  const uploaded = docs ? docs.slots.filter((s) => s.state !== "MISSING").length : 0;
  const needsAction = docs ? docs.slots.filter((s) => s.state === "QUALITY_REJECTED" || s.state === "FAILED").length : 0;
  const unread = notes?.filter((n) => !n.read_at).length ?? 0;
  const appNotes = notes?.filter((n) => !selected || !n.application_id || n.application_id === selected.id) ?? [];

  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={t("dash.eyebrow")}
        title={t("dash.hello", { name: profile?.first_name ?? "" })}
        description={t("dash.description")}
        action={selected ? <Button variant="secondary" icon="document" onClick={() => navigate(`/apply?app=${encodeURIComponent(selected.id)}`)}>{t("dash.viewDocuments")}</Button> : undefined}
      />
      <ApplicationPicker apps={apps} selected={selected} onSelect={select} />
      <ErrorNote error={appsError || error} />
      {apps && !selected && (
        <Card className="timeline-card"><div className="card-heading"><div><h2>{t("dash.noAppTitle")}</h2><p>{t("dash.noAppText")}</p></div><Button onClick={() => navigate("/apply")}>{t("checker.toApply")} <Icon name="arrow" /></Button></div></Card>
      )}
      {!apps && !appsError && <p>{t("common.loading")}</p>}
      {selected && (
        <>
          <div className="status-hero">
            <div>
              <Tag tone={STATUS_TONE[selected.status] ?? "gray"}>{t(`status.${selected.status}` as MessageKey)}</Tag>
              <h2>{t(`stageHero.${selected.current_stage}` as MessageKey)}</h2>
              <p>{t(`stageHelp.${selected.current_stage}` as MessageKey)}</p>
              {selected.current_stage === "DEFECTIVE" && <p><Button variant="secondary" onClick={() => navigate(`/deficiencies?app=${encodeURIComponent(selected.id)}`)}>{t("dash.toDeficiencies")}</Button></p>}
            </div>
            <div className="id-block"><small>{t("dash.applicationId")}</small><strong>{selected.application_no}</strong><span>{selected.submitted_at ? t("dash.submittedOn", { date: formatDate(selected.submitted_at) }) : ""} · {selected.academic_year}</span></div>
          </div>
          <Card className="timeline-card">
            <div className="card-heading"><div><h2>{t("dash.journeyTitle")}</h2><p>{history ? t("dash.journeyText") : t("dash.journeyFallback")}</p></div><span className="live-dot">{t("dash.fromApi")}</span></div>
            <ErrorNote error={historyError} />
            <Timeline app={selected} history={history} />
          </Card>
          <div className="three-cards">
            <Card><span className="card-kicker">{t("dash.cardStage")}</span><h3>{selected.stage_due_at ? t("dash.dueBy", { date: formatDate(selected.stage_due_at) }) : t("dash.noDue")}</h3><p>{t("dash.slaNote")}</p></Card>
            <Card><span className="card-kicker">{t("dash.cardDocs")}</span><h3>{docs ? t("dash.docsCount", { n: uploaded, m: docs.slots.length }) : t("common.loading")}</h3><p>{needsAction ? t("dash.docsAction", { n: needsAction }) : t("dash.docsOk")}</p></Card>
            <Card><span className="card-kicker">{t("dash.cardNotes")}</span><h3>{notes ? t("dash.unread", { n: unread }) : t("common.loading")}</h3><p>{t("dash.notesNote")}</p></Card>
          </div>
        </>
      )}
      <Card className="timeline-card notifications-card">
        <div className="card-heading"><div><h2>{t("dash.notesTitle")}</h2><p>{t("dash.notesText")}</p></div></div>
        {notes && appNotes.length === 0 && <p>{t("dash.notesEmpty")}</p>}
        {appNotes.length > 0 && (
          <div className="check-table">
            {appNotes.map((n) => (
              <div className="check-row" key={n.id}>
                <span className="rule-check">{n.read_at ? <Icon name="check" /> : <Icon name="clock" />}</span>
                <div><small>{formatDate(n.created_at, true)}</small><strong>{n.subject ?? n.event_type}</strong><small className="note-body">{n.body}</small></div>
                <div>{n.read_at ? <Tag tone="gray">{t("dash.read")}</Tag> : <Button variant="secondary" onClick={() => markRead(n.id)}>{t("dash.markRead")}</Button>}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
