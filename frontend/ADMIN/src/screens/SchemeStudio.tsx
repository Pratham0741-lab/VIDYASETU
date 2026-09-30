import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { SchemeList, SchemeSummary, SchemeVersionDetail, SchemeVersionSummary } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { can } from "../auth/permissions";
import { useI18n, type I18n } from "../i18n";
import { Action, Badge, ErrorNote, Icon, Loading, Note, SectionTitle, useRunner, type Tone } from "../ui";
import { NewDraftForm, NewSchemeForm } from "./studio/CreatePanel";
import Editor from "./studio/Editor";
import Preview from "./studio/Preview";
import Lifecycle from "./studio/Lifecycle";
import Diff from "./studio/Diff";

const STATUS_TONE: Record<string, Tone> = { draft: "warning", active: "success", archived: "neutral" };

export function versionStatus(i18n: I18n, status: string): string {
  return i18n.tk(`studio.status.${status}`, status);
}

function VersionChip({ v, active, onClick }: { v: SchemeVersionSummary; active: boolean; onClick: () => void }) {
  const i18n = useI18n();
  return <button type="button" className={`version-chip${active ? " active" : ""}`} onClick={onClick} title={v.effective_from ? i18n.formatDate(v.effective_from) : undefined}>
    <strong>v{v.version_no}</strong><Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{versionStatus(i18n, v.status)}</Badge>
  </button>;
}

/** Scheme Studio: schemes, their versions and (for authors) drafting, validation, preview and publication. */
export default function SchemeStudio() {
  const i18n = useI18n();
  const { t } = i18n;
  const { me } = useAuth();
  const canAuthor = can(me?.role, "studio.author");
  const canPublish = can(me?.role, "studio.publish");
  const [flash, setFlash] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const code = params.get("scheme");
  const versionNo = Number(params.get("v")) || null;
  const [list, setList] = useState<SchemeList | null>(null);
  const [detail, setDetail] = useState<SchemeVersionDetail | null>(null);
  const listRunner = useRunner();
  const detailRunner = useRunner();
  const [panel, setPanel] = useState<"none" | "scheme" | "draft">("none");

  const loadList = useCallback(() => {
    void listRunner.run(async () => setList(await ep.listSchemes()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(loadList, [loadList]);

  const loadDetail = useCallback(() => {
    if (!code || !versionNo) {
      setDetail(null);
      return;
    }
    void detailRunner.run(async () => setDetail(await ep.getSchemeVersion(code, versionNo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, versionNo]);
  useEffect(loadDetail, [loadDetail]);

  const select = (schemeCode: string, v: number | null) => {
    setFlash(null);
    const next = new URLSearchParams();
    next.set("scheme", schemeCode);
    if (v) next.set("v", String(v));
    setParams(next);
  };
  const schemes = list?.schemes ?? [];
  const current: SchemeSummary | undefined = schemes.find((s) => s.code === code);
  const versions = current?.versions ?? [];
  const selectedSummary = versions.find((v) => v.version_no === versionNo);

  return <div className="screen studio-screen">
    <div className="page-header scheme-page-header">
      <div className="studio-title"><div className="scheme-page-title">{current ? current.name : t("studio.title")}</div>
        <div className="scheme-page-subtitle">{current ? `${current.code} · ${current.department}` : t("studio.subtitle")}</div></div>
      <div className="header-actions">
        {detail && <div className="save-state"><Icon name="clock" size={15} /> {t("studio.updatedAt", { at: i18n.formatDate(detail.version.updated_at, true) })}</div>}
        {current && <label className="version-control"><div><small>{t("studio.version")}</small>
          <select value={versionNo ?? ""} onChange={(e) => select(current.code, Number(e.target.value) || null)}>
            <option value="">–</option>
            {versions.map((v) => <option key={v.version_no} value={v.version_no}>{`v${v.version_no} · ${versionStatus(i18n, v.status)}`}</option>)}
          </select></div></label>}
        {canAuthor && current && <div className="scheme-publish-action"><Action variant={panel === "draft" ? "primary" : "secondary"} icon="plus" onClick={() => setPanel(panel === "draft" ? "none" : "draft")}>{t("studio.newDraft")}</Action></div>}
        {detail && detail.scheme.code === code && detail.version.version_no === versionNo && <Lifecycle key={`${detail.version.id}-${detail.version.status}`} detail={detail} canPublish={canPublish} onChanged={(m) => { setFlash(m); loadDetail(); loadList(); }} />}
        {!canAuthor && <Badge tone="info">{t("studio.readOnly")}</Badge>}
      </div>
    </div>

    {flash && <Note tone="success" title={flash} />}
    <section className="card studio-card studio-list">
      <SectionTitle title={t("studio.schemes")} description={t("studio.schemesNote")} action={<div className="header-actions">
        {canAuthor && <div className="add-document-action"><Action variant="ghost" icon="plus" onClick={() => setPanel(panel === "scheme" ? "none" : "scheme")}>{t("studio.newScheme")}</Action></div>}
        <Action icon="refresh" onClick={loadList}>{t("common.refresh")}</Action></div>} />
      {canAuthor && panel === "scheme" && <NewSchemeForm onCreated={(newCode) => { setPanel("draft"); loadList(); select(newCode, null); }} />}
      <ErrorNote error={listRunner.error} />
      {!list && listRunner.busy ? <Loading /> : <div className="document-list">
        {schemes.map((s) => <div key={s.code} className={`document-item scheme-row${s.code === code ? " active" : ""}`}>
          <div className="doc-icon"><Icon name="file" /></div>
          <div role="button" tabIndex={0} className="scheme-row-main" onClick={() => select(s.code, (s.versions ?? []).find((v) => v.status === "active")?.version_no ?? (s.versions ?? []).at(-1)?.version_no ?? null)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(s.code, null)}>
            <strong>{s.name}</strong><span>{`${s.code} · ${i18n.tk(`studio.type.${s.type}`, s.type)} · ${i18n.tk(`studio.disb.${s.disbursement_mode}`, s.disbursement_mode)}`}</span></div>
          <div className="version-chips">{(s.versions ?? []).map((v) => <VersionChip key={v.version_no} v={v} active={s.code === code && v.version_no === versionNo} onClick={() => select(s.code, v.version_no)} />)}
            {(s.versions ?? []).length === 0 && <Badge>{t("studio.noVersions")}</Badge>}</div>
        </div>)}
        {list && schemes.length === 0 && <div className="muted">{t("studio.noSchemes")}</div>}
      </div>}
    </section>

    {canAuthor && panel === "draft" && current && <section className="card studio-card"><NewDraftForm key={current.code} scheme={current} schemes={schemes} onCreated={(v) => { setPanel("none"); loadList(); select(current.code, v); }} /></section>}
    {code && !versionNo && current && panel !== "draft" && <Note tone="info">{(current.versions ?? []).length ? t("studio.pickVersion") : t("studio.noVersionYet")}</Note>}
    {code && versionNo && <>
      <ErrorNote error={detailRunner.error} />
      {detailRunner.busy && !detail && <Loading />}
      {detail && selectedSummary && <VersionSummary detail={detail} />}
      {detail && selectedSummary && detail.scheme.code === code && detail.version.version_no === versionNo &&
        <Editor key={detail.version.id} detail={detail} knownWorkflows={list?.known_workflows ?? []} canAuthor={canAuthor} onSaved={() => { loadDetail(); loadList(); }} />}
      {detail && selectedSummary && detail.scheme.code === code && detail.version.version_no === versionNo &&
        <Preview key={`preview-${detail.version.id}`} detail={detail} canAuthor={canAuthor} />}
      {current && <Diff scheme={current} currentVersion={versionNo} />}
    </>}
  </div>;
}

function VersionSummary({ detail }: { detail: SchemeVersionDetail }) {
  const i18n = useI18n();
  const { t } = i18n;
  const v = detail.version;
  const c = v.config;
  return <section className="card studio-card version-summary">
    <SectionTitle title={t("studio.versionTitle", { v: v.version_no })} description={detail.editable ? t("studio.editableNote") : t("studio.lockedNote")} action={<Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{versionStatus(i18n, v.status)}</Badge>} />
    <div className="kv-grid">
      <div><span>{t("studio.effectiveFrom")}</span><strong>{v.effective_from ? i18n.formatDate(v.effective_from) : "–"}</strong></div>
      <div><span>{t("studio.effectiveTo")}</span><strong>{v.effective_to ? i18n.formatDate(v.effective_to) : "–"}</strong></div>
      <div><span>{t("studio.rules")}</span><strong>{(c?.rules ?? []).length}</strong></div>
      <div><span>{t("studio.documents")}</span><strong>{(c?.required_documents ?? []).length}</strong></div>
      <div><span>{t("studio.benefits")}</span><strong>{(c?.benefits ?? []).length}</strong></div>
      <div><span>{t("studio.selectionBasis")}</span><strong>{c?.selection_policy ? i18n.tk(`studio.basis.${c.selection_policy.basis}`, c.selection_policy.basis) : t("studio.basisDefault")}</strong></div>
    </div>
  </section>;
}
