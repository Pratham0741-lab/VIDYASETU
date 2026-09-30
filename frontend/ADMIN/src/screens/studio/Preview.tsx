import { useEffect, useState } from "react";
import * as ep from "../../api/endpoints";
import type { FormSchemaField, PreviewResult, SchemeVersionDetail } from "../../api/responses";
import { useI18n } from "../../i18n";
import { Action, Badge, ErrorNote, Loading, Note, SectionTitle, useRunner, type Tone } from "../../ui";

const OUTCOME_TONE: Record<string, Tone> = { ELIGIBLE: "success", INELIGIBLE: "danger", INDETERMINATE: "warning" };
const VERDICT_TONE: Record<string, Tone> = { PASS: "success", FAIL: "danger", ERROR: "warning", COMPUTED: "info", INFO: "neutral" };

function display(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Sets a dotted key ("a.b") on the applicant object. */
function setPath(target: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let node = target;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== "object") node[p] = {};
    node = node[p] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function FieldInput({ field, value, onChange }: { field: FormSchemaField; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const types = field.types ?? [];
  const options = (field.options ?? []).filter((o) => typeof o === "string" || typeof o === "number").map(String);
  const limits = (field.limits ?? []).map((l) => `${l.param} ${display(l.value)}`).join("; ");
  const label = <span className="field-label">{field.key}{types.length ? ` (${types.join("|")})` : ""}</span>;
  if (types.includes("boolean")) {
    return <label className="form-control">{label}<select value={value} onChange={(e) => onChange(e.target.value)}><option value="">–</option><option value="true">{t("common.yes")}</option><option value="false">{t("common.no")}</option></select></label>;
  }
  if (options.length > 0 && !types.includes("number")) {
    return <label className="form-control">{label}<select value={value} onChange={(e) => onChange(e.target.value)}><option value="">–</option>{options.map((o) => <option key={o} value={o}>{o.length > 80 ? `${o.slice(0, 80)}…` : o}</option>)}</select>{limits && <small className="hint">{limits}</small>}</label>;
  }
  return <label className="form-control">{label}<input type={types.includes("number") ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} />{limits && <small className="hint">{t("studio.limits", { limits })}</small>}</label>;
}

/**
 * POST /admin/schemes/:code/versions/:v/preview: evaluates a synthetic
 * applicant against any version (drafts included). Nothing is stored.
 */
export default function Preview({ detail, canAuthor }: { detail: SchemeVersionDetail; canAuthor: boolean }) {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const code = detail.scheme.code;
  const v = detail.version.version_no;
  const [fields, setFields] = useState<FormSchemaField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PreviewResult | null>(null);
  const loader = useRunner();
  const runner = useRunner();

  // The form comes from the version itself: an empty profile returns its derived form schema.
  useEffect(() => {
    if (!canAuthor) return;
    void loader.run(async () => setFields((await ep.previewSchemeVersion(code, v, {})).form_schema?.fields ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, v, detail.version.updated_at, canAuthor]);

  if (!canAuthor) return null;

  const applicant = () => {
    const out: Record<string, unknown> = {};
    for (const f of fields ?? []) {
      const raw = values[f.key];
      if (raw === undefined || raw === "") continue;
      const types = f.types ?? [];
      const value = types.includes("boolean") && (raw === "true" || raw === "false") ? raw === "true" : types.includes("number") && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      setPath(out, f.key, value);
    }
    return out;
  };
  const run = () => void runner.run(async () => setResult(await ep.previewSchemeVersion(code, v, applicant())));

  return <section className="card studio-card preview-card">
    <SectionTitle title={t("studio.preview")} description={t("studio.previewNote")} />
    <Note tone="warning">{t("studio.syntheticOnly")}</Note>
    <ErrorNote error={loader.error} />
    {!fields && loader.busy && <Loading />}
    {fields && fields.length === 0 && <div className="muted">{t("studio.noFormFields")}</div>}
    {fields && fields.length > 0 && <div className="fields-grid">{fields.map((f) => <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} onChange={(nv) => setValues((x) => ({ ...x, [f.key]: nv }))} />)}</div>}
    <ErrorNote error={runner.error} />
    <div className="decision-row"><Action variant="primary" icon="eye" disabled={!fields || runner.busy} onClick={run}>{runner.busy ? t("common.pleaseWait") : t("studio.runPreview")}</Action>
      <Action variant="ghost" onClick={() => { setValues({}); setResult(null); }}>{t("studio.clearPreview")}</Action></div>
    {result && <div className="preview">
      <div className="form-section-title">{t("studio.outcome")}: <Badge tone={OUTCOME_TONE[result.outcome] ?? "neutral"}>{tk(`studio.outcome.${result.outcome}`, result.outcome)}</Badge> <span className="muted">{result.stored ? "" : t("studio.notStored")}</span></div>
      <table><thead><tr><th>{t("studio.colRule")}</th><th>{t("studio.colType")}</th><th>{t("studio.colVerdict")}</th><th>{t("studio.colValue")}</th><th>{t("studio.colExplanation")}</th></tr></thead>
        <tbody>{(result.rules ?? []).map((r) => <tr key={r.rule_id}><td className="mono">{r.rule_id}</td><td>{tk(`studio.ruleType.${r.rule_type}`, r.rule_type)}</td>
          <td><Badge tone={VERDICT_TONE[r.verdict] ?? "neutral"}>{tk(`studio.verdict.${r.verdict}`, r.verdict)}</Badge></td><td>{display(r.value)}</td><td>{r.explanation ?? "–"}</td></tr>)}
          {(result.rules ?? []).length === 0 && <tr><td colSpan={5} className="muted">{t("studio.noRules")}</td></tr>}</tbody></table>
      <div className="muted meta-line">{t("studio.explanationNote")}</div>
    </div>}
  </section>;
}
