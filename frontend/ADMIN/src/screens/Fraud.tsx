import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { Cell, FraudAnalytics, FraudFlag, FraudFlags, QueueItem, Severity } from "../api/responses";
import type { Disposition } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { can } from "../auth/permissions";
import { useI18n, type I18n, type MessageKey } from "../i18n";
import { Action, Badge, ErrorNote, Icon, Loading, Note, ReasonField, reasonOk, shortId, useRunner, type IconName, type Tone } from "../ui";
import { stageLabel } from "./Scrutiny";

const FLAG_ICONS: Record<string, IconName> = {
  SHARED_BANK_ACCOUNT: "bank",
  REPEATED_CERTIFICATE_NUMBER: "copy",
  DUPLICATE_FILE_HASH: "file",
  FUZZY_IDENTITY_MATCH: "users",
  INSTITUTION_SURGE: "alert",
};
const SEVERITY_TONE: Record<Severity, Tone> = { HIGH: "danger", MEDIUM: "warning", LOW: "info" };
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const DISPOSITIONS: Disposition[] = ["CONFIRMED", "FALSE_POSITIVE", "NEEDS_MORE_INFO"];

export function flagLabel(i18n: I18n, type: string): string {
  return i18n.tk(`flag.${type}`, type);
}

/** A count cell exactly as returned: numbers formatted, suppression markers verbatim. */
export function cellText(i18n: I18n, v: Cell): string {
  if (v === null || v === undefined) return "–";
  return typeof v === "number" ? i18n.formatNumber(v) : String(v);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Default analytics window: the last 365 days up to and including today (to is exclusive). */
export function defaultWindow(): { from: string; to: string } {
  const to = new Date(Date.now() + 86_400_000);
  const from = new Date(to.getTime() - 366 * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

/** One table row, from either source (queue rows or the jurisdiction scan). */
interface FraudRow {
  id: string;
  application_no: string;
  institution: string | null;
  current_stage: string;
  held: boolean;
  /** open flags: not FALSE_POSITIVE */
  flags: Array<{ flag_type: string; severity: Severity; status: string }>;
}

const sevRank = (s: string) => SEVERITY_RANK[s as Severity] ?? 9;

/** GET /applications returns at most this many rows (newest first) and has no paging. */
const LIST_CAP = 100;

/**
 * Jurisdiction-wide source: the applications visible to the caller
 * (GET /applications, at most 100) and the flags of each. The scrutiny queue
 * lists only the stages of the caller, so held applications waiting at
 * another level would be missing from it (live pass M16, BACKEND_REQUESTS R8).
 */
async function scanJurisdiction(level: "HIGH" | "ANY", onProgress: (done: number, total: number) => void): Promise<FraudRow[]> {
  const apps = (await ep.listApplications()) ?? [];
  const rows: FraudRow[] = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < apps.length) {
      const a = apps[next++];
      const f = await ep.getFraudFlags(a.id);
      const open = (f.flags ?? []).filter((x) => x.status !== "FALSE_POSITIVE" && x.subject_type !== "INSTITUTION");
      const held = !!f.held;
      if (level === "HIGH" ? held : open.length > 0) {
        rows.push({ id: a.id, application_no: a.application_no, institution: a.institution_name ?? a.institution_code ?? null, current_stage: a.current_stage, held, flags: open });
      }
      onProgress(++done, apps.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, apps.length) }, worker));
  return rows.sort((x, y) => x.application_no.localeCompare(y.application_no));
}

function fromQueue(items: QueueItem[]): FraudRow[] {
  return items.map((r) => ({ id: r.id, application_no: r.application_no, institution: r.institution_name ?? r.institution_code ?? null, current_stage: r.current_stage, held: !!r.fraud?.held, flags: r.fraud?.flags ?? [] }));
}

export default function FraudPanel() {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const canAct = can(me?.role, "fraud.act");
  const [params, setParams] = useSearchParams();
  const level = params.get("level") === "ANY" ? "ANY" : "HIGH";
  // Queue source only for roles with a queue; everyone else scans the jurisdiction.
  const source = canAct && params.get("source") === "queue" ? "queue" : "jurisdiction";
  const selectedId = params.get("app");
  const [rows, setRows] = useState<FraudRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [metrics, setMetrics] = useState<FraudAnalytics | null>(null);
  const [win] = useState(defaultWindow);
  const loader = useRunner();
  const metricsRunner = useRunner();

  const load = useCallback(() => {
    setRows(null);
    setProgress(null);
    void loader.run(async () => {
      if (source === "queue") setRows(fromQueue((await ep.getQueue({ fraud: level })).applications ?? []));
      else setRows(await scanJurisdiction(level, (done, total) => setProgress({ done, total })));
    });
    void metricsRunner.run(async () => setMetrics(await ep.getFraudAnalytics(win)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, source, win]);
  useEffect(load, [load]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const [checkRunning, setCheckRunning] = useState(0);

  return <div className="screen fraud-screen">
    <div className="page-header compact">
      <div><div className="page-title">{t("fraud.title")}</div></div>
      <div className="header-actions">
        <Action icon="refresh" disabled={loader.busy} onClick={load}>{t("common.refresh")}</Action>
        {canAct && <Action variant="primary" icon="refresh" disabled={!selectedId} title={!selectedId ? t("fraud.selectFirst") : undefined} onClick={() => setCheckRunning((n) => n + 1)}>{t("fraud.runCheck")}</Action>}
      </div>
    </div>

    <FraudMetrics data={metrics} error={metricsRunner.error} busy={metricsRunner.busy} win={win} />

    <section className="card table-card">
      <div className="table-toolbar">
        <div><div className="section-title">{level === "HIGH" ? t("fraud.heldTitle") : t("fraud.anyTitle")}</div><div className="section-description">{source === "queue" ? t("fraud.tableNote") : t("fraud.scanNote")}</div></div>
        <div className="table-tools">
          {canAct && <label className="filter-pill">{t("fraud.source")}
            <select value={source} onChange={(e) => setParam("source", e.target.value === "queue" ? "queue" : null)}>
              <option value="jurisdiction">{t("fraud.sourceJurisdiction")}</option><option value="queue">{t("fraud.sourceQueue")}</option>
            </select></label>}
          <label className="filter-pill">{t("fraud.filter")}
            <select value={level} onChange={(e) => setParam("level", e.target.value)}>
              <option value="HIGH">{t("scrutiny.fraudHigh")}</option><option value="ANY">{t("scrutiny.fraudAny")}</option>
            </select></label>
        </div>
      </div>
      <ErrorNote error={loader.error} />
      {source === "jurisdiction" && progress && progress.total >= LIST_CAP && <Note tone="warning" title={t("fraud.capTitle", { n: LIST_CAP })}>{t("fraud.capText", { held: cellText(i18n, metrics?.held_applications?.total ?? null) })}</Note>}
      {!rows && loader.busy ? <div className="muted loading-line">{progress ? t("fraud.scanning", { done: progress.done, total: progress.total }) : t("common.loading")}</div> : <table>
        <thead><tr><th>{t("scrutiny.colApp")}</th><th>{t("scrutiny.colInstitution")}</th><th>{t("fraud.colSignal")}</th><th>{t("fraud.colFlags")}</th><th>{t("fraud.colSeverity")}</th><th>{t("scrutiny.colStage")}</th><th>{t("fraud.colAction")}</th></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => {
            const flags = [...r.flags].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
            const top = flags[0];
            return <tr key={r.id} className={r.id === selectedId ? "row-active" : ""}>
              <td><strong>{r.application_no}</strong>{r.held && <div><Badge tone="danger">{t("fraud.held")}</Badge></div>}</td>
              <td>{r.institution ?? "–"}</td>
              <td>{top ? <span className="signal-cell"><Icon name={FLAG_ICONS[top.flag_type] ?? "alert"} size={16} />{flagLabel(i18n, top.flag_type)}</span> : "–"}</td>
              <td className="muted">{t("fraud.flagCount", { n: r.flags.length })}</td>
              <td>{top ? <Badge tone={SEVERITY_TONE[top.severity] ?? "neutral"}>{i18n.tk(`severity.${top.severity}`, top.severity)}</Badge> : "–"}</td>
              <td>{stageLabel(i18n, r.current_stage)}</td>
              <td><Action variant="ghost" onClick={() => setParam("app", r.id)}>{t("fraud.investigate")} <Icon name="arrow" size={14} /></Action></td>
            </tr>;
          })}
          {rows?.length === 0 && <tr><td colSpan={7} className="muted">{source === "queue" ? t("fraud.empty") : t("fraud.emptyScan")}</td></tr>}
        </tbody>
      </table>}
      <div className="table-footer"><span>{t("fraud.showing", { n: rows?.length ?? 0 })}{progress && source === "jurisdiction" ? ` · ${t("fraud.scanned", { n: progress.total })}` : ""}</span></div>
    </section>

    {selectedId && <FlagsPanel key={selectedId} id={selectedId} canAct={canAct} runSignal={checkRunning} onChanged={load} />}
  </div>;
}

function FraudMetrics({ data, error, busy, win }: { data: FraudAnalytics | null; error: unknown; busy: boolean; win: { from: string; to: string } }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (error) return <ErrorNote error={error} />;
  if (!data) return busy ? <Loading /> : null;
  // Per flag type: the cells exactly as returned. A total is shown only when every cell is a number.
  const appFlags = data.application_flags ?? [];
  const instFlags = data.institution_flags ?? [];
  const types = [...new Set(appFlags.map((r) => r.flag_type))];
  const cards = types.map((type) => {
    const cells = appFlags.filter((r) => r.flag_type === type).map((r) => r.applications ?? null);
    const numeric = cells.every((c) => typeof c === "number");
    return { type, value: numeric ? i18n.formatNumber(cells.reduce<number>((s, c) => s + (c as number), 0)) : cells.map((c) => cellText(i18n, c)).join(" + ") };
  });
  return <>
    <div className="metric-grid">
      <div className="metric-card critical"><div className="metric-icon"><Icon name="lock" /></div><div className="metric-main"><span>{t("fraud.metricHeld")}</span><strong>{cellText(i18n, data.held_applications?.total ?? null)}</strong></div></div>
      {cards.slice(0, 3).map((c) => <div key={c.type} className="metric-card"><div className="metric-icon"><Icon name={FLAG_ICONS[c.type] ?? "alert"} /></div><div className="metric-main"><span>{flagLabel(i18n, c.type).toUpperCase()}</span><strong>{c.value}</strong><small>{t("fraud.metricApps")}</small></div></div>)}
    </div>
    <details className="metrics-detail">
      <summary>{t("fraud.metricsWindow", { from: win.from, to: win.to })}</summary>
      <table><thead><tr><th>{t("fraud.colSignal")}</th><th>{t("fraud.colSeverity")}</th><th>{t("fraud.colStatus")}</th><th>{t("fraud.colFlagsN")}</th><th>{t("fraud.colAppsN")}</th></tr></thead>
        <tbody>{appFlags.map((r, k) => <tr key={k}><td>{flagLabel(i18n, r.flag_type)}</td><td>{i18n.tk(`severity.${r.severity}`, r.severity)}</td><td>{i18n.tk(`flagStatus.${r.status}`, r.status)}</td><td>{cellText(i18n, r.flags)}</td><td>{cellText(i18n, r.applications ?? null)}</td></tr>)}
          {instFlags.map((r, k) => <tr key={`i${k}`}><td>{flagLabel(i18n, r.flag_type)} ({t("fraud.institution")})</td><td>{i18n.tk(`severity.${r.severity}`, r.severity)}</td><td>{i18n.tk(`flagStatus.${r.status}`, r.status)}</td><td>{cellText(i18n, r.flags)}</td><td>–</td></tr>)}
        </tbody></table>
      {typeof data.meta.content === "string" && <div className="muted meta-line">{data.meta.content}</div>}
    </details>
  </>;
}

function FlagsPanel({ id, canAct, runSignal, onChanged }: { id: string; canAct: boolean; runSignal: number; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [data, setData] = useState<FraudFlags | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const loader = useRunner();

  useEffect(() => {
    void loader.run(async () => setData(await ep.getFraudFlags(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (runSignal === 0) return;
    void loader.run(async () => {
      setData(await ep.runFraudChecks(id));
      setRanAt(new Date().toISOString());
      onChanged();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

  return <section className="card decision-card">
    <div className="table-toolbar"><div><div className="section-title">{t("fraud.flagsFor", { no: data?.application_no ?? shortId(id) })}</div>
      <div className="section-description">{data ? `${stageLabel(i18n, data.current_stage)} · ${data.held ? t("fraud.isHeld") : t("fraud.notHeld")}` : ""}</div></div></div>
    <div className="decision-body">
      <ErrorNote error={loader.error} />
      {loader.busy && <Loading />}
      {ranAt && <Note tone="success" title={t("fraud.checkDone", { at: i18n.formatDate(ranAt, true) })} />}
      {data && (data.flags ?? []).length === 0 && <Note tone="success" title={t("fraud.noFlags")} />}
      {(data?.flags ?? []).map((f) => <FlagCard key={f.id} flag={f} holding={(data?.holding_flag_ids ?? []).includes(f.id)} canAct={canAct}
        onDisposed={(updated) => { setData((d) => d && { ...d, flags: d.flags.map((x) => (x.id === updated.id ? updated : x)) }); onChanged(); }} />)}
    </div>
  </section>;
}

/** Numeric evidence keys that are not counts (method metadata). */
const EVIDENCE_SKIP = new Set(["key_version"]);

/** Evidence as ids, counts and field names only (no values, no free text). */
function evidenceItems(i18n: I18n, f: FraudFlag): string[] {
  const out: string[] = [];
  const apps = f.related_application_ids ?? [];
  const docs = f.related_document_ids ?? [];
  if (apps.length) out.push(i18n.t("fraud.evApps", { n: apps.length, ids: apps.slice(0, 5).map(shortId).join(", ") }));
  if (docs.length) out.push(i18n.t("fraud.evDocs", { n: docs.length, ids: docs.slice(0, 5).map(shortId).join(", ") }));
  const ev = f.evidence ?? {};
  if (typeof ev.field === "string") out.push(i18n.t("fraud.evField", { field: ev.field }));
  for (const [k, v] of Object.entries(ev)) {
    if (EVIDENCE_SKIP.has(k)) continue;
    if (typeof v === "number") out.push(`${k}: ${i18n.formatNumber(v)}`);
    else if (typeof v === "boolean") out.push(`${k}: ${v ? i18n.t("common.yes") : i18n.t("common.no")}`);
  }
  if (f.institution_code) out.push(i18n.t("fraud.evInstitution", { code: f.institution_code }));
  return out;
}

function FlagCard({ flag, holding, canAct, onDisposed }: { flag: FraudFlag; holding: boolean; canAct: boolean; onDisposed: (f: FraudFlag) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [status, setStatus] = useState<Disposition>("FALSE_POSITIVE");
  const [notes, setNotes] = useState("");
  const runner = useRunner();
  const submit = () => void runner.run(async () => {
    onDisposed(await ep.disposeFlag(flag.id, { status, notes: notes.trim() }));
    setNotes("");
  });
  return <div className="flag-card">
    <div className="flag-head">
      <span className="signal-cell"><Icon name={FLAG_ICONS[flag.flag_type] ?? "alert"} size={16} /><strong>{flagLabel(i18n, flag.flag_type)}</strong></span>
      <Badge tone={SEVERITY_TONE[flag.severity]}>{t(`severity.${flag.severity}` as MessageKey)}</Badge>
      <Badge tone={flag.status === "FALSE_POSITIVE" ? "success" : flag.status === "CONFIRMED" ? "danger" : "neutral"}>{i18n.tk(`flagStatus.${flag.status}`, flag.status)}</Badge>
      {holding && <Badge tone="danger">{t("fraud.holding")}</Badge>}
      <span className="muted">{i18n.formatDate(flag.created_at, true)} · {flag.subject_type === "INSTITUTION" ? t("fraud.institution") : t("fraud.application")}</span>
    </div>
    <ul className="evidence">{evidenceItems(i18n, flag).map((e) => <li key={e}>{e}</li>)}</ul>
    {flag.reviewed_at && <div className="muted">{t("fraud.reviewedAt", { at: i18n.formatDate(flag.reviewed_at, true) })}</div>}
    {canAct && <div className="disposition">
      <label className="form-control"><span className="field-label">{t("fraud.disposition")}</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as Disposition)}>{DISPOSITIONS.map((d) => <option key={d} value={d}>{t(`flagStatus.${d}` as MessageKey)}</option>)}</select></label>
      <ReasonField label={t("fraud.notes")} value={notes} onChange={setNotes} />
      <ErrorNote error={runner.error} />
      <div className="decision-row"><Action variant="primary" disabled={!reasonOk(notes) || runner.busy} onClick={submit}>{t("fraud.record")}</Action></div>
    </div>}
  </div>;
}
