import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as ep from "../api/endpoints";
import type {
  ApplicationDetail,
  ApplicationDocuments,
  BulkResult,
  DeficiencyIssueResult,
  DocumentView,
  EligibilityMismatch,
  ExtractedField,
  QueueItem,
  QueueResponse,
  SlaView,
} from "../api/responses";
import type { BulkAction, OfficerItemDto } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import ScanViewer from "./ScanViewer";
import HistoryTimeline from "./HistoryTimeline";
import { can } from "../auth/permissions";
import { useI18n, type I18n, type MessageKey } from "../i18n";
import { Action, Badge, ErrorNote, Field, Icon, Loading, Note, ReasonField, reasonOk, shortId, useRunner, type Tone } from "../ui";

// ------------------------------------------------------------ helpers
export function stageLabel(i18n: I18n, stage: string): string {
  return i18n.tk(`stage.${stage}`, stage);
}

type Priority = "overdue" | "soon" | "ontrack" | "nosla";
const DAY = 86_400_000;

/** Priority by SLA risk: past due, due within 2 days, on track, no SLA. */
export function priorityOf(sla: SlaView | null | undefined, now = Date.now()): Priority {
  if (!sla) return "nosla";
  if (sla.state === "BREACHED") return "overdue";
  if (!sla.due_at) return "nosla";
  return new Date(sla.due_at).getTime() - now < 2 * DAY ? "soon" : "ontrack";
}
const PRIORITY_TONE: Record<Priority, Tone> = { overdue: "danger", soon: "warning", ontrack: "success", nosla: "neutral" };
const PRIORITY_RANK: Record<Priority, number> = { overdue: 0, soon: 1, ontrack: 2, nosla: 3 };

function age(i18n: I18n, fromIso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / 3_600_000);
  return i18n.t("scrutiny.age", { d: days, h: hours });
}

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Why the document was routed for review: the backend's routeByConfidence()
 * rule, recomputed here because the reasons are not returned (BACKEND_REQUESTS R4).
 */
function routingReasons(i18n: I18n, doc: DocumentView): string[] {
  const ext = doc.extraction;
  if (!ext) return [];
  const th = ext.review_threshold;
  const out: string[] = [];
  if (typeof th === "number") {
    for (const f of ext.fields ?? []) {
      if (typeof f.confidence === "number" && f.confidence < th) out.push(i18n.t("scrutiny.reasonField", { field: f.name, c: pct(f.confidence), t: pct(th) }));
    }
  }
  const cls = ext.classification;
  if (!cls) return out;
  if (cls.matches_slot === false) out.push(i18n.t("scrutiny.reasonType", { type: cls.type ?? "–" }));
  else if (cls.matches_slot === null || cls.matches_slot === undefined) out.push(i18n.t("scrutiny.reasonNoType"));
  else if (typeof th === "number" && typeof cls.confidence === "number" && cls.confidence < th) out.push(i18n.t("scrutiny.reasonClass", { c: pct(cls.confidence), t: pct(th) }));
  return out;
}

function mismatches(doc: DocumentView): EligibilityMismatch[] {
  const m = doc.extraction?.eligibility_mismatches;
  return Array.isArray(m) ? m.filter((x) => !!x && typeof x === "object" && typeof x.field === "string") : [];
}

// ------------------------------------------------------------ screen
export default function ScrutinyWorkspace() {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const canAct = can(me?.role, "scrutiny.act");
  const [params, setParams] = useSearchParams();
  const review = params.get("review") ?? "";
  const fraud = params.get("fraud") ?? "";
  const selectedId = params.get("app");
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const loader = useRunner();

  const load = useCallback(() => {
    void loader.run(async () => {
      const q = await ep.getQueue({
        needs_eligibility_review: review === "true" || review === "false" ? review : undefined,
        fraud: fraud === "HIGH" || fraud === "ANY" ? fraud : undefined,
      });
      setQueue(q);
      setChecked((c) => c.filter((id) => q.applications.some((a) => a.id === id)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, fraud]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const now = Date.now();
    return [...(queue?.applications ?? [])].sort((a, b) => PRIORITY_RANK[priorityOf(a.sla, now)] - PRIORITY_RANK[priorityOf(b.sla, now)]);
  }, [queue]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const index = rows.findIndex((r) => r.id === selectedId);

  return <div className="screen scrutiny-screen">
    <div className="page-header compact">
      <div><div className="page-title">{t("scrutiny.title")}</div><div className="page-subtitle">{queue ? t("scrutiny.subtitle", { n: queue.count, stages: queue.stages.map((s) => stageLabel(i18n, s)).join(", ") }) : ""}</div></div>
      <div className="header-actions">
        <Action icon="refresh" onClick={load}>{t("common.refresh")}</Action>
        {canAct && <Action variant={showBulk ? "primary" : "secondary"} icon="check" onClick={() => setShowBulk((s) => !s)}>{t("bulk.open", { n: checked.length })}</Action>}
      </div>
    </div>
    <ErrorNote error={loader.error} />
    {showBulk && canAct && <BulkPanel ids={checked} rows={rows} onDone={load} />}

    <section className="card table-card scrutiny-queue">
      <div className="table-toolbar">
        <div><div className="section-title">{t("scrutiny.queue")}</div><div className="section-description">{t("scrutiny.queueNote")}</div></div>
        <div className="table-tools">
          <label className="filter-pill">{t("scrutiny.filterReview")}
            <select value={review} onChange={(e) => setParam("review", e.target.value || null)}>
              <option value="">{t("scrutiny.all")}</option><option value="true">{t("scrutiny.reviewOnly")}</option><option value="false">{t("scrutiny.reviewNone")}</option>
            </select>
          </label>
          <label className="filter-pill">{t("scrutiny.filterFraud")}
            <select value={fraud} onChange={(e) => setParam("fraud", e.target.value || null)}>
              <option value="">{t("scrutiny.all")}</option><option value="ANY">{t("scrutiny.fraudAny")}</option><option value="HIGH">{t("scrutiny.fraudHigh")}</option>
            </select>
          </label>
        </div>
      </div>
      {loader.busy && !queue ? <Loading /> : <table>
        <thead><tr>{canAct && <th />}<th>{t("scrutiny.colApp")}</th><th>{t("scrutiny.colInstitution")}</th><th>{t("scrutiny.colStage")}</th><th>{t("scrutiny.colPriority")}</th><th>{t("scrutiny.colDue")}</th><th>{t("scrutiny.colFlags")}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => <QueueRow key={r.id} row={r} selectable={canAct} checked={checked.includes(r.id)} active={r.id === selectedId}
            onCheck={(on) => setChecked((c) => (on ? [...c, r.id].slice(0, 25) : c.filter((x) => x !== r.id)))} onOpen={() => setParam("app", r.id)} />)}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">{t("scrutiny.empty")}</td></tr>}
        </tbody>
      </table>}
      <div className="table-footer"><span>{t("scrutiny.showing", { n: rows.length })}</span><span>{canAct ? t("bulk.selectHint") : ""}</span></div>
    </section>

    {selectedId && <CaseView key={selectedId} id={selectedId} position={index >= 0 ? { i: index + 1, n: rows.length } : null}
      onPrev={index > 0 ? () => setParam("app", rows[index - 1].id) : undefined}
      onNext={index >= 0 && index < rows.length - 1 ? () => setParam("app", rows[index + 1].id) : undefined}
      onChanged={load} canAct={canAct} />}
  </div>;
}

function QueueRow({ row, selectable, checked, active, onCheck, onOpen }: { row: QueueItem; selectable: boolean; checked: boolean; active: boolean; onCheck: (on: boolean) => void; onOpen: () => void }) {
  const i18n = useI18n();
  const { t, formatDate } = i18n;
  const p = priorityOf(row.sla);
  return <tr className={active ? "row-active" : ""}>
    {selectable && <td><input type="checkbox" aria-label={row.application_no} checked={checked} onChange={(e) => onCheck(e.target.checked)} /></td>}
    <td><strong>{row.application_no}</strong><div className="muted">{row.academic_year}</div></td>
    <td>{row.institution_name ?? row.institution_code ?? "–"}<div className="muted">{[row.jurisdiction_district, row.jurisdiction_state].filter(Boolean).join(", ")}</div></td>
    <td>{stageLabel(i18n, row.current_stage)}</td>
    <td><Badge tone={PRIORITY_TONE[p]}>{t(`priority.${p}` as MessageKey)}</Badge></td>
    <td>{row.sla?.due_at ? formatDate(row.sla.due_at, true) : "–"}</td>
    <td>
      {row.needs_eligibility_review && <Badge tone="info">{t("scrutiny.needsReview")}</Badge>}{" "}
      {row.fraud?.held && <Badge tone="danger">{t("fraud.held")}</Badge>}{" "}
      {!row.fraud?.held && (row.fraud?.open_flags ?? 0) > 0 && <Badge tone="warning">{t("scrutiny.openFlags", { n: row.fraud?.open_flags ?? 0 })}</Badge>}
    </td>
    <td><Action variant="ghost" onClick={onOpen}>{t("scrutiny.open")} <Icon name="arrow" size={14} /></Action></td>
  </tr>;
}

// ------------------------------------------------------------ case view
function CaseView({ id, position, onPrev, onNext, onChanged, canAct }: { id: string; position: { i: number; n: number } | null; onPrev?: () => void; onNext?: () => void; onChanged: () => void; canAct: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [docs, setDocs] = useState<ApplicationDocuments | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const loader = useRunner();

  const load = useCallback(() => {
    void loader.run(async () => {
      const [a, d] = await Promise.all([ep.getApplication(id), ep.listDocuments(id)]);
      setApp(a);
      setDocs(d);
      setDocId((cur) => cur && (d.documents ?? []).some((x) => x.document_id === cur) ? cur
        : ((d.documents ?? []).find((x) => x.state === "NEEDS_REVIEW") ?? (d.documents ?? [])[0])?.document_id ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(load, [load]);

  const doc = docs?.documents?.find((d) => d.document_id === docId) ?? null;
  const refresh = () => {
    load();
    onChanged();
  };

  if (!app) return <section className="case-section">{loader.busy ? <Loading /> : <ErrorNote error={loader.error} />}</section>;
  return <section className="case-section">
    <div className="case-strip">
      <div><span>{t("scrutiny.caseId")}</span><strong>{app.application_no}</strong></div>
      <div><span>{t("scrutiny.stage")}</span><strong>{stageLabel(i18n, app.current_stage)}</strong></div>
      <div><span>{t("scrutiny.document")}</span><strong>{doc ? doc.document_type : "–"}</strong></div>
      <div><span>{t("scrutiny.queueAge")}</span><strong className="amber-text">{age(i18n, app.stage_entered_at)}</strong></div>
      <div className="case-nav"><Action variant="ghost" disabled={!onPrev} onClick={onPrev}>{t("common.previous")}</Action><span>{position ? t("scrutiny.position", { i: position.i, n: position.n }) : ""}</span><Action variant="ghost" disabled={!onNext} onClick={onNext}>{t("common.next")}</Action></div>
    </div>
    <ErrorNote error={loader.error} />
    {docs?.mock_notice && <Note tone="warning" title={t("scrutiny.mockTitle", { mode: docs.ml_mode })}>{docs.mock_notice}</Note>}
    <div className="review-grid">
      <section className="viewer-card">
        <div className="panel-toolbar"><div><strong>{t("scrutiny.documents")}</strong><Badge>{t("scrutiny.docCount", { n: docs?.documents?.length ?? 0, m: docs?.checklist?.length ?? 0 })}</Badge></div></div>
        <div className="viewer-body">
          <div className="slot-list">
            {(docs?.slots ?? []).map((s) => <div key={s.slot} className={`slot-item${s.document_id && s.document_id === docId ? " active" : ""}`} role="button" tabIndex={s.document_id ? 0 : -1}
              onClick={() => s.document_id && setDocId(s.document_id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && s.document_id && setDocId(s.document_id)}>
              <Icon name="file" size={15} /><span>{s.slot}</span><Badge tone={s.state === "MISSING" ? "neutral" : s.state === "NEEDS_REVIEW" ? "warning" : s.state === "QUALITY_REJECTED" || s.state === "FAILED" ? "danger" : "success"}>{i18n.tk(`docState.${s.state}`, s.state)}</Badge>
            </div>)}
          </div>
          {doc && canAct && <ScanViewer key={doc.document_id} doc={doc} />}
          {doc && <DocumentMeta doc={doc} />}
        </div>
      </section>
      <section className="extraction-card">
        {doc ? <Extraction key={doc.document_id} doc={doc} canAct={canAct} onChanged={refresh} /> : <div className="muted">{t("scrutiny.noDocument")}</div>}
      </section>
    </div>
    <HistoryTimeline applicationId={app.id} refreshKey={`${app.current_stage}|${app.stage_entered_at}`} />
    {canAct && <DecisionPanel app={app} docs={docs} onChanged={refresh} />}
  </section>;
}

function DocumentMeta({ doc }: { doc: DocumentView }) {
  const i18n = useI18n();
  const { t, formatDate, formatNumber } = i18n;
  return <div className="fields-grid doc-meta">
    <Field label={t("scrutiny.fileName")} value={doc.file_name} />
    <Field label={t("scrutiny.fileType")} value={`${doc.mime_type} · ${formatNumber(Math.round(doc.file_size_bytes / 1024))} KB`} />
    <Field label={t("scrutiny.uploaded")} value={formatDate(doc.uploaded_at, true)} />
    <Field label={t("scrutiny.source")} value={doc.source === "DIGILOCKER" ? t("scrutiny.sourceDigilocker") : t("scrutiny.sourceUpload")} />
    <Field label={t("scrutiny.sha")} value={<span className="mono">{doc.file_sha256.slice(0, 16)}…</span>} />
    <Field label={t("scrutiny.quality")} value={doc.quality ? (doc.quality.usable ? t("scrutiny.qualityOk") : t("scrutiny.qualityBad", { issues: doc.quality.issues.join(", ") || "–" })) : "–"} />
  </div>;
}

function Extraction({ doc, canAct, onChanged }: { doc: DocumentView; canAct: boolean; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const ext = doc.extraction;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [done, setDone] = useState(false);
  const runner = useRunner();

  if (!ext) return <div className="muted">{t("scrutiny.processing", { state: doc.state })}</div>;
  const fields = ext.fields ?? [];
  const lowest = fields.reduce<number | null>((m, f) => (typeof f.confidence !== "number" ? m : m === null ? f.confidence : Math.min(m, f.confidence)), null);
  const reasons = routingReasons(i18n, doc);
  const mm = mismatches(doc);
  const needsReview = ext.review_status === "NEEDS_REVIEW";
  const corrections: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    const v = edits[f.name];
    if (v === undefined || v === display(f.value)) continue;
    corrections[f.name] = typeof f.value === "number" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : typeof f.value === "boolean" ? v === "true" : v;
  }
  const corrected = Object.keys(corrections).length > 0;
  const canConfirm = canAct && needsReview && (!corrected || reasonOk(remarks));

  const confirm = () => void runner.run(async () => {
    await ep.confirmDocument(doc.document_id, { corrections: corrected ? corrections : undefined, remarks: remarks.trim() || undefined });
    setDone(true);
    onChanged();
  });

  return <>
    <div className="extraction-head">
      <div><div className="section-title">{t("scrutiny.extracted")}</div><div className="section-description">{doc.document_type} · {t("scrutiny.engine", { e: ext.engine ?? "–" })}</div></div>
      <div className="confidence"><div className="confidence-ring">{lowest === null ? "–" : Math.round(lowest * 100)}<span>%</span></div><div>
        <Badge tone={needsReview ? "warning" : "success"}>{i18n.tk(`docState.${ext.review_status ?? doc.state}`, ext.review_status ?? doc.state)}</Badge>
        <small>{t("scrutiny.lowest", { t: pct(ext.review_threshold) })}</small></div></div>
    </div>
    {reasons.length > 0 && <div className="routing-reason"><div className="warning-icon"><Icon name="alert" /></div><div><strong>{t("scrutiny.whyRouted")}</strong>{reasons.map((r) => <span key={r}>{r}</span>)}<span className="muted">{t("scrutiny.whyRoutedNote")}</span></div></div>}
    <div className="form-section"><div className="form-section-title">{t("scrutiny.fields")}</div>
      <div className="fields-grid">
        {fields.map((f) => <FieldEditor key={f.name} field={f} editable={canAct && needsReview} value={edits[f.name] ?? display(f.value)} onChange={(v) => setEdits((e) => ({ ...e, [f.name]: v }))} />)}
        {fields.length === 0 && <div className="muted">{t("scrutiny.noFields")}</div>}
      </div>
    </div>
    {mm.length > 0 && <div className="comparison"><div className="comparison-head"><span>{t("scrutiny.mismatchHead")}</span></div>
      <div className="compare-grid">{mm.map((m) => <div key={m.field}><small>{m.source === "declared" ? t("scrutiny.mmDeclared") : t("scrutiny.mmRecorded")}</small><strong>{m.field}</strong><span className="source-line"><span className="orange-dot" /> {t("scrutiny.mmNote")}</span></div>)}</div></div>}
    {canAct && needsReview && !done && <div className="officer-note">
      <ReasonField label={corrected ? t("scrutiny.correctReason") : t("scrutiny.confirmNote")} value={remarks} onChange={setRemarks} optional={!corrected} />
      <ErrorNote error={runner.error} />
      <div className="decision-row"><Action variant="primary" icon="check" disabled={!canConfirm || runner.busy} onClick={confirm}>{corrected ? t("scrutiny.saveCorrections", { n: Object.keys(corrections).length }) : t("scrutiny.confirmValues")}</Action></div>
    </div>}
    {done && <Note tone="success" title={t("scrutiny.confirmed")} />}
    {!needsReview && ext.confirmed_at && <Note tone="success" title={t("scrutiny.confirmedAt", { at: i18n.formatDate(ext.confirmed_at, true) })} />}
  </>;
}

function FieldEditor({ field, editable, value, onChange }: { field: ExtractedField; editable: boolean; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const low = field.review === "NEEDS_REVIEW";
  return <label className={`form-control${low ? " field-low" : ""}`}>
    <span className="field-label">{field.name.toUpperCase()} · {pct(field.confidence)}{field.corrected ? ` · ${t("scrutiny.corrected")}` : ""}{field.sensitive ? ` · ${t("scrutiny.sensitive")}` : ""}</span>
    {editable ? <input value={value} onChange={(e) => onChange(e.target.value)} /> : <div className="field"><span>{value}</span></div>}
  </label>;
}

// ------------------------------------------------------------ decisions
const PROBLEM_CODES = ["document_missing", "image_unreadable", "field_unreadable", "issue_date_unreadable", "document_expired", "wrong_document", "not_attested", "name_mismatch", "dob_mismatch"] as const;
const ITEM_CHECKS: OfficerItemDto["check_code"][] = ["OFFICER", "DOCUMENT_PRESENT", "QUALITY_GATE", "DOCUMENT_VALIDITY", "FIELD_CONFIDENCE"];
type Mode = "verify" | "reject" | "defective" | "deficiency";

function DecisionPanel({ app, docs, onChanged }: { app: ApplicationDetail; docs: ApplicationDocuments | null; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [mode, setMode] = useState<Mode>("verify");
  const [reason, setReason] = useState("");
  const [eligConfirmed, setEligConfirmed] = useState(false);
  const [code, setCode] = useState("DEF_DOCUMENTS");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<OfficerItemDto[]>([]);
  const [includeFailed, setIncludeFailed] = useState(true);
  const [preview, setPreview] = useState<DeficiencyIssueResult | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const runner = useRunner();

  const reasonRequired = mode !== "verify" || eligConfirmed;
  const reasonValid = !reasonRequired || reasonOk(reason);
  const defectiveValid = /^[A-Z][A-Z0-9_]{2,63}$/.test(code) && title.trim() !== "" && description.trim() !== "";
  const slots = docs?.checklist ?? [];

  const switchMode = (m: Mode) => {
    setMode(m);
    setPreview(null);
    setResult(null);
    runner.setError(null);
  };
  const done = (text: string) => {
    setResult(text);
    setReason("");
    setPreview(null);
    onChanged();
  };

  const submit = () => void runner.run(async () => {
    if (mode === "verify") {
      const r = await ep.verifyApplication(app.id, { remarks: reason.trim() || undefined, eligibility_review_confirmed: app.needs_eligibility_review ? eligConfirmed : undefined });
      done(t("decision.moved", { from: stageLabel(i18n, r.transition.from_stage), to: stageLabel(i18n, r.transition.to_stage) }));
    } else if (mode === "reject") {
      const r = await ep.rejectApplication(app.id, { remarks: reason.trim() });
      done(t("decision.moved", { from: stageLabel(i18n, r.transition.from_stage), to: stageLabel(i18n, r.transition.to_stage) }));
    } else if (mode === "defective") {
      const r = await ep.markDefective(app.id, { code, title: title.trim(), description: description.trim(), remarks: reason.trim() });
      done(t("decision.moved", { from: stageLabel(i18n, r.transition.from_stage), to: stageLabel(i18n, r.transition.to_stage) }));
    }
  });
  const deficiency = (dryRun: boolean) => void runner.run(async () => {
    const r = await ep.issueDeficiency(app.id, { reason: reason.trim(), items: items.length ? items : undefined, include_failed_checks: includeFailed, dry_run: dryRun });
    if (dryRun) setPreview(r);
    else done(t("decision.deficiencyIssued", { n: r.items.length, days: r.deadline_days }));
  });

  return <section className="card decision-card">
    <div className="table-toolbar"><div><div className="section-title">{t("decision.title")}</div><div className="section-description">{t("decision.note")}</div></div>
      <div className="table-tools">{(["verify", "reject", "defective", "deficiency"] as Mode[]).map((m) => <Action key={m} variant={mode === m ? "primary" : "secondary"} onClick={() => switchMode(m)}>{t(`decision.${m}` as MessageKey)}</Action>)}</div>
    </div>
    <div className="decision-body">
      {mode === "verify" && app.needs_eligibility_review && <label className="check-line"><input type="checkbox" checked={eligConfirmed} onChange={(e) => setEligConfirmed(e.target.checked)} /> {t("decision.eligConfirm")}</label>}
      {mode === "verify" && app.needs_eligibility_review && !eligConfirmed && <Note tone="info">{t("decision.eligNeeded")}</Note>}
      {mode === "defective" && <div className="fields-grid">
        <label className="form-control"><span className="field-label">{t("decision.code")}</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /><small className="hint">{t("decision.codeHint")}</small></label>
        <label className="form-control"><span className="field-label">{t("decision.defTitle")}</span><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="form-control wide"><span className="field-label">{t("decision.description")}</span><textarea value={description} maxLength={2000} rows={2} onChange={(e) => setDescription(e.target.value)} /><small className="hint">{t("decision.descriptionHint")}</small></label>
      </div>}
      {mode === "deficiency" && <div className="deficiency-items">
        <label className="check-line"><input type="checkbox" checked={includeFailed} onChange={(e) => setIncludeFailed(e.target.checked)} /> {t("decision.includeFailed")}</label>
        {items.map((it, n) => <div key={n} className="item-row">
          <select aria-label={t("decision.slot")} value={it.document_slot} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, document_slot: e.target.value } : x)))}>{slots.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select aria-label={t("decision.check")} value={it.check_code} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, check_code: e.target.value as OfficerItemDto["check_code"] } : x)))}>{ITEM_CHECKS.map((c) => <option key={c} value={c}>{i18n.tk(`check.${c}`, c)}</option>)}</select>
          {it.check_code === "OFFICER" && <select aria-label={t("decision.problem")} value={it.problem_code ?? ""} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, problem_code: e.target.value } : x)))}>{PROBLEM_CODES.map((p) => <option key={p} value={`deficiency.problem.${p}`}>{t(`problem.${p}` as MessageKey)}</option>)}</select>}
          {it.check_code === "FIELD_CONFIDENCE" && <input aria-label={t("decision.field")} placeholder={t("decision.field")} value={it.field ?? ""} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, field: e.target.value } : x)))} />}
          <Action variant="ghost" onClick={() => setItems((xs) => xs.filter((_, k) => k !== n))}>{t("decision.removeItem")}</Action>
        </div>)}
        {slots.length > 0 && <Action variant="ghost" icon="plus" onClick={() => setItems((xs) => [...xs, { document_slot: slots[0], check_code: "OFFICER", problem_code: "deficiency.problem.not_attested" }])}>{t("decision.addItem")}</Action>}
      </div>}
      <ReasonField label={mode === "verify" ? t("decision.remarks") : t("decision.reason")} value={reason} onChange={setReason} optional={!reasonRequired} />
      <ErrorNote error={runner.error} />
      {preview && <div className="preview">
        <div className="form-section-title">{t("decision.preview", { n: preview.items.length, days: preview.deadline_days })}</div>
        <table><thead><tr><th>{t("decision.slot")}</th><th>{t("decision.check")}</th><th>{t("decision.problem")}</th><th>{t("decision.deadline")}</th></tr></thead>
          <tbody>{preview.items.map((it, k) => <tr key={k}><td>{it.document_slot}</td><td>{i18n.tk(`check.${it.check_code}`, it.check_code)}{it.field ? ` · ${it.field}` : ""}</td><td>{i18n.tk(`problem.${it.problem_code.replace("deficiency.problem.", "")}`, it.problem_code)}</td><td>{i18n.formatDate(it.deadline_at)}</td></tr>)}</tbody></table>
      </div>}
      {result && <Note tone="success" title={result} />}
      <div className="decision-row">
        {mode === "deficiency" ? <>
          <Action icon="eye" disabled={!reasonValid || runner.busy} onClick={() => deficiency(true)}>{t("decision.dryRun")}</Action>
          <Action variant="primary" disabled={!reasonValid || !preview || runner.busy} onClick={() => deficiency(false)} title={!preview ? t("decision.dryRunFirst") : undefined}>{t("decision.issue")}</Action>
        </> : <Action variant={mode === "reject" ? "danger" : "primary"} disabled={!reasonValid || (mode === "defective" && !defectiveValid) || (mode === "verify" && app.needs_eligibility_review && !eligConfirmed) || runner.busy} onClick={submit}>{t(`decision.submit.${mode}` as MessageKey)}</Action>}
      </div>
    </div>
  </section>;
}

// ------------------------------------------------------------ bulk
const BULK_ACTIONS: BulkAction[] = ["VERIFY", "MARK_DEFECTIVE", "RESOLVE_DEFICIENCY"];

function BulkPanel({ ids, rows, onDone }: { ids: string[]; rows: QueueItem[]; onDone: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [action, setAction] = useState<BulkAction>("VERIFY");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("DEF_DOCUMENTS");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [dryIds, setDryIds] = useState<string>("");
  const runner = useRunner();

  const needsReason = action === "MARK_DEFECTIVE";
  const valid = ids.length > 0 && (!needsReason || (reasonOk(reason) && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) && title.trim() !== "" && description.trim() !== ""));
  const key = `${action}|${ids.join(",")}|${reason}|${code}|${title}|${description}`;
  const dryRunMatches = result?.dry_run === true && dryIds === key;

  const go = (dryRun: boolean) => void runner.run(async () => {
    const r = await ep.bulkAction({
      action,
      application_ids: ids,
      reason: reason.trim() || undefined,
      deficiency: action === "MARK_DEFECTIVE" ? { code, title: title.trim(), description: description.trim() } : undefined,
      dry_run: dryRun,
    });
    setResult(r);
    setDryIds(dryRun ? key : "");
    if (!dryRun) onDone();
  });
  const no = (id: string) => rows.find((r) => r.id === id)?.application_no ?? shortId(id);

  return <section className="card decision-card">
    <div className="table-toolbar"><div><div className="section-title">{t("bulk.title")}</div><div className="section-description">{t("bulk.note", { n: ids.length })}</div></div>
      <div className="table-tools">{BULK_ACTIONS.map((a) => <Action key={a} variant={action === a ? "primary" : "secondary"} onClick={() => { setAction(a); setResult(null); }}>{t(`bulk.action.${a}` as MessageKey)}</Action>)}</div>
    </div>
    <div className="decision-body">
      {ids.length === 0 && <Note tone="info">{t("bulk.none")}</Note>}
      {ids.length > 0 && <div className="muted">{ids.map(no).join(", ")}</div>}
      {action === "MARK_DEFECTIVE" && <div className="fields-grid">
        <label className="form-control"><span className="field-label">{t("decision.code")}</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <label className="form-control"><span className="field-label">{t("decision.defTitle")}</span><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="form-control wide"><span className="field-label">{t("decision.description")}</span><textarea value={description} maxLength={2000} rows={2} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>}
      <ReasonField label={needsReason ? t("decision.reason") : t("decision.remarks")} value={reason} onChange={setReason} optional={!needsReason} />
      <Note tone="info">{t("bulk.rules")}</Note>
      <ErrorNote error={runner.error} />
      {result && <div className="preview">
        <div className="form-section-title">{result.dry_run ? t("bulk.dryResult") : t("bulk.realResult")}: {t("bulk.summary", { requested: result.requested, changed: result.changed, would: result.would_change, none: result.no_change, skipped: result.skipped })}</div>
        <table><thead><tr><th>{t("scrutiny.colApp")}</th><th>{t("bulk.outcome")}</th><th>{t("bulk.skipReason")}</th><th>{t("bulk.stages")}</th></tr></thead>
          <tbody>{result.items.map((it) => <tr key={it.application_id}><td><strong>{it.application_no ?? shortId(it.application_id)}</strong></td>
            <td><Badge tone={it.outcome === "SKIPPED" ? "warning" : it.outcome === "NO_CHANGE" ? "neutral" : "success"}>{t(`bulk.outcome.${it.outcome}` as MessageKey)}</Badge></td>
            <td>{it.skip_reason ? i18n.tk(`skip.${it.skip_reason}`, it.skip_reason) : "–"}{it.fraud_flag_ids?.length ? ` (${it.fraud_flag_ids.map(shortId).join(", ")})` : ""}</td>
            <td>{it.from_stage ? stageLabel(i18n, it.from_stage) : "–"}{it.to_stage ? ` → ${stageLabel(i18n, it.to_stage)}` : ""}</td></tr>)}</tbody></table>
      </div>}
      <div className="decision-row">
        <Action icon="eye" disabled={!valid || runner.busy} onClick={() => go(true)}>{t("decision.dryRun")}</Action>
        <Action variant="primary" disabled={!valid || !dryRunMatches || runner.busy} onClick={() => go(false)} title={!dryRunMatches ? t("decision.dryRunFirst") : undefined}>{t("bulk.run")}</Action>
      </div>
    </div>
  </section>;
}
