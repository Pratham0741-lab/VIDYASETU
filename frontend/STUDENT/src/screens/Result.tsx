import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import * as ep from "../api/endpoints";
import type { Grievance, SelectionResult } from "../api/responses";
import { ApplicationPicker, useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { categoryLabel, reservationLabel } from "../i18n/labels";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag, type Tone } from "../ui";

const OUTCOME_TONE: Record<string, Tone> = { SELECTED: "green", NOT_SELECTED: "red", HELD: "amber" };
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

type Breakdown = { rule_id?: string; direction?: string; read_from?: string };

export default function MeritScreen() {
  const i18n = useI18n();
  const { t, tk, formatDate } = i18n;
  const { profile } = useAuth();
  const { apps, selected, select, error: appsError } = useMyApplications();
  const [result, setResult] = useState<SelectionResult | null>(null);
  const [none, setNone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [runRef, setRunRef] = useState("");
  const [runRefFromApi, setRunRefFromApi] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [raised, setRaised] = useState<Grievance | null>(null);
  const [objError, setObjError] = useState<unknown>(null);

  useEffect(() => {
    setResult(null);
    setNone(false);
    setError(null);
    setRaised(null);
    if (!selected) return;
    setRunRef("");
    setRunRefFromApi(false);
    ep.getSelectionResult(selected.id).then(
      (r) => {
        setResult(r);
        // The objection names the selection run: from the API (list.selection_run_id) ...
        const fromApi = r.list?.selection_run_id ?? null;
        if (fromApi) {
          setRunRef(fromApi);
          setRunRefFromApi(true);
          return;
        }
        // ... or, only when the API gives none, from the non-selection notice text (fallback).
        ep.listNotifications().then((n) => {
          const notice = n.notifications.find((x) => x.application_id === selected.id && UUID.test(x.body) && /select/i.test(x.template_key + x.event_type));
          const m = notice?.body.match(UUID);
          if (m) setRunRef(m[1]);
        }, () => undefined);
      },
      (e) => {
        if (e instanceof ApiError && e.status === 404) setNone(true);
        else setError(e);
      },
    );
  }, [selected]);

  const outcome = result?.current_outcome ?? null;
  const list = result?.list ?? null;
  const windowOpen = !!list && list.status === "PROVISIONAL_PUBLISHED" && (!list.window_closes_at || new Date(list.window_closes_at) > new Date());
  const canObject = windowOpen && outcome === "NOT_SELECTED";
  // Banner colour: selected on a final list = green (base); not selected = navy; provisional / held / anything else = blue.
  const bannerTone = outcome === "NOT_SELECTED" ? "is-not-selected" : outcome === "SELECTED" && list?.status === "FINAL_PUBLISHED" ? "" : "is-provisional";
  const breakdown = (result?.score?.breakdown ?? null) as Breakdown | null;

  const object = async () => {
    if (!selected) return;
    setBusy(true);
    setObjError(null);
    try {
      setRaised(await ep.raiseGrievance({ application_id: selected.id, subject_type: "SELECTION_OBJECTION", selection_run_id: runRef.trim(), description: text.trim() }));
      setText("");
    } catch (e) {
      setObjError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={list ? t("result.eyebrow", { scheme: list.scheme_code, year: list.academic_year }) : t("result.eyebrowNone")}
        title={outcome ? tk(`result.title.${outcome}`, outcome) : t("result.titleNone")}
        description={list ? tk(`result.list.${list.status}`, list.status) : t("result.descriptionNone")}
      />
      <ApplicationPicker apps={apps} selected={selected} onSelect={select} />
      <ErrorNote error={appsError || error} />
      {apps && !selected && <InfoNote title={t("dash.noAppTitle")} text={t("dash.noAppText")} />}
      {none && <InfoNote icon="clock" title={t("reason.no_published_result")} text={t("result.noneText")} />}
      {selected && !result && !none && !error && <p>{t("common.loading")}</p>}
      {result && (
        <>
          <div className={`merit-hero ${bannerTone}`}>
            <div className="rank"><small>{t("result.rank")}</small><strong>{result.computed_rank !== null ? `#${result.computed_rank}` : "–"}</strong><span>{t("result.rankNote")}</span></div>
            <div className="merit-message">
              <Tag tone={OUTCOME_TONE[outcome ?? ""] ?? "gray"}><Icon name={outcome === "SELECTED" ? "check" : "warning"} /> {tk(`result.outcome.${outcome}`, outcome ?? "")}</Tag>
              <h2>{outcome === "SELECTED" ? t("result.congrats", { name: profile?.first_name ?? "" }) : t("result.application", { no: result.application_no })}</h2>
              <p>{result.not_selected_reason ? t("result.reason", { reason: result.not_selected_reason }) : tk(`result.help.${outcome}`, "")}</p>
            </div>
            <div className="score-total"><strong>{result.score && result.score.score_value !== null ? String(result.score.score_value) : "–"}</strong><span></span><small>{t("result.score")}</small></div>
          </div>
          <div className="merit-grid">
            <Card>
              <div className="card-heading"><div><h2>{t("result.howTitle")}</h2><p>{t("result.howText")}</p></div></div>
              {result.score ? (
                <div className="score-bars">
                  <div><div><strong>{t("result.scoreType")}</strong><span>{result.score.score_type}</span></div></div>
                  <div><div><strong>{t("result.scoreValue")}</strong><span>{String(result.score.score_value)}</span></div></div>
                  {breakdown?.rule_id && <div><div><strong>{t("result.rule")}</strong><span>{breakdown.rule_id}</span></div></div>}
                  {breakdown?.direction && <div><div><strong>{t("result.direction")}</strong><span>{tk(`result.direction.${breakdown.direction}`, breakdown.direction)}</span></div></div>}
                </div>
              ) : <p>{t("result.noScore")}</p>}
              <div className="tie-rule"><Icon name="document" /><div><strong>{t("result.decisionTitle")}</strong><p>{t("result.decisionText", { computed: tk(`result.outcome.${result.computed_outcome}`, result.computed_outcome ?? "–"), committee: result.committee_decision ? tk(`result.committee.${result.committee_decision}`, result.committee_decision) : t("result.noCommittee"), final: result.final_outcome ? tk(`result.outcome.${result.final_outcome}`, result.final_outcome) : t("result.notFinal") })}</p></div></div>
            </Card>
            <div className="side-stack">
              <Card><h3>{t("result.reservationTitle")}</h3><div className="reservation">
                <div><small>{t("result.vertical")}</small><strong>{result.vertical_category ? categoryLabel(i18n, result.vertical_category) : t("common.none")}</strong></div>
                <div><small>{t("result.horizontal")}</small><strong>{result.horizontal_reservation ? reservationLabel(i18n, result.horizontal_reservation) : t("common.none")}</strong></div>
              </div></Card>
              <Card className="objection">
                <span className="card-kicker">{t("result.windowKicker")}</span>
                <h3>{windowOpen && list?.window_closes_at ? t("result.windowCloses", { date: formatDate(list.window_closes_at, true) }) : windowOpen ? t("result.windowOpen") : t("result.windowClosed")}</h3>
                <p>{canObject ? t("result.canObject") : windowOpen ? t("result.onlyNonSelected") : t("result.noObjection")}</p>
                {raised && <InfoNote icon="check" title={t("result.objectionRaised")} text={t("result.objectionStatus", { status: raised.status })} />}
                <ErrorNote error={objError} />
                {canObject && !raised && (
                  <>
                    <label>{t(runRefFromApi ? "result.runRefApi" : "result.runRef")}<input value={runRef} readOnly={runRefFromApi} onChange={(e) => setRunRef(e.target.value)} placeholder="xxxxxxxx-xxxx-…" /></label>
                    <label>{t("result.objectionText")}<textarea className="objection-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
                    <Button variant="secondary" disabled={busy || !runRef.trim() || text.trim().length === 0} onClick={object}>{busy ? t("common.pleaseWait") : t("result.raise")}</Button>
                  </>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
