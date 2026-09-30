import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import * as ep from "../api/endpoints";
import { ApiError } from "../api/client";
import type { ListStatus, Objection, SelectionEntry, SelectionList, SelectionListDetail } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { can } from "../auth/permissions";
import { useI18n, type I18n, type MessageKey } from "../i18n";
import { Action, Badge, ErrorNote, Icon, Loading, Note, ReasonField, reasonOk, shortId, useRunner, type Tone } from "../ui";

const STATUS_TONE: Record<ListStatus, Tone> = { DRAFT: "neutral", PROVISIONAL_PUBLISHED: "info", OBJECTION_WINDOW_CLOSED: "warning", FINAL_PUBLISHED: "success" };
const OUTCOME_TONE: Record<string, Tone> = { SELECTED: "success", NOT_SELECTED: "neutral", HELD: "danger" };

function listStatus(i18n: I18n, s: string): string {
  return i18n.tk(`listStatus.${s}`, s);
}
function outcome(i18n: I18n, s: string | null): string {
  return s ? i18n.tk(`outcome.${s}`, s) : "–";
}

/** Committee approvals given after the latest override (the backend's publish guard counts the same). */
function validApprovals(list: SelectionListDetail): number {
  const overrides = (list.entries ?? []).flatMap((e) => e.decisions ?? []).filter((d) => d.kind?.startsWith("OVERRIDE")).map((d) => d.created_at).sort();
  const last = overrides[overrides.length - 1] ?? "";
  return (list.list_decisions ?? []).filter((d) => d.kind === "APPROVE_LIST" && d.created_at > last).length;
}

export default function SelectionDashboard() {
  const i18n = useI18n();
  const { t } = i18n;
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("list");
  const [lists, setLists] = useState<SelectionList[] | null>(null);
  const loader = useRunner();

  const load = useCallback(() => {
    void loader.run(async () => {
      const r = await ep.listSelectionLists();
      setLists(r.lists);
      if (!selectedId && r.lists[0]) setParams({ list: r.lists[0].id }, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);

  return <div className="screen selection-screen">
    <div className="page-header compact">
      <div><div className="page-title">{t("selection.title")}</div><div className="page-subtitle">{t("selection.subtitle")}</div></div>
      <div className="header-actions"><Action icon="refresh" onClick={load}>{t("common.refresh")}</Action></div>
    </div>
    <ErrorNote error={loader.error} />
    <section className="card table-card">
      <div className="table-toolbar"><div><div className="section-title">{t("selection.lists")}</div><div className="section-description">{t("selection.listsNote")}</div></div></div>
      {!lists && loader.busy ? <Loading /> : <table>
        <thead><tr><th>{t("selection.colScheme")}</th><th>{t("selection.colYear")}</th><th>{t("selection.colStatus")}</th><th>{t("selection.colApprovals")}</th><th>{t("selection.colWindow")}</th><th>{t("selection.colCreated")}</th><th /></tr></thead>
        <tbody>
          {(lists ?? []).map((l) => <tr key={l.id} className={l.id === selectedId ? "row-active" : ""}>
            <td><strong>{l.scheme_code}</strong></td><td>{l.academic_year}</td>
            <td><Badge tone={STATUS_TONE[l.status]}>{listStatus(i18n, l.status)}</Badge></td>
            <td>{l.approvals_required}</td>
            <td>{l.window_closes_at ? i18n.formatDate(l.window_closes_at, true) : "–"}</td>
            <td>{i18n.formatDate(l.created_at)}</td>
            <td><Action variant="ghost" onClick={() => setParams({ list: l.id })}>{t("scrutiny.open")} <Icon name="arrow" size={14} /></Action></td>
          </tr>)}
          {lists?.length === 0 && <tr><td colSpan={7} className="muted">{t("selection.noLists")}</td></tr>}
        </tbody>
      </table>}
    </section>
    {selectedId && <ListView key={selectedId} id={selectedId} onChanged={load} />}
  </div>;
}

function ListView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const committee = can(me?.role, "selection.committee");
  const ministry = can(me?.role, "selection.ministry");
  const [list, setList] = useState<SelectionListDetail | null>(null);
  const [overrideEntry, setOverrideEntry] = useState<SelectionEntry | null>(null);
  const loader = useRunner();

  const load = useCallback(() => {
    void loader.run(async () => setList(await ep.getSelectionList(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(load, [load]);
  const changed = () => {
    load();
    onChanged();
  };

  const counts = useMemo(() => {
    const e = list?.entries ?? [];
    // (entries may be absent for an empty scope)
    return {
      selected: e.filter((x) => x.computed_outcome === "SELECTED").length,
      notSelected: e.filter((x) => x.computed_outcome === "NOT_SELECTED").length,
      held: e.filter((x) => x.computed_outcome === "HELD").length,
      overrides: e.filter((x) => x.committee_decision !== null).length,
    };
  }, [list]);

  if (!list) return loader.busy ? <Loading /> : <ErrorNote error={loader.error} />;
  const approvals = validApprovals(list);
  return <>
    <div className="page-header compact list-header">
      <div><div className="page-title">{list.scheme_code} · {list.academic_year}</div><div className="page-subtitle"><Badge tone={STATUS_TONE[list.status]}>{listStatus(i18n, list.status)}</Badge> {t("selection.run", { id: shortId(list.selection_run_id) })}</div></div>
    </div>
    <div className="allocation-summary">
      <div><span>{t("selection.inScope")}</span><strong>{list.entries_in_scope}</strong></div>
      <div><span>{t("selection.computedSelected")}</span><strong>{counts.selected}</strong></div>
      <div><span>{t("selection.computedNot")}</span><strong>{counts.notSelected}</strong></div>
      <div><span>{t("selection.held")}</span><strong>{counts.held}</strong></div>
      <div><span>{t("selection.overrides")}</span><strong className="amber-text">{counts.overrides}</strong></div>
    </div>
    <div className="muted meta-line">{t("selection.countsNote")}</div>
    <div className="ranking-layout">
      <section className="card ranking-card">
        <div className="table-toolbar"><div><div className="section-title">{t("selection.entries")}</div><div className="section-description">{t("selection.entriesNote")}</div></div></div>
        <table className="ranking-table">
          <thead><tr><th>{t("selection.colRank")}</th><th>{t("scrutiny.colApp")}</th><th>{t("selection.colCategory")}</th><th>{t("selection.colComputed")}</th><th>{t("selection.colCommittee")}</th><th>{t("selection.colFinal")}</th>{committee && list.status === "DRAFT" && <th />}</tr></thead>
          <tbody>{(list.entries ?? []).map((e) => <tr key={e.id}>
            <td><span className="rank-number">{e.computed_rank ?? "–"}</span></td>
            <td><strong>{e.application_no ?? shortId(e.application_id)}</strong>{e.not_selected_reason && <small>{i18n.tk(`notSelected.${e.not_selected_reason}`, e.not_selected_reason)}</small>}</td>
            <td><span className="category-text">{[e.vertical_category, e.horizontal_reservation].filter(Boolean).join(" · ") || "–"}</span></td>
            <td><Badge tone={OUTCOME_TONE[e.computed_outcome] ?? "neutral"}>{outcome(i18n, e.computed_outcome)}</Badge></td>
            <td>{e.committee_decision ? <Badge tone="warning">{t(`decisionKind.${e.committee_decision}` as MessageKey)}</Badge> : "–"}</td>
            <td>{e.final_outcome ? <Badge tone={OUTCOME_TONE[e.final_outcome] ?? "neutral"}>{outcome(i18n, e.final_outcome)}</Badge> : "–"}</td>
            {committee && list.status === "DRAFT" && <td><Action variant="ghost" onClick={() => setOverrideEntry(e)}>{t("selection.override")}</Action></td>}
          </tr>)}
          {(list.entries ?? []).length === 0 && <tr><td colSpan={7} className="muted">{t("selection.noEntries")}</td></tr>}
          </tbody>
        </table>
      </section>
      <aside className="quota-widget">
        <div className="widget-head"><div><div className="section-title">{t("selection.workflow")}</div></div></div>
        <div className="vertical-quota"><div><span>{t("selection.approvals")}</span><strong>{t("selection.approvalsOf", { n: approvals, m: list.approvals_required })}</strong></div><div className="big-total">{approvals}</div></div>
        <div className="quota-breakdown">
          {(["provisional_published_at", "window_closes_at", "window_closed_at", "final_published_at"] as const).map((k) => <div key={k} className="quota-row"><div className="quota-name"><div><strong>{t(`selection.${k}` as MessageKey)}</strong><small>{list[k] ? i18n.formatDate(list[k], true) : "–"}</small></div></div></div>)}
        </div>
        <ListActions list={list} approvals={approvals} committee={committee} ministry={ministry} onChanged={changed} />
        {(list.list_decisions ?? []).length > 0 && <div className="decisions-log"><div className="intersection-label">{t("selection.decisions")}</div>
          {(list.list_decisions ?? []).map((d, k) => <div key={k} className="muted">{i18n.formatDate(d.created_at, true)} · {i18n.tk(`decisionKind.${d.kind}`, d.kind)}</div>)}</div>}
      </aside>
    </div>
    {committee && list.status === "DRAFT" && <OverridePanel list={list} entry={overrideEntry} onPick={setOverrideEntry} onChanged={changed} />}
    {list.status !== "DRAFT" && <ObjectionsPanel list={list} committee={committee} onChanged={changed} />}
  </>;
}

function ListActions({ list, approvals, committee, ministry, onChanged }: { list: SelectionListDetail; approvals: number; committee: boolean; ministry: boolean; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const runner = useRunner();
  const act = (label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    void runner.run(async () => {
      await fn();
      setDone(label);
      setReason("");
      onChanged();
    });
  };
  const s = list.status;
  const windowOpen = !!list.window_closes_at && new Date(list.window_closes_at).getTime() > Date.now();
  const buttons: ReactNode[] = [];
  if (committee && s === "DRAFT") buttons.push(<Action key="approve" variant="primary" disabled={runner.busy} onClick={() => act(t("selection.approved"), () => ep.approveList(list.id, { reason: reason.trim() || undefined }))}>{t("selection.approve")}</Action>);
  if (ministry && s === "DRAFT") buttons.push(<Action key="pub" variant="primary" disabled={runner.busy || approvals < list.approvals_required} title={approvals < list.approvals_required ? t("selection.needApprovals") : undefined} onClick={() => act(t("selection.published"), () => ep.publishProvisional(list.id), t("selection.confirmPublish"))}>{t("selection.publishProvisional")}</Action>);
  if (committee && s === "PROVISIONAL_PUBLISHED") buttons.push(<Action key="early" disabled={runner.busy || !reasonOk(reason)} onClick={() => act(t("selection.closed"), () => ep.closeWindowEarly(list.id, { reason: reason.trim() }), t("selection.confirmClose"))}>{t("selection.closeEarly")}</Action>);
  if (ministry && s === "PROVISIONAL_PUBLISHED") buttons.push(<Action key="close" variant="primary" disabled={runner.busy || windowOpen} title={windowOpen ? t("selection.windowStillOpen") : undefined} onClick={() => act(t("selection.closed"), () => ep.closeWindow(list.id), t("selection.confirmClose"))}>{t("selection.closeWindow")}</Action>);
  if (ministry && s === "OBJECTION_WINDOW_CLOSED") buttons.push(<Action key="final" variant="primary" disabled={runner.busy} onClick={() => act(t("selection.publishedFinal"), () => ep.publishFinal(list.id), t("selection.confirmFinal"))}>{t("selection.publishFinal")}</Action>);

  if (buttons.length === 0) return <div className="formula-note"><Icon name="lock" size={16} /><span>{s === "FINAL_PUBLISHED" ? t("selection.frozen") : t("selection.noActions")}</span></div>;
  const reasonField = committee && (s === "DRAFT" || s === "PROVISIONAL_PUBLISHED");
  return <div className="list-actions">
    {reasonField && <ReasonField label={s === "DRAFT" ? t("selection.approveReason") : t("selection.closeReason")} value={reason} onChange={setReason} optional={s === "DRAFT"} />}
    <ErrorNote error={runner.error} />
    {done && <Note tone="success" title={done} />}
    <div className="decision-row">{buttons}</div>
  </div>;
}

function OverridePanel({ list, entry, onPick, onChanged }: { list: SelectionListDetail; entry: SelectionEntry | null; onPick: (e: SelectionEntry | null) => void; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [decision, setDecision] = useState<"INCLUDE" | "EXCLUDE">("INCLUDE");
  const [reason, setReason] = useState("");
  const runner = useRunner();
  const submit = () => entry && void runner.run(async () => {
    await ep.overrideEntry(list.id, entry.id, { decision, reason: reason.trim() });
    setReason("");
    onPick(null);
    onChanged();
  });
  return <div className="committee-module">
    <div className="committee-icon"><Icon name="edit" /></div>
    <div className="committee-copy"><strong>{t("selection.overrideTitle")}</strong><span>{t("selection.overrideNote")}</span></div>
    <div className="override-form">
      <label className="form-control"><span className="field-label">{t("scrutiny.colApp")}</span>
        <select value={entry?.id ?? ""} onChange={(e) => onPick((list.entries ?? []).find((x) => x.id === e.target.value) ?? null)}>
          <option value="">–</option>
          {(list.entries ?? []).map((e) => <option key={e.id} value={e.id}>{`${e.computed_rank ?? "–"} · ${e.application_no ?? shortId(e.application_id)} · ${outcome(i18n, e.computed_outcome)}`}</option>)}
        </select></label>
      <label className="form-control"><span className="field-label">{t("selection.decision")}</span>
        <select value={decision} onChange={(e) => setDecision(e.target.value as "INCLUDE" | "EXCLUDE")}><option value="INCLUDE">{t("decisionKind.INCLUDE")}</option><option value="EXCLUDE">{t("decisionKind.EXCLUDE")}</option></select></label>
      <ReasonField label={t("selection.overrideReason")} value={reason} onChange={setReason} />
      <ErrorNote error={runner.error} />
    </div>
    <Action disabled={!entry || !reasonOk(reason) || runner.busy} onClick={submit}>{t("selection.addOverride")}</Action>
  </div>;
}

const OBJECTION_TONE: Record<string, Tone> = { OPEN: "warning", IN_PROGRESS: "info", RESOLVED: "success", REJECTED: "neutral" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Objections to this list's run: GET /selection-lists/:id/objections (every
 * list reader; ids, status and dates only). The committee selects an open
 * objection and decides it (UPHELD / DISMISSED, reason required) while the
 * provisional list is published. If the route answers 404 (an older
 * server), the committee can still enter a grievance id.
 */
function ObjectionsPanel({ list, committee, onChanged }: { list: SelectionListDetail; committee: boolean; onChanged: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [objections, setObjections] = useState<Objection[] | null>(null);
  const [fallback, setFallback] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<"UPHELD" | "DISMISSED">("DISMISSED");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const loader = useRunner();
  const runner = useRunner();
  const canDecide = committee && list.status === "PROVISIONAL_PUBLISHED";

  const load = useCallback(() => {
    void loader.run(async () => {
      try {
        setObjections((await ep.listObjections(list.id)).objections ?? []);
        setFallback(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setFallback(true);
          setObjections(null);
          return;
        }
        throw e;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);
  useEffect(load, [load]);

  const target = (objections ?? []).find((o) => o.grievance_id === selected);
  const validTarget = fallback ? UUID_RE.test(selected.trim()) : !!target && !target.decided;
  const decide = () => void runner.run(async () => {
    await ep.decideObjection(list.id, selected.trim(), { outcome: result, reason: reason.trim() });
    setDone(t("selection.objectionDecided", { outcome: t(`objection.${result}` as MessageKey) }));
    setReason("");
    setSelected("");
    load();
    onChanged();
  });
  const open = (objections ?? []).filter((o) => !o.decided).length;

  return <section className="card decision-card">
    <div className="table-toolbar"><div><div className="section-title">{t("selection.objections")}</div>
      <div className="section-description">{objections ? t("selection.objectionsCount", { n: objections.length, open }) : t("selection.objectionsNote")}</div></div>
      <div className="table-tools"><Action icon="refresh" disabled={loader.busy} onClick={load}>{t("common.refresh")}</Action></div></div>
    <div className="decision-body">
      <ErrorNote error={loader.error} />
      {loader.busy && !objections && !fallback && <Loading />}
      {objections && <table><thead><tr>{canDecide && <th />}<th>{t("scrutiny.colApp")}</th><th>{t("selection.colStatus")}</th><th>{t("selection.colCreated")}</th><th>{t("selection.colDecided")}</th></tr></thead>
        <tbody>{objections.map((o) => <tr key={o.grievance_id} className={o.grievance_id === selected ? "row-active" : ""}>
          {canDecide && <td><input type="radio" name="objection" aria-label={o.application_no} disabled={o.decided} checked={o.grievance_id === selected} onChange={() => { setSelected(o.grievance_id); setDone(null); }} /></td>}
          <td><strong>{o.application_no}</strong></td>
          <td><Badge tone={OBJECTION_TONE[o.status] ?? "neutral"}>{i18n.tk(`objection.status.${o.status}`, o.status)}</Badge></td>
          <td>{i18n.formatDate(o.created_at, true)}</td>
          <td>{o.decided ? t("common.yes") : t("common.no")}</td>
        </tr>)}
          {objections.length === 0 && <tr><td colSpan={canDecide ? 5 : 4} className="muted">{t("selection.noObjections")}</td></tr>}</tbody></table>}
      {fallback && <Note tone="info">{t("selection.objectionsFallback")}</Note>}
      {canDecide && <>
        {fallback ? <label className="form-control"><span className="field-label">{t("selection.grievanceId")}</span><input value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" /></label>
          : <div className="muted">{target ? t("selection.objectionSelected", { no: target.application_no }) : t("selection.selectObjection")}</div>}
        <label className="form-control"><span className="field-label">{t("selection.objectionOutcome")}</span>
          <select value={result} onChange={(e) => setResult(e.target.value as "UPHELD" | "DISMISSED")}><option value="UPHELD">{t("objection.UPHELD")}</option><option value="DISMISSED">{t("objection.DISMISSED")}</option></select></label>
        <ReasonField label={t("selection.objectionReason")} value={reason} onChange={setReason} max={4000} />
        <ErrorNote error={runner.error} />
        <div className="decision-row"><Action variant="primary" disabled={!validTarget || !reasonOk(reason) || runner.busy} onClick={decide}>{t("selection.decideObjection")}</Action></div>
      </>}
      {done && <Note tone="success" title={done} />}
    </div>
  </section>;
}
