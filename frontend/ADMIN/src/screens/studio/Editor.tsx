import { useEffect, useMemo, useState } from "react";
import * as ep from "../../api/endpoints";
import type { ConfigIssue, ConfigRule, SchemeConfig, SchemeVersionDetail, SelectionPolicy, SelectionPool, ValidateResult } from "../../api/responses";
import { useI18n, type MessageKey } from "../../i18n";
import { Action, Badge, ErrorNote, Field, Icon, Note, SectionTitle, useRunner } from "../../ui";
import { IssueList, issuesAt, issuesOf } from "./issues";

// Only what schemas/scheme-config.schema.json accepts.
const BASES: SelectionPolicy["basis"][] = ["NO_COMPETITION", "RANKED_NO_CAP", "QUOTA"];
const DIRECTIONS = ["HIGHER_IS_BETTER", "LOWER_IS_BETTER"] as const;
const POOL_KEYS: SelectionPool["key"][] = ["ST_OTHERS", "PVTG"];
const ROUNDINGS = ["HALF_UP", "FLOOR", "CEIL"] as const;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A config as the editor expects it, whatever the server returned (never crash on a missing section). */
function normalise(c: SchemeConfig | null | undefined): SchemeConfig {
  const x = clone(c ?? ({} as SchemeConfig));
  return {
    ...x,
    rules: Array.isArray(x.rules) ? x.rules.map((r) => ({ ...r, params: r?.params && typeof r.params === "object" ? r.params : {} })) : [],
    benefits: Array.isArray(x.benefits) ? x.benefits : [],
    required_documents: Array.isArray(x.required_documents) ? x.required_documents : [],
    fund_sharing_ratio: x.fund_sharing_ratio ?? null,
  };
}

/** Edits one rule parameter in place of its original type (number, list of text, text, yes/no). */
function ParamInput({ name, value, disabled, onChange }: { name: string; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value));
  useEffect(() => setText(Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value)), [value]);
  if (typeof value === "number") {
    return <label className="form-control"><span className="field-label">{name}</span>
      <input type="number" disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }} /></label>;
  }
  if (typeof value === "boolean") {
    return <label className="check-line"><input type="checkbox" disabled={disabled} checked={value} onChange={(e) => onChange(e.target.checked)} /> {name}</label>;
  }
  if (Array.isArray(value) && value.every((x) => typeof x === "string" || typeof x === "number")) {
    const numeric = value.length > 0 && value.every((x) => typeof x === "number");
    return <label className="form-control"><span className="field-label">{name} ({t("studio.listHint")})</span>
      <input disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); const parts = e.target.value.split(",").map((p) => p.trim()).filter(Boolean); onChange(numeric ? parts.map(Number).filter(Number.isFinite) : parts); }} /></label>;
  }
  if (typeof value === "string") {
    return <label className="form-control"><span className="field-label">{name}</span>
      {value.length > 120 ? <textarea disabled={disabled} rows={3} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />
        : <input disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />}</label>;
  }
  return <div className="form-control"><span className="field-label">{name}</span><code className="mono json-inline">{JSON.stringify(value)}</code><small className="hint">{t("studio.editInJson")}</small></div>;
}

function RuleBlock({ rule, index, disabled, issues, onParam }: { rule: ConfigRule; index: number; disabled: boolean; issues: ConfigIssue[]; onParam: (key: string, v: unknown) => void }) {
  const { t, tk } = useI18n();
  const params = Object.entries(rule.params ?? {});
  const money = params.some(([k]) => /income|amount|ceiling/i.test(k));
  return <div className="rule-block" data-rule={index}>
    <div className="rule-head">
      <div className={`rule-icon${money ? " rupee" : " eligibility-rule-icon"}`}>{money ? "₹" : "IF"}</div>
      <div><strong className={money ? "income-title" : "applicant-category-title"}>{rule.id || `#${index + 1}`}</strong>
        <span className={money ? "income-description" : "applicant-category-description"}>{`${tk(`studio.ruleType.${rule.type}`, rule.type)} · ${rule.message_key ?? ""}`}</span></div>
      <Badge tone={rule.type === "eligibility" ? "info" : "neutral"}>{tk(`studio.ruleType.${rule.type}`, rule.type)}</Badge>
    </div>
    <div className="logic-row rule-expr"><div className="logic-pill mono">{rule.expr}</div></div>
    {params.length > 0 && <div className="income-row rule-params">{params.map(([k, v]) => <ParamInput key={k} name={k} value={v} disabled={disabled} onChange={(nv) => onParam(k, nv)} />)}</div>}
    {params.length === 0 && <div className="muted rule-params">{t("studio.noParams")}</div>}
    {(rule.doc_refs ?? []).length > 0 && <div className="muted rule-docs">{t("studio.docRefs")}: {(rule.doc_refs ?? []).join(", ")}</div>}
    <IssueList issues={issues} />
  </div>;
}

export default function Editor({ detail, knownWorkflows, canAuthor, onSaved }: { detail: SchemeVersionDetail; knownWorkflows: string[]; canAuthor: boolean; onSaved: () => void }) {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const code = detail.scheme.code;
  const v = detail.version.version_no;
  const locked = !detail.editable || !canAuthor;
  const [config, setConfig] = useState<SchemeConfig>(() => normalise(detail.version.config));
  const [newDoc, setNewDoc] = useState("");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [validated, setValidated] = useState<ValidateResult | null>(null);
  const saver = useRunner();
  const validator = useRunner();

  const original = useMemo(() => JSON.stringify(normalise(detail.version.config)), [detail]);
  const dirty = JSON.stringify(config) !== original;
  const issues = issuesOf(saver.error ?? validator.error);
  const ruleIssues = (i: number) => issuesAt(issues, `config.rules[${i}]`);
  const mapped = new Set<ConfigIssue>([
    ...config.rules.flatMap((_, i) => ruleIssues(i)),
    ...issuesAt(issues, "config.required_documents"),
    ...issuesAt(issues, "config.selection_policy"),
    ...issuesAt(issues, "config.workflow"),
  ]);
  const otherIssues = issues.filter((i) => !mapped.has(i));

  useEffect(() => setJson(JSON.stringify(config, null, 2)), [config]);

  const update = (fn: (c: SchemeConfig) => void) => {
    const next = clone(config);
    fn(next);
    setConfig(next);
    setValidated(null);
  };
  const setParam = (i: number, key: string, value: unknown) => update((c) => { c.rules[i].params[key] = value; });
  const policy = config.selection_policy;
  const operational = config.rules.filter((r) => r.type === "operational");
  const setPolicy = (p: SelectionPolicy | undefined) => update((c) => { if (p) c.selection_policy = p; else delete c.selection_policy; });

  const save = () => void saver.run(async () => {
    const saved = await ep.updateSchemeDraft(code, v, { config });
    setConfig(normalise(saved.config));
    setSavedAt(saved.updated_at);
    validator.setError(null);
    onSaved();
  });
  const validate = () => void validator.run(async () => {
    saver.setError(null);
    setValidated(await ep.validateSchemeVersion(code, v));
  });
  const applyJson = () => {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("studio.jsonNotObject"));
      setConfig(normalise(parsed as SchemeConfig));
      setJsonError(null);
      setValidated(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  return <div className="studio-editor">
    <div className="page-header scheme-page-header editor-toolbar">
      <div className="header-actions">
        {!locked && <div className="save-state">{dirty ? <><Icon name="edit" size={15} /> {t("studio.unsaved")}</> : <><Icon name="check" size={15} /> {savedAt ? t("studio.savedAt", { at: i18n.formatDate(savedAt, true) }) : t("studio.noChanges")}</>}</div>}
        {locked && <Badge tone="neutral">{detail.editable ? t("studio.readOnly") : t("studio.locked")}</Badge>}
        {!locked && <Action icon="check" disabled={validator.busy || dirty} title={dirty ? t("studio.saveFirst") : undefined} onClick={validate}>{t("studio.validate")}</Action>}
        {!locked && <div className="scheme-publish-action"><Action variant="primary" disabled={!dirty || saver.busy} onClick={save}>{saver.busy ? t("common.pleaseWait") : t("studio.saveDraft")}</Action></div>}
      </div>
    </div>
    {locked && <Note tone="info" title={detail.editable ? t("studio.readOnly") : t("studio.locked")}>{t("studio.lockedNote")}</Note>}
    {issues.length > 0 && <Note tone="danger" title={t("studio.issuesTitle", { n: issues.length })}>{t("studio.issuesNote")}</Note>}
    <IssueList issues={otherIssues} />
    <ErrorNote error={issues.length === 0 ? saver.error ?? validator.error : null} />
    {validated && <Note tone="success" title={t("studio.validOk")}>{t("studio.validSummary", { rules: Object.entries(validated.rules_by_type ?? {}).map(([k, n]) => `${tk(`studio.ruleType.${k}`, k)} ${n}`).join(", "), fields: (validated.form_fields ?? []).join(", ") || "–", docs: (validated.document_checklist ?? []).length, workflow: validated.workflow })}</Note>}

    <div className="studio-grid">
      <section className="card studio-card">
        <SectionTitle title={t("studio.eligibility")} description={t("studio.eligibilityNote")} />
        <div className="fields-grid">
          <Field label={t("studio.name")} value={detail.scheme.name} />
          <Field label={t("studio.code")} value={detail.scheme.code} />
        </div>
        {config.rules.map((r, i) => <RuleBlock key={`${r.id}-${i}`} rule={r} index={i} disabled={locked} issues={ruleIssues(i)} onParam={(k, nv) => setParam(i, k, nv)} />)}
        {config.rules.length === 0 && <div className="muted">{t("studio.noRules")}</div>}
        <div className="subsection-head"><div><strong className="documents-title">{t("studio.mandatoryDocs")}</strong><span className="documents-description">{t("studio.mandatoryDocsNote")}</span></div></div>
        <div className="document-list">
          {config.required_documents.map((d, i) => <div className="document-item" key={`${d}-${i}`}><div className="doc-icon"><Icon name="file" /></div><div><strong>{d}</strong></div><Badge>{t("studio.required")}</Badge>
            {!locked && <Action variant="ghost" onClick={() => update((c) => { c.required_documents.splice(i, 1); })}>{t("decision.removeItem")}</Action>}</div>)}
          {config.required_documents.length === 0 && <div className="muted">{t("studio.noDocs")}</div>}
        </div>
        {!locked && <div className="add-doc-row"><input value={newDoc} maxLength={300} placeholder={t("studio.docPlaceholder")} onChange={(e) => setNewDoc(e.target.value)} />
          <div className="add-document-action"><Action variant="ghost" icon="plus" disabled={!newDoc.trim()} onClick={() => { update((c) => { c.required_documents.push(newDoc.trim()); }); setNewDoc(""); }}>{t("studio.addDocument")}</Action></div></div>}
        <IssueList issues={issuesAt(issues, "config.required_documents")} />
      </section>

      <section className="card studio-card">
        <SectionTitle headingClassName="scoring-section-heading" title={t("studio.selection")} description={t("studio.selectionNote")} />
        <div className="score-summary"><div><strong className="weighted-score-title">{t("studio.selectionBasis")}</strong>
          <select disabled={locked} value={policy?.basis ?? ""} onChange={(e) => setPolicy(e.target.value ? { ...(policy ?? {}), basis: e.target.value as SelectionPolicy["basis"] } : undefined)}>
            <option value="">{t("studio.basisDefault")}</option>
            {BASES.map((b) => <option key={b} value={b}>{tk(`studio.basis.${b}`, b)}</option>)}
          </select></div></div>
        {policy && policy.basis !== "NO_COMPETITION" && <div className="weight-list"><div className="weight-item">
          <div className="weight-top"><div><span className="color-dot blue" /><strong className="weight-label">{t("studio.merit")}</strong></div></div>
          <div className="fields-grid">
            <label className="form-control"><span className="field-label">{t("studio.meritRule")}</span>
              <select disabled={locked} value={policy.merit?.rule_id ?? ""} onChange={(e) => setPolicy({ ...policy, merit: e.target.value ? { rule_id: e.target.value, direction: policy.merit?.direction ?? "HIGHER_IS_BETTER" } : undefined })}>
                <option value="">–</option>{operational.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label>
            <label className="form-control"><span className="field-label">{t("studio.direction")}</span>
              <select disabled={locked || !policy.merit} value={policy.merit?.direction ?? "HIGHER_IS_BETTER"} onChange={(e) => policy.merit && setPolicy({ ...policy, merit: { ...policy.merit, direction: e.target.value as (typeof DIRECTIONS)[number] } })}>
                {DIRECTIONS.map((d) => <option key={d} value={d}>{tk(`studio.direction.${d}`, d)}</option>)}</select></label>
          </div>
          <div className="weight-meta">{operational.length ? t("studio.meritNote") : t("studio.noOperational")}</div>
        </div></div>}
        {policy?.basis === "QUOTA" && <>
          <div className="subsection-head quota-title"><div><strong className="quota-heading">{t("studio.pools")}</strong><span>{t("studio.poolsNote")}</span></div></div>
          {POOL_KEYS.map((key) => {
            const pools = policy.pools ?? [];
            const pool = pools.find((p) => p.key === key);
            const setPool = (p: SelectionPool | null) => setPolicy({ ...policy, pools: [...pools.filter((x) => x.key !== key), ...(p ? [p] : [])] });
            return <div className="quota-card" key={key}>
              <div className="quota-top"><div className="quota-icon"><Icon name="users" /></div>
                <div><strong className="quota-candidate">{t(`studio.pool.${key}` as MessageKey)}</strong><span>{key}</span></div>
                <label className="check-line"><input type="checkbox" disabled={locked} checked={!!pool} onChange={(e) => setPool(e.target.checked ? { key, seats: 0 } : null)} /> {t("studio.poolUse")}</label></div>
              {pool && <div className="fields-grid">
                <label className="form-control"><span className="field-label">{t("studio.seats")}</span><input type="number" min={0} step={1} disabled={locked} value={pool.seats} onChange={(e) => setPool({ ...pool, seats: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
                <label className="form-control"><span className="field-label">{t("studio.femalePct")}</span><input type="number" min={0} max={100} disabled={locked} value={pool.female_percentage ?? ""} onChange={(e) => setPool(e.target.value === "" ? (({ female_percentage: _f, ...rest }) => rest)(pool) : { ...pool, female_percentage: Number(e.target.value) })} /></label>
                <label className="form-control"><span className="field-label">{t("studio.rounding")}</span>
                  <select disabled={locked} value={pool.rounding ?? ""} onChange={(e) => setPool(e.target.value ? { ...pool, rounding: e.target.value as (typeof ROUNDINGS)[number] } : (({ rounding: _r, ...rest }) => rest)(pool))}>
                    <option value="">–</option>{ROUNDINGS.map((r) => <option key={r} value={r}>{tk(`studio.rounding.${r}`, r)}</option>)}</select></label>
              </div>}
              {pool && pool.female_percentage !== undefined && <div className="quota-foot"><span>{t("studio.femaleFoot", { pct: pool.female_percentage, seats: pool.seats })}</span></div>}
            </div>;
          })}
          <Note tone="info">{t("studio.noPwd")}</Note>
        </>}
        <IssueList issues={issuesAt(issues, "config.selection_policy")} />
        <div className="subsection-head"><div><strong>{t("studio.workflow")}</strong><span>{t("studio.workflowNote")}</span></div></div>
        <label className="form-control"><select disabled={locked} value={config.workflow ?? ""} onChange={(e) => update((c) => { if (e.target.value) c.workflow = e.target.value; else delete c.workflow; })}>
          <option value="">{t("studio.workflowDefault")}</option>{knownWorkflows.map((w) => <option key={w} value={w}>{w}</option>)}
          {config.workflow && !knownWorkflows.includes(config.workflow) && <option value={config.workflow}>{config.workflow}</option>}</select></label>
        <IssueList issues={issuesAt(issues, "config.workflow")} />
        <div className="fields-grid other-sections">
          <Field label={t("studio.benefits")} value={String(config.benefits.length)} />
          <Field label={t("studio.fundSharing")} value={config.fund_sharing_ratio ?? "–"} />
        </div>
      </section>
    </div>

    <details className="card studio-card json-panel">
      <summary><strong>{t("studio.advancedJson")}</strong> <span className="muted">{t("studio.advancedJsonNote")}</span></summary>
      <textarea className="mono json-editor" spellCheck={false} readOnly={locked} value={json} onChange={(e) => setJson(e.target.value)} rows={18} />
      {jsonError && <div className="hint-danger">{t("studio.jsonInvalid", { detail: jsonError })}</div>}
      {!locked && <div className="decision-row"><Action onClick={applyJson}>{t("studio.applyJson")}</Action></div>}
    </details>
  </div>;
}
