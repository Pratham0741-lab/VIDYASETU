import { useState, type FormEvent } from "react";
import * as ep from "../../api/endpoints";
import type { SchemeConfig, SchemeSummary } from "../../api/responses";
import type { DisbursementMode, SchemeType } from "../../api/types";
import { useI18n } from "../../i18n";
import { Action, ErrorNote, Note, SectionTitle, useRunner } from "../../ui";
import { IssueList, issuesOf } from "./issues";

const SCHEME_TYPES: SchemeType[] = ["CENTRAL_SECTOR", "CENTRALLY_SPONSORED"];
const DISBURSEMENT_MODES: DisbursementMode[] = ["SCHEDULED_BY_PLATFORM", "FORWARDED_TO_STATE"];
const CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

/** The smallest config the server accepts: no rules, benefits or documents (nothing invented). */
export const BLANK_CONFIG: SchemeConfig = { rules: [], benefits: [], required_documents: [], fund_sharing_ratio: null };

/** POST /admin/schemes: a scheme without versions. */
export function NewSchemeForm({ onCreated }: { onCreated: (code: string) => void }) {
  const { t, tk } = useI18n();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<SchemeType>("CENTRAL_SECTOR");
  const [mode, setMode] = useState<DisbursementMode>("SCHEDULED_BY_PLATFORM");
  const runner = useRunner();
  const valid = CODE_RE.test(code) && name.trim() !== "" && department.trim() !== "";

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    void runner.run(async () => {
      const s = await ep.createScheme({ code, name: name.trim(), department: department.trim(), description: description.trim() || undefined, type, disbursement_mode: mode });
      onCreated(s.code);
    });
  };

  return <form className="studio-form" onSubmit={submit}>
    <SectionTitle title={t("studio.newScheme")} description={t("studio.newSchemeNote")} />
    <div className="fields-grid">
      <label className="form-control"><span className="field-label">{t("studio.code")}</span><input value={code} maxLength={32} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TRIBAL_ARTS" />
        <small className={code && !CODE_RE.test(code) ? "hint-danger" : "hint"}>{t("studio.codeHint")}</small></label>
      <label className="form-control"><span className="field-label">{t("studio.name")}</span><input value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></label>
      <label className="form-control"><span className="field-label">{t("studio.department")}</span><input value={department} maxLength={300} onChange={(e) => setDepartment(e.target.value)} /></label>
      <label className="form-control"><span className="field-label">{t("studio.schemeType")}</span>
        <select value={type} onChange={(e) => setType(e.target.value as SchemeType)}>{SCHEME_TYPES.map((x) => <option key={x} value={x}>{tk(`studio.type.${x}`, x)}</option>)}</select></label>
      <label className="form-control"><span className="field-label">{t("studio.disbursement")}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as DisbursementMode)}>{DISBURSEMENT_MODES.map((x) => <option key={x} value={x}>{tk(`studio.disb.${x}`, x)}</option>)}</select></label>
      <label className="form-control wide"><span className="field-label">{t("studio.description")} ({t("common.optional")})</span><textarea value={description} maxLength={2000} rows={2} onChange={(e) => setDescription(e.target.value)} /></label>
    </div>
    <ErrorNote error={runner.error} />
    <IssueList issues={issuesOf(runner.error)} />
    <div className="decision-row"><Action variant="primary" disabled={!valid || runner.busy} onClick={() => submit()}>{runner.busy ? t("common.pleaseWait") : t("studio.createScheme")}</Action></div>
  </form>;
}

/**
 * POST /admin/schemes/:code/versions: a new DRAFT, from a blank config or a
 * copy of an existing version's config (this scheme: based_on_version; another
 * scheme: its config is fetched and sent). The server validates it first.
 */
export function NewDraftForm({ scheme, schemes, onCreated }: { scheme: SchemeSummary; schemes: SchemeSummary[]; onCreated: (v: number) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const own = scheme.versions ?? [];
  const defaultSource = own.find((v) => v.status === "active") ?? own.at(-1);
  const [source, setSource] = useState(defaultSource ? `${scheme.code}:${defaultSource.version_no}` : "blank");
  const runner = useRunner();

  const create = () => void runner.run(async () => {
    let created;
    if (source === "blank") created = await ep.createSchemeDraft(scheme.code, { config: BLANK_CONFIG });
    else {
      const [code, v] = source.split(":");
      if (code === scheme.code) created = await ep.createSchemeDraft(scheme.code, { based_on_version: Number(v) });
      else {
        const from = await ep.getSchemeVersion(code, Number(v));
        created = await ep.createSchemeDraft(scheme.code, { config: from.version.config });
      }
    }
    onCreated(created.version_no);
  });

  return <div className="studio-form">
    <SectionTitle title={t("studio.newDraft")} description={t("studio.newDraftNote")} />
    <label className="form-control"><span className="field-label">{t("studio.startFrom")}</span>
      <select value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="blank">{t("studio.blank")}</option>
        {[scheme, ...schemes.filter((s) => s.code !== scheme.code)].map((s) => <optgroup key={s.code} label={s.code}>
          {(s.versions ?? []).map((v) => <option key={v.version_no} value={`${s.code}:${v.version_no}`}>{`${s.code} v${v.version_no} · ${i18n.tk(`studio.status.${v.status}`, v.status)}`}</option>)}
        </optgroup>)}
      </select>
      <small className="hint">{source === "blank" ? t("studio.blankHint") : t("studio.copyHint")}</small></label>
    {own.some((v) => v.status === "draft") && <Note tone="info">{t("studio.draftExists")}</Note>}
    <ErrorNote error={runner.error} />
    <IssueList issues={issuesOf(runner.error)} />
    <div className="decision-row"><Action variant="primary" icon="plus" disabled={runner.busy} onClick={create}>{runner.busy ? t("common.pleaseWait") : t("studio.createDraft")}</Action></div>
  </div>;
}
