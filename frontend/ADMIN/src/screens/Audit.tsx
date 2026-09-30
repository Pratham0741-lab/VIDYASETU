import { useCallback, useEffect, useState } from "react";
import * as ep from "../api/endpoints";
import type { AuditVerifyReport, AuthorizationDenial, ChainBreak, ChainReport, DocumentAccess, LegacyReport } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { can } from "../auth/permissions";
import { useI18n, type I18n } from "../i18n";
import { Action, Badge, ErrorNote, Icon, Loading, Note, shortId, useRunner } from "../ui";

function hash(h: string | null | undefined): string {
  return h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "–";
}

function breakText(i18n: I18n, b: ChainBreak): string {
  return i18n.t("audit.break", { kind: i18n.tk(`breakKind.${b.kind}`, b.kind), seq: b.seq ?? "–", id: shortId(b.record_id) || "–" });
}

export default function AuditInspector() {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const canVerify = can(me?.role, "audit.verify");
  const canLogs = can(me?.role, "audit.logs");
  const [report, setReport] = useState<AuditVerifyReport | null>(null);
  const [tab, setTab] = useState<"denials" | "access">("denials");
  const runner = useRunner();

  const verify = () => void runner.run(async () => setReport(await ep.verifyAuditChain()));

  return <div className="screen audit-screen">
    <div className="page-header compact"><div><div className="page-title">{t("audit.title")}</div></div>
      <div className="header-actions audit-header-actions">
        {canVerify && <Action variant="primary" icon="refresh" disabled={runner.busy} onClick={verify}>{runner.busy ? t("audit.verifying") : t("audit.verify")}</Action>}
      </div>
    </div>
    <ErrorNote error={runner.error} />
    {canVerify && !report && !runner.busy && <Note tone="info" title={t("audit.notRun")}>{t("audit.notRunText")}</Note>}
    {!canVerify && <Note tone="info">{t("audit.verifyRoles")}</Note>}
    {report && <VerifyResult report={report} />}

    {canLogs && <section className="card table-card audit-table-card">
      <div className="table-toolbar">
        <div><div className="section-title">{tab === "denials" ? t("audit.denials") : t("audit.access")}</div><div className="section-description">{tab === "denials" ? t("audit.denialsNote") : t("audit.accessNote")}</div></div>
        <div className="table-tools">
          <button type="button" className={`filter-pill${tab === "denials" ? " lang-active" : ""}`} onClick={() => setTab("denials")}>{t("audit.denials")}</button>
          <button type="button" className={`filter-pill${tab === "access" ? " lang-active" : ""}`} onClick={() => setTab("access")}>{t("audit.access")}</button>
        </div>
      </div>
      {tab === "denials" ? <DenialsTable /> : <AccessTable />}
      <div className="audit-foot"><div><Icon name="lock" size={14} />{t("audit.foot")}</div></div>
    </section>}
  </div>;
}

function VerifyResult({ report }: { report: AuditVerifyReport }) {
  const i18n = useI18n();
  const { t, formatNumber } = i18n;
  const ok = report.ok && !!report.denials?.ok;
  return <>
    <div className={`integrity-banner${ok ? "" : " integrity-broken"}`}>
      <div className="integrity-shield"><Icon name={ok ? "shield" : "alert"} size={27} className={ok ? "stroke-green-700" : ""} /></div>
      <div><div className="integrity-title"><strong>{ok ? t("audit.ok") : t("audit.notOk")}</strong></div>
        <span>{t("audit.summary", { chain: formatNumber(report.chain?.rows ?? 0), legacy: formatNumber(report.legacy?.rows ?? 0), denials: formatNumber(report.denials?.chain?.rows ?? 0) })}</span></div>
      <div className="integrity-meta"><div><span>{t("audit.checkedAt")}</span><strong>{i18n.formatDate(report.checked_at, true)}</strong></div><div><span>{t("audit.head")}</span><strong className="mono">{report.chain.head_seq ?? "–"} · {hash(report.chain.head_hash)}</strong></div></div>
    </div>
    <div className="audit-metrics">
      <div className="audit-stat audit-stat-chain"><Icon name="fingerprint" className="audit-metric-icon audit-chain-icon" /><div><span>{t("audit.chainRows")}</span><strong>{formatNumber(report.chain.rows)}</strong></div></div>
      <div className="audit-stat audit-stat-oldest"><Icon name="clock" className="audit-metric-icon audit-oldest-icon" /><div><span>{t("audit.legacyRows")}</span><strong>{formatNumber(report.legacy.rows)} · {report.legacy.matches_checkpoint ? t("audit.anchored") : t("audit.notAnchored")}</strong></div></div>
      <div className="audit-stat audit-stat-standard"><Icon name="lock" className="audit-metric-icon audit-standard-icon" /><div><span>{t("audit.denialRows")}</span><strong>{formatNumber(report.denials.chain.rows)} · {report.denials.ok ? t("audit.intact") : t("audit.broken")}</strong></div></div>
      <div className="audit-stat audit-stat-rate"><Icon name="check" className="audit-metric-icon" /><div><span>{t("audit.denialLegacy")}</span><strong>{formatNumber(report.denials.legacy.rows)} · {report.denials.legacy.matches_checkpoint ? t("audit.anchored") : t("audit.notAnchored")}</strong></div></div>
    </div>
    {report.first_break && <Note tone="danger" title={t("audit.mainBreak")}>{breakText(i18n, report.first_break)}</Note>}
    {report.denials.first_break && <Note tone="danger" title={t("audit.denialsBreak")}>{breakText(i18n, report.denials.first_break)}</Note>}
    <details className="metrics-detail audit-detail">
      <summary>{t("audit.details")}</summary>
      <ChainDetail title={t("audit.mainChain")} chain={report.chain} legacy={report.legacy} />
      <ChainDetail title={t("audit.denialsChain")} chain={report.denials.chain} legacy={report.denials.legacy} />
      <div className="muted meta-line">{t("audit.englishNote")}</div>
    </details>
  </>;
}

function ChainDetail({ title, chain, legacy }: { title: string; chain: ChainReport; legacy: LegacyReport }) {
  const { t } = useI18n();
  return <div className="chain-detail">
    <strong>{title}</strong>
    <div>{t("audit.seqRange", { first: chain.first_seq ?? "–", last: chain.last_seq ?? "–", head: chain.head_seq ?? "–" })} · <span className="mono">{hash(chain.last_hash)}</span></div>
    <div>{t("audit.vouches")}: {chain.vouches_for}</div>
    <div>{t("audit.cannotVouch")}: {chain.cannot_vouch_for}</div>
    <div>{t("audit.legacyLine", { rows: legacy.rows, cp: legacy.checkpoint_rows ?? "–" })} · <span className="mono">{hash(legacy.digest)}</span> {legacy.matches_checkpoint ? <Badge tone="success">{t("audit.anchored")}</Badge> : <Badge tone="danger">{t("audit.notAnchored")}</Badge>}</div>
    <div>{t("audit.vouches")}: {legacy.vouches_for}</div>
    <div>{t("audit.cannotVouch")}: {legacy.cannot_vouch_for}</div>
  </div>;
}

function jurisdiction(state: string | null, district: string | null): string {
  return [state, district].filter(Boolean).join(" · ") || "–";
}

function DenialsTable() {
  const i18n = useI18n();
  const { t } = i18n;
  const [rows, setRows] = useState<AuthorizationDenial[] | null>(null);
  const [more, setMore] = useState(true);
  const runner = useRunner();
  const load = useCallback((before?: string) => void runner.run(async () => {
    const r = await ep.listDenials({ limit: 50, before });
    setRows((cur) => (before ? [...(cur ?? []), ...r.denials] : r.denials));
    setMore(r.denials.length === 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => load(), [load]);
  return <>
    <ErrorNote error={runner.error} />
    {!rows && runner.busy ? <Loading /> : <table>
      <thead><tr><th>{t("audit.colTime")}</th><th>{t("audit.colAction")}</th><th>{t("audit.colActor")}</th><th>{t("audit.colSubject")}</th><th>{t("audit.colReason")}</th><th>{t("audit.colJurisdiction")}</th><th>{t("audit.colFingerprint")}</th></tr></thead>
      <tbody>{(rows ?? []).map((d, k) => <tr key={d.id}>
        <td className="num">{i18n.formatDate(d.occurred_at, true)}</td>
        <td><span className="event-type">{d.action_attempted}</span></td>
        <td><div className="actor-cell"><span className="actor-dot">{(d.actor_role ?? "–").slice(0, 2)}</span>{d.actor_role ? i18n.tk(`role.${d.actor_role}`, d.actor_role) : "–"}</div></td>
        <td>{d.subject_type ?? "–"}{d.subject_id ? ` · ${shortId(d.subject_id)}` : ""}</td>
        <td>{i18n.tk(`denial.${d.denial_reason}`, d.denial_reason)}</td>
        <td>{jurisdiction(d.jurisdiction_state, d.jurisdiction_district)}</td>
        <td><div className="hash-cell"><Icon name="fingerprint" size={15} /><span>{d.seq ?? t("audit.legacy")} · {hash(d.record_hash)}</span>{rows && k < rows.length - 1 && <span className="chain-link">↓</span>}</div></td>
      </tr>)}
      {rows?.length === 0 && <tr><td colSpan={7} className="muted">{t("audit.noDenials")}</td></tr>}</tbody>
    </table>}
    {rows && rows.length > 0 && more && <div className="table-footer"><span /><Action variant="ghost" disabled={runner.busy} onClick={() => load(rows[rows.length - 1].occurred_at)}>{t("audit.older")}</Action></div>}
  </>;
}

function AccessTable() {
  const i18n = useI18n();
  const { t } = i18n;
  const [rows, setRows] = useState<DocumentAccess[] | null>(null);
  const runner = useRunner();
  useEffect(() => {
    void runner.run(async () => setRows((await ep.listDocumentAccess({ limit: 200 })).accesses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>
    <ErrorNote error={runner.error} />
    {!rows && runner.busy ? <Loading /> : <table>
      <thead><tr><th>{t("audit.colTime")}</th><th>{t("audit.colKind")}</th><th>{t("audit.colResource")}</th><th>{t("scrutiny.colApp")}</th><th>{t("audit.colDocument")}</th><th>{t("audit.colActor")}</th><th>{t("audit.colJurisdiction")}</th></tr></thead>
      <tbody>{(rows ?? []).map((a) => <tr key={a.id}>
        <td className="num">{i18n.formatDate(a.accessed_at, true)}</td>
        <td><span className="event-type">{i18n.tk(`accessKind.${a.access_kind}`, a.access_kind)}</span></td>
        <td>{a.resource_type}</td>
        <td className="mono">{shortId(a.application_id) || "–"}</td>
        <td className="mono">{shortId(a.document_id) || "–"}</td>
        <td>{i18n.tk(`role.${a.actor_role}`, a.actor_role)}</td>
        <td>{jurisdiction(a.jurisdiction_state, a.jurisdiction_district)}</td>
      </tr>)}
      {rows?.length === 0 && <tr><td colSpan={7} className="muted">{t("audit.noAccess")}</td></tr>}</tbody>
    </table>}
    {rows && <div className="table-footer"><span>{t("audit.accessShowing", { n: rows.length })}</span></div>}
  </>;
}

