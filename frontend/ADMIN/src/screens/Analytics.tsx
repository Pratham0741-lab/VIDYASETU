import { useState, type FormEvent, type ReactNode } from "react";
import * as ep from "../api/endpoints";
import type { AnalyticsView } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { can } from "../auth/permissions";
import { useI18n, type I18n, type MessageKey } from "../i18n";
import { Action, ErrorNote, Loading, Note, useRunner } from "../ui";
import { defaultWindow } from "./Fraud";

type View = ep.AnalyticsName | "fairness";
const VIEWS: View[] = ["funnel", "sla", "fairness", "verification-quality"];
const MAX_DAYS = 366;
const DAY = 86_400_000;

/** A cell exactly as returned: numbers formatted, strings (suppression markers such as "<5" or "suppressed") verbatim. */
function cell(i18n: I18n, v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return i18n.formatNumber(v);
  if (typeof v === "boolean") return v ? i18n.t("common.yes") : i18n.t("common.no");
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function heading(key: string): string {
  return key.replace(/_/g, " ").toUpperCase();
}

function isRowArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
}

/** Renders any analytics section: row arrays as tables, objects as key/value lists. */
function Section({ name, value, i18n }: { name: string; value: unknown; i18n: I18n }): ReactNode {
  if (isRowArray(value)) {
    const cols = [...new Set(value.flatMap((r) => Object.keys(r)))].filter((c) => !value.every((r) => r[c] !== null && typeof r[c] === "object"));
    return <div className="analytics-section"><div className="form-section-title">{heading(name)}</div>
      {value.length === 0 ? <div className="muted">{i18n.t("analytics.noRows")}</div> : <table><thead><tr>{cols.map((c) => <th key={c}>{heading(c)}</th>)}</tr></thead>
        <tbody>{value.map((r, k) => <tr key={k}>{cols.map((c) => <td key={c}>{cell(i18n, r[c])}</td>)}</tr>)}</tbody></table>}
    </div>;
  }
  if (Array.isArray(value)) {
    return <div className="analytics-section"><div className="form-section-title">{heading(name)}</div>
      {value.length === 0 ? <div className="muted">{i18n.t("analytics.noRows")}</div> : <ul className="plain-list">{value.map((v, k) => <li key={k}>{cell(i18n, v)}</li>)}</ul>}
    </div>;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const flat = entries.filter(([, v]) => v === null || typeof v !== "object");
    const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
    return <div className="analytics-section"><div className="form-section-title">{heading(name)}</div>
      {flat.length > 0 && <div className="kv-grid">{flat.map(([k, v]) => <div key={k}><span>{heading(k)}</span><strong>{cell(i18n, v)}</strong></div>)}</div>}
      {nested.map(([k, v]) => <Section key={k} name={`${name} · ${k}`} value={v} i18n={i18n} />)}
    </div>;
  }
  return <div className="analytics-section"><div className="form-section-title">{heading(name)}</div><div>{cell(i18n, value)}</div></div>;
}

export default function AnalyticsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const views = VIEWS.filter((v) => (v === "fairness" ? can(me?.role, "analytics.fairness") : can(me?.role, "analytics.core")));
  const [view, setView] = useState<View>(views[0] ?? "fairness");
  const [year, setYear] = useState("");
  const initial = defaultWindow();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [scheme, setScheme] = useState("");
  const [data, setData] = useState<AnalyticsView | null>(null);
  const runner = useRunner();

  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);
  const windowOk = !Number.isNaN(days) && days > 0 && days <= MAX_DAYS;
  const fairness = view === "fairness";
  const schemeOk = fairness ? /^[A-Z][A-Z0-9_]{1,49}$/.test(scheme) && /^\d{4}-\d{2}$/.test(year) : scheme === "" || /^[A-Z][A-Z0-9_]{1,49}$/.test(scheme);
  const inputsOk = fairness ? schemeOk : windowOk && schemeOk;

  const load = (e?: FormEvent) => {
    e?.preventDefault();
    if (!inputsOk) return;
    void runner.run(async () => setData(view === "fairness" ? await ep.getFairness({ scheme, academic_year: year }) : await ep.getAnalytics(view, { from, to, scheme: scheme || undefined })));
  };

  const meta = data?.meta ?? {};
  return <div className="screen analytics-screen">
    <div className="page-header compact"><div><div className="page-title">{t("analytics.title")}</div><div className="page-subtitle">{t("analytics.subtitle")}</div></div></div>
    <section className="card table-card">
      <form className="table-toolbar analytics-controls" onSubmit={load}>
        <div className="table-tools">{views.map((v) => <button key={v} type="button" className={`filter-pill${view === v ? " lang-active" : ""}`} onClick={() => { setView(v); setData(null); }}>{t(`analytics.view.${v}` as MessageKey)}</button>)}</div>
        <div className="table-tools">
          {!fairness && <label className="form-control"><span className="field-label">{t("analytics.from")}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>}
          {!fairness && <label className="form-control"><span className="field-label">{t("analytics.to")}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>}
          {fairness && <label className="form-control"><span className="field-label">{t("analytics.year")}</span><input value={year} placeholder="2026-27" onChange={(e) => setYear(e.target.value)} /></label>}
          <label className="form-control"><span className="field-label">{fairness ? t("analytics.schemeRequired") : t("analytics.scheme")}</span><input value={scheme} placeholder="NFST" onChange={(e) => setScheme(e.target.value.toUpperCase())} /></label>
          <Action variant="primary" disabled={!inputsOk || runner.busy} onClick={() => load()}>{t("analytics.load")}</Action>
        </div>
      </form>
      <div className="decision-body">
        {fairness ? <div className="hint">{t("analytics.fairnessHint")}</div> : <div className={windowOk ? "hint" : "hint-danger"}>{t("analytics.windowHint", { days: Number.isNaN(days) ? "–" : days, max: MAX_DAYS })}</div>}
        <ErrorNote error={runner.error} />
        {runner.busy && <Loading />}
        {!data && !runner.busy && <Note tone="info">{t("analytics.pick")}</Note>}
        {data && <>
          <Note tone="info" title={t("analytics.asReturned")}>{typeof meta.suppression === "string" ? meta.suppression : t("analytics.noSuppression")}</Note>
          {Object.entries(data).filter(([k]) => k !== "meta").map(([k, v]) => <Section key={k} name={k} value={v} i18n={i18n} />)}
          <details className="metrics-detail"><summary>{t("analytics.meta")}</summary><Section name="meta" value={meta} i18n={i18n} /></details>
        </>}
      </div>
    </section>
  </div>;
}
