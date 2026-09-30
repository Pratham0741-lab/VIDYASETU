import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import * as ep from "../api/endpoints";
import type { Grievance, SelectionResult } from "../api/responses";
import { ApplicationPicker, useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { categoryLabel, humanise, reservationLabel } from "../i18n/labels";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag, type Tone } from "../ui";

const OUTCOME_TONE: Record<string, Tone> = { SELECTED: "green", NOT_SELECTED: "red", HELD: "amber" };

type Scalar = string | number | boolean;
type Part = { label: string; value: number | null; max: number | null; raw: Record<string, unknown> };

const isScalar = (v: unknown): v is Scalar => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The score breakdown exactly as returned (free-form object): scalar fields
 * become label/value rows; an array of objects becomes one row per part,
 * drawn as a bar only when the part has both a value and a maximum.
 */
function readBreakdown(breakdown: unknown): { fields: Array<[string, Scalar]>; parts: Part[] } {
  const fields: Array<[string, Scalar]> = [];
  const parts: Part[] = [];
  if (!breakdown || typeof breakdown !== "object") return { fields, parts };
  for (const [key, value] of Object.entries(breakdown as Record<string, unknown>)) {
    if (isScalar(value)) fields.push([key, value]);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const label = [o.label, o.name, o.component, o.rule_id, o.key].find((x): x is string => typeof x === "string") ?? key;
        parts.push({ label, value: num(o.value ?? o.score ?? o.points), max: num(o.max ?? o.out_of ?? o.weight), raw: o });
      }
    }
  }
  return { fields, parts };
}

export default function MeritScreen() {
  const i18n = useI18n();
  const { t, tk, formatDate, formatNumber } = i18n;
  const { profile } = useAuth();
  const { apps, selected, select, error: appsError } = useMyApplications();
  const [result, setResult] = useState<SelectionResult | null>(null);
  const [none, setNone] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
    ep.getSelectionResult(selected.id).then(setResult, (e) => {
      if (e instanceof ApiError && e.status === 404) setNone(true);
      else setError(e);
    });
  }, [selected]);

  const outcome = result?.current_outcome ?? null;
  const list = result?.list ?? null;
  const runId = list?.selection_run_id ?? null;
  const windowOpen = !!list && list.status === "PROVISIONAL_PUBLISHED" && (!list.window_closes_at || new Date(list.window_closes_at) > new Date());
  const canObject = windowOpen && outcome === "NOT_SELECTED" && !!runId;
  // Banner colour (F1-C): selected on a final list = green; not selected = navy; provisional / held / anything else = blue.
  const bannerTone = outcome === "NOT_SELECTED" ? "is-not-selected" : outcome === "SELECTED" && list?.status === "FINAL_PUBLISHED" ? "is-final" : "is-provisional";
  const rank = result?.computed_rank ?? null;
  const scoreValue = result?.score?.score_value ?? null;
  const { fields, parts } = readBreakdown(result?.score?.breakdown);
  const firstName = profile?.first_name?.trim();
  const fieldLabel = (k: string) => (k === "rule_id" ? t("result.rule") : k === "direction" ? t("result.direction") : tk(`result.breakdown.${k}`, humanise(k)));
  const fieldValue = (k: string, v: Scalar) => (k === "direction" ? tk(`result.direction.${v}`, String(v)) : typeof v === "number" ? formatNumber(v) : String(v));

  const object = async () => {
    if (!selected || !runId) return;
    setBusy(true);
    setObjError(null);
    try {
      setRaised(await ep.raiseGrievance({ application_id: selected.id, subject_type: "SELECTION_OBJECTION", selection_run_id: runId, description: text.trim() }));
      setText("");
    } catch (e) {
      setObjError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-page merit-page">
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
          <section className={`merit-hero ${bannerTone}`} aria-labelledby="merit-message">
            {rank !== null && (
              <div className="rank"><span className="merit-label">{t("result.rank")}</span><strong className="num">#{formatNumber(rank)}</strong><span className="merit-note">{t("result.rankNote")}</span></div>
            )}
            <div className="merit-message">
              <Tag tone={OUTCOME_TONE[outcome ?? ""] ?? "gray"}><Icon name={outcome === "SELECTED" ? "check" : "warning"} /> {tk(`result.outcome.${outcome}`, outcome ?? "")}</Tag>
              <h2 id="merit-message">
                {outcome === "SELECTED" ? (firstName ? t("result.congrats", { name: firstName }) : t("result.congratsNoName")) : t("result.application", { no: result.application_no })}
              </h2>
              {result.not_selected_reason ? <p>{t("result.reason", { reason: tk(`reason.${result.not_selected_reason}`, result.not_selected_reason) })}</p> : tk(`result.help.${outcome}`, "") && <p>{tk(`result.help.${outcome}`, "")}</p>}
            </div>
            {scoreValue !== null && (
              <div className="score-total"><strong className="num">{formatNumber(scoreValue)}</strong><span className="merit-label">{t("result.score")}</span></div>
            )}
          </section>
          <div className="split merit-grid">
            <Card>
              <div className="card-heading"><div><h2>{t("result.howTitle")}</h2><p>{t("result.howText")}</p></div></div>
              {result.score ? (
                <>
                  <dl className="kv">
                    <dt>{t("result.scoreType")}</dt><dd>{tk(`result.scoreType.${result.score.score_type}`, humanise(result.score.score_type))}</dd>
                    {scoreValue !== null && <><dt>{t("result.scoreValue")}</dt><dd className="num">{formatNumber(scoreValue)}</dd></>}
                    {fields.map(([k, v]) => <FieldRow key={k} label={fieldLabel(k)} value={fieldValue(k, v)} />)}
                  </dl>
                  {parts.length > 0 && (
                    <ul className="score-parts">
                      {parts.map((p, i) => (
                        <li key={`${p.label}-${i}`}>
                          <div className="score-part-head"><strong>{tk(`result.part.${p.label}`, humanise(p.label))}</strong>{p.value !== null && <span className="num">{p.max !== null ? t("result.outOf", { value: formatNumber(p.value), max: formatNumber(p.max) }) : formatNumber(p.value)}</span>}</div>
                          {p.value !== null && p.max !== null && p.max > 0 && (
                            <div className="bar" role="presentation"><i style={{ width: `${Math.max(0, Math.min(100, (p.value / p.max) * 100))}%` }} /></div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : <p>{t("result.noScore")}</p>}
              <div className="decision-note">
                <Icon name="document" />
                <div><strong>{t("result.decisionTitle")}</strong><p>{t("result.decisionText", { computed: tk(`result.outcome.${result.computed_outcome}`, result.computed_outcome), committee: result.committee_decision ? tk(`result.committee.${result.committee_decision}`, result.committee_decision) : t("result.noCommittee"), final: result.final_outcome ? tk(`result.outcome.${result.final_outcome}`, result.final_outcome) : t("result.notFinal") })}</p></div>
              </div>
            </Card>
            <div className="stack">
              <Card>
                <h3>{t("result.reservationTitle")}</h3>
                <dl className="kv reservation">
                  <dt>{t("result.vertical")}</dt><dd>{result.vertical_category ? categoryLabel(i18n, result.vertical_category) : t("common.none")}</dd>
                  <dt>{t("result.horizontal")}</dt><dd>{result.horizontal_reservation ? reservationLabel(i18n, result.horizontal_reservation) : t("common.none")}</dd>
                </dl>
              </Card>
              {list && (
                <Card className="objection">
                  <h3><Icon name="clock" /> {t("result.windowKicker")}</h3>
                  <p className="num">{windowOpen && list.window_closes_at ? t("result.windowCloses", { date: formatDate(list.window_closes_at, true) }) : windowOpen ? t("result.windowOpen") : t("result.windowClosed")}</p>
                  <p className="muted">{canObject ? t("result.canObject") : windowOpen ? t("result.onlyNonSelected") : t("result.noObjection")}</p>
                  {raised && <InfoNote icon="check" title={t("result.objectionRaised")} text={t("result.objectionStatus", { status: raised.status })} />}
                  <ErrorNote error={objError} />
                  {canObject && !raised && (
                    <>
                      <label htmlFor="objection-text">{t("result.objectionText")}</label>
                      <textarea id="objection-text" className="objection-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
                      <Button variant="secondary" disabled={busy || text.trim().length === 0} onClick={object}>{busy ? t("common.pleaseWait") : t("result.raise")}</Button>
                    </>
                  )}
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd className="num">{value}</dd></>;
}
