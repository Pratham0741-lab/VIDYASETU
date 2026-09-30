import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import * as ep from "../api/endpoints";
import type { ApplicationDocuments, AttentionReason, CreatedApplication, DocumentsComplete, Draft, FormField, SlotOutcome } from "../api/responses";
import type { CreateApplicationDto } from "../api/types";
import { useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
import { useI18n, type MessageKey } from "../i18n";
import { categoryLabel } from "../i18n/labels";
import { RECORDED_FIELDS, useSchemeCatalogue, type SchemeEntry } from "../schemes";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag, type Tone, type IconName } from "../ui";

const POLL_MS = 2000;
const POLL_TRIES = 30;

type Step = 0 | 1 | 2 | 3;
type AppForm = {
  schemeVersionId: string;
  academic_year: string;
  institution_name: string;
  institution_code: string;
  course_name: string;
  course_year: string;
  is_hosteller: "" | "yes" | "no";
  declared: Record<string, string>;
};

function currentAcademicYear(now = new Date()): string {
  const y = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const EMPTY_FORM: AppForm = {
  schemeVersionId: "",
  academic_year: currentAcademicYear(),
  institution_name: "",
  institution_code: "",
  course_name: "",
  course_year: "",
  is_hosteller: "",
  declared: {},
};

function formFromDraft(d: Draft): AppForm {
  const declared: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.declared ?? {})) declared[k] = v === null || v === undefined ? "" : String(v);
  return {
    schemeVersionId: d.scheme_version_id ?? "",
    academic_year: d.academic_year ?? currentAcademicYear(),
    institution_name: d.institution_name ?? "",
    institution_code: d.institution_code ?? "",
    course_name: d.course_name ?? "",
    course_year: d.course_year !== null && d.course_year !== undefined ? String(d.course_year) : "",
    is_hosteller: d.is_hosteller === null || d.is_hosteller === undefined ? "" : d.is_hosteller ? "yes" : "no",
    declared,
  };
}

function isNumberField(f: FormField) {
  return f.types.includes("number") && f.options.length === 0;
}
function isBooleanField(f: FormField) {
  return f.types.includes("boolean") && f.options.length === 0;
}

/** Declarable fields of a scheme: everything its rules read except recorded fields. */
function declarableFields(scheme: SchemeEntry | undefined): FormField[] {
  return (scheme?.form?.fields ?? []).filter((f) => !RECORDED_FIELDS.has(f.key));
}

function toDto(form: AppForm, scheme: SchemeEntry | undefined): CreateApplicationDto {
  const declared: Record<string, unknown> = {};
  for (const f of declarableFields(scheme)) {
    const raw = form.declared[f.key];
    if (raw === undefined || raw === "") continue;
    declared[f.key] = isNumberField(f) ? Number(raw) : isBooleanField(f) ? raw === "yes" : raw;
  }
  return {
    scheme_version_id: form.schemeVersionId,
    academic_year: form.academic_year.trim(),
    ...(form.institution_name.trim() ? { institution_name: form.institution_name.trim() } : {}),
    ...(form.institution_code.trim() ? { institution_code: form.institution_code.trim() } : {}),
    ...(form.course_name.trim() ? { course_name: form.course_name.trim() } : {}),
    ...(form.course_year ? { course_year: Number(form.course_year) } : {}),
    ...(form.is_hosteller ? { is_hosteller: form.is_hosteller === "yes" } : {}),
    ...(Object.keys(declared).length ? { declared } : {}),
  };
}

function WizardSteps({ active }: { active: number }) {
  const { t } = useI18n();
  const steps: MessageKey[] = ["apply.step.profile", "apply.step.form", "apply.step.submit", "apply.step.documents"];
  return (
    <ol className="wizard">
      {steps.map((step, index) => {
        const state = index < active ? "done" : index === active ? "active" : "";
        return (
          <li className={state} key={step} aria-current={index === active ? "step" : undefined}>
            <span className="wizard-mark" aria-hidden="true">{index < active ? <Icon name="check" size={24} /> : index + 1}</span>
            <span className="wizard-text"><small>{t("apply.stepN", { n: index + 1 })}</small><strong>{t(step)}</strong></span>
            {state && <span className="sr-only">{t(state === "done" ? "apply.stepDone" : "apply.stepCurrent")}</span>}
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_ICON: Partial<Record<SlotOutcome, IconName>> = { SCANNING: "loader", VERIFIED: "check", NEEDS_ATTENTION: "warning" };

/** One checklist row: title, and after an upload a status icon and pill (with the reason when it needs attention); one file action. */
function UploadRow({ title, file, issues, outcome, tag, action }: { title: string; file?: string; issues: string[]; outcome: SlotOutcome; tag: { tone: Tone; text: string }; action: ReactNode }) {
  const icon = STATUS_ICON[outcome];
  return (
    <li className={`upload-row is-${outcome.toLowerCase()} ${issues.length ? "has-issue" : ""}`}>
      {icon && <span className="upload-status" aria-hidden="true"><Icon name={icon} /></span>}
      <div className="upload-copy">
        <strong>{title}</strong>
        {file && <span className="upload-file num">{file}</span>}
        {outcome !== "MISSING" && <Tag tone={tag.tone}>{tag.text}</Tag>}
        {issues.map((issue) => <p className="upload-issue" key={issue}><Icon name="warning" />{issue}</p>)}
      </div>
      <div className="upload-action">{action}</div>
    </li>
  );
}

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ApplicationScreen() {
  const i18n = useI18n();
  const { t, tk, formatDate, formatAmount } = i18n;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const { apps, selected, error: appsError, reload: reloadApps } = useMyApplications();
  const { schemes, error: schemesError } = useSchemeCatalogue();
  const [step, setStep] = useState<Step | null>(null);
  const [form, setForm] = useState<AppForm>(EMPTY_FORM);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [missingConsent, setMissingConsent] = useState<string[] | null>(null);
  const [gate, setGate] = useState<CreatedApplication["eligibility_gate"]>(null);

  const startNew = params.get("new") === "1";
  const scheme = useMemo(() => schemes?.find((s) => s.versionId === form.schemeVersionId), [schemes, form.schemeVersionId]);
  // ?scheme=CODE (from the Schemes section) preselects that scheme's current version, but only into an empty
  // picker: a resumed draft keeps its own scheme.
  const wantedCode = params.get("scheme");
  const wantedScheme = wantedCode && schemes ? (schemes.find((s) => s.code === wantedCode) ?? null) : null;
  useEffect(() => {
    if (wantedScheme && !form.schemeVersionId) setForm((f) => (f.schemeVersionId ? f : { ...f, schemeVersionId: wantedScheme.versionId }));
  }, [wantedScheme, form.schemeVersionId]);

  // Where to start: an existing application goes to its documents; else resume the latest draft; else the profile.
  useEffect(() => {
    if (step !== null || apps === null) return;
    if (!startNew && (params.get("app") || apps.length > 0)) {
      setStep(3);
      return;
    }
    ep.listDrafts()
      .then((drafts) => {
        const open = drafts.filter((d) => d.status === "DRAFT").sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (open) {
          setDraft(open);
          setResumed(true);
          setForm(formFromDraft(open));
          setStep(1);
        } else setStep(0);
      })
      .catch(() => setStep(0));
  }, [apps, params, startNew, step]);

  const setField = <K extends keyof AppForm>(key: K, value: AppForm[K]) => {
    setSaved(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setDeclared = (key: string, value: string) => {
    setSaved(null);
    setForm((f) => ({ ...f, declared: { ...f.declared, [key]: value } }));
  };

  const saveDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const dto = toDto(form, scheme);
      const d = draft ? await ep.updateDraft(draft.id, dto) : await ep.createDraft(dto);
      setDraft(d);
      setSaved(formatDate(d.updated_at, true));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const goReview = async () => {
    setError(null);
    setStep(2);
    try {
      setMissingConsent((await ep.getConsents()).missing_for_applications);
    } catch (e) {
      setError(e);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Always through a draft: it keeps the declared answers, and the application waits in
      // SUBMITTED (no officer queue) until its documents are uploaded and scanned.
      const dto = toDto(form, scheme);
      const d = draft ? await ep.updateDraft(draft.id, dto) : await ep.createDraft(dto);
      const created: CreatedApplication = (await ep.submitDraft(d.id, true)).application;
      setGate(created.eligibility_gate);
      setDraft(null);
      await reloadApps();
      setParams({ app: created.id }, { replace: true });
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.reason === "consent_required") {
        navigate("/consent", { state: { next: "/apply" } });
        return;
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (step === null) {
    return <main className="app-page"><ErrorNote error={appsError} /><p>{t("common.loading")}</p></main>;
  }

  const stepAction = <span className="pill num">{t("apply.stepOf", { n: step + 1 })}</span>;
  const eyebrow = step === 3 && selected ? t("apply.eyebrowApp", { no: selected.application_no }) : scheme ? t("apply.eyebrowScheme", { code: scheme.code }) : t("apply.eyebrow");

  return (
    <main className="app-page">
      <ScreenTitle eyebrow={eyebrow} title={t(step === 3 ? "apply.titleDocs" : "apply.title")} description={t(step === 3 ? "apply.descriptionDocs" : "apply.description")} action={stepAction} />
      <WizardSteps active={step} />
      <div className="split apply-grid">
        <Card className="apply-main">
          <ErrorNote error={error || schemesError} />

          {step === 0 && (
            <>
              <div className="card-heading"><div><h2>{t("apply.profileTitle")}</h2><p>{t("apply.profileText")}</p></div></div>
              {profile && (
                <dl className="kv profile-kv">
                  {([
                    ["field.firstName", `${profile.first_name} ${profile.last_name}`],
                    ["field.category", profile.category ? categoryLabel(i18n, profile.category) : t("common.notStated")],
                    ["field.gender", profile.gender ? tk(`gender.${profile.gender}`, profile.gender) : t("common.notStated")],
                    ["field.dob", profile.dob ? formatDate(profile.dob) : t("common.notStated")],
                    ["field.domicileState", [profile.domicile_state, profile.domicile_district].filter(Boolean).join(", ") || t("common.notStated")],
                    ["field.annualIncome", profile.annual_income && Number.isFinite(Number(profile.annual_income)) ? formatAmount(Number(profile.annual_income)) : t("common.notStated")],
                  ] as Array<[MessageKey, string]>).map(([label, value]) => (
                    <Fragment key={label}><dt>{t(label)}</dt><dd className="num">{value}</dd></Fragment>
                  ))}
                </dl>
              )}
              {profile && <Tag tone="gray">{t("apply.recorded")}</Tag>}
              <div className="human-note"><Icon name="user" /><div><strong>{t("apply.profileNoteTitle")}</strong><p>{t("apply.profileNoteText")}</p></div></div>
              <div className="form-actions"><Button onClick={() => setStep(1)}>{t("apply.continue")} <Icon name="arrow" /></Button></div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="card-heading"><div><h2>{t("apply.formTitle")}</h2><p>{t("apply.formText")}</p></div></div>
              {wantedCode && schemes && !wantedScheme && <InfoNote icon="warning" title={t("apply.schemeNotOpen", { code: wantedCode })} />}
              {draft && resumed && !saved && <InfoNote icon="document" title={t("apply.draftResumed")} text={t("apply.draftSavedAt", { date: formatDate(draft.updated_at, true) })} />}
              <label>{t("apply.scheme")}
                <select value={form.schemeVersionId} onChange={(e) => setField("schemeVersionId", e.target.value)}>
                  <option value="">{t("apply.chooseScheme")}</option>
                  {(schemes ?? []).map((s) => <option key={s.versionId} value={s.versionId}>{s.name} ({s.code} v{s.version})</option>)}
                </select>
              </label>
              <div className="field-row">
                <label>{t("apply.academicYear")}<input value={form.academic_year} onChange={(e) => setField("academic_year", e.target.value)} placeholder="2026-27" /></label>
                <label>{t("apply.courseYear")}<span>{t("common.optional")}</span><input type="number" min={1} max={10} value={form.course_year} onChange={(e) => setField("course_year", e.target.value)} /></label>
              </div>
              <div className="field-row">
                <label>{t("apply.institutionName")}<span>{t("common.optional")}</span><input value={form.institution_name} onChange={(e) => setField("institution_name", e.target.value)} /></label>
                <label>{t("apply.institutionCode")}<span>{t("common.optional")}</span><input value={form.institution_code} onChange={(e) => setField("institution_code", e.target.value)} /></label>
              </div>
              <div className="field-row">
                <label>{t("apply.courseName")}<span>{t("common.optional")}</span><input value={form.course_name} onChange={(e) => setField("course_name", e.target.value)} /></label>
                <label>{t("apply.hosteller")}<span>{t("common.optional")}</span>
                  <select value={form.is_hosteller} onChange={(e) => setField("is_hosteller", e.target.value as AppForm["is_hosteller"])}>
                    <option value="">{t("common.notStated")}</option><option value="yes">{t("common.yes")}</option><option value="no">{t("common.no")}</option>
                  </select>
                </label>
              </div>
              {scheme && declarableFields(scheme).length > 0 && <div className="card-heading"><div><h2>{t("apply.schemeFieldsTitle")}</h2><p>{t("apply.schemeFieldsText", { scheme: scheme.name })}</p></div></div>}
              {declarableFields(scheme).map((f) => (
                <label key={f.key}>{tk(`formField.${f.key}`, f.key.replace(/_/g, " "))}
                  {f.limits.length > 0 && <span>{t("apply.limit", { values: f.limits.map((l) => String(l.value)).join(" / ") })}</span>}
                  {f.options.length > 0 ? (
                    <select value={form.declared[f.key] ?? ""} onChange={(e) => setDeclared(f.key, e.target.value)}>
                      <option value="">{t("common.notStated")}</option>
                      {f.options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                    </select>
                  ) : isBooleanField(f) ? (
                    <select value={form.declared[f.key] ?? ""} onChange={(e) => setDeclared(f.key, e.target.value)}>
                      <option value="">{t("common.notStated")}</option><option value="yes">{t("common.yes")}</option><option value="no">{t("common.no")}</option>
                    </select>
                  ) : (
                    <input type={isNumberField(f) ? "number" : "text"} value={form.declared[f.key] ?? ""} onChange={(e) => setDeclared(f.key, e.target.value)} />
                  )}
                </label>
              ))}
              {saved && <InfoNote icon="check" title={t("apply.draftSaved")} text={t("apply.draftSavedAt", { date: saved })} />}
              <div className="form-actions">
                <Button variant="secondary" onClick={() => setStep(0)}>{t("apply.back")}</Button>
                <Button variant="secondary" disabled={busy || !form.schemeVersionId} onClick={saveDraft}>{t("apply.saveDraft")}</Button>
                <Button disabled={!form.schemeVersionId || !form.academic_year.trim()} onClick={goReview}>{t("apply.toReview")} <Icon name="arrow" /></Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="card-heading"><div><h2>{t("apply.reviewTitle")}</h2><p>{t("apply.reviewText")}</p></div></div>
              <dl className="kv review-kv">
                <dt>{t("apply.scheme")}</dt><dd>{scheme ? `${scheme.name} (${scheme.code} v${scheme.version})` : form.schemeVersionId}</dd>
                <dt>{t("apply.academicYear")}</dt><dd className="num">{form.academic_year}</dd>
                <dt>{t("apply.institutionName")}</dt><dd>{[form.institution_name, form.institution_code, form.course_name].filter(Boolean).join(" · ") || t("common.notStated")}</dd>
                {form.course_year && <><dt>{t("apply.courseYear")}</dt><dd className="num">{t("apply.courseYearN", { n: form.course_year })}</dd></>}
                {declarableFields(scheme).filter((f) => form.declared[f.key]).map((f) => (
                  <Fragment key={f.key}><dt>{tk(`formField.${f.key}`, f.key.replace(/_/g, " "))}</dt><dd>{form.declared[f.key]} <Tag tone="gray">{t("apply.declared")}</Tag></dd></Fragment>
                ))}
              </dl>
              {missingConsent && missingConsent.length > 0 && (
                <div className="alert-danger"><Icon name="warning" /><div><strong>{t("apply.consentMissing")}</strong><p>{t("api.consent.required", { purposes: missingConsent.join(", ") })}</p></div></div>
              )}
              <div className="human-note"><Icon name="shield" /><div><strong>{t("apply.gateTitle")}</strong><p>{t("apply.gateText")}</p></div></div>
              <div className="form-actions">
                <Button variant="secondary" onClick={() => setStep(1)}>{t("apply.back")}</Button>
                {missingConsent && missingConsent.length > 0 && <Button variant="secondary" onClick={() => navigate("/consent", { state: { next: "/apply" } })}>{t("apply.toConsent")}</Button>}
                <Button disabled={busy} onClick={submit}>{busy ? t("common.pleaseWait") : t("apply.submit")} <Icon name="arrow" /></Button>
              </div>
            </>
          )}

          {step === 3 && selected && <DocumentsStep applicationId={selected.id} stage={selected.current_stage} gate={gate} />}
          {step === 3 && !selected && apps && <p>{t("apply.noApplication")}</p>}
        </Card>
        <aside className="stack">
          <Card className="tip-card"><h3>{t("apply.tipTitle")}</h3><ul className="tick-list">{(["apply.tip1", "apply.tip2", "apply.tip3", "apply.tip4"] as const).map((k) => <li key={k}><Icon name="check" />{t(k)}</li>)}</ul></Card>
          <Card className="help-card accent-none"><h3>{t("apply.helpTitle")}</h3><p>{t("apply.helpText")}</p>{step === 3 && <Button variant="secondary" onClick={() => navigate("/apply?new=1")}>{t("apply.startAnother")}</Button>}</Card>
        </aside>
      </div>
    </main>
  );
}

const OUTCOME_TONE: Record<SlotOutcome, Tone> = { MISSING: "gray", SCANNING: "blue", VERIFIED: "green", NEEDS_ATTENTION: "amber" };

function DocumentsStep({ applicationId, stage, gate }: { applicationId: string; stage: string; gate: CreatedApplication["eligibility_gate"] }) {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const navigate = useNavigate();
  const [docs, setDocs] = useState<ApplicationDocuments | null>(null);
  const [moved, setMoved] = useState<DocumentsComplete | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const current = docs?.current_stage ?? stage;
  const closed = current === "REJECTED" || current === "DISBURSED";

  const fields = (names: string[]) => [...new Set(names.map((f) => tk(`docField.${f}`, f.replace(/_/g, " "))))].join(", ");
  const reasonText = (r: AttentionReason): string => {
    switch (r.code) {
      case "quality": return t("apply.retake", { issues: r.issues.map((x) => tk(`quality.${x}`, x.replace(/_/g, " "))).join(", ") || t("quality.unknown") });
      case "unreadable": return t("apply.unreadable");
      case "wrong_type": return t("doc.reason.wrong_type", { type: r.detected ? tk(`docType.${r.detected}`, r.detected) : "?" });
      case "type_uncertain": return t("doc.reason.type_uncertain");
      case "manual_check": return t("doc.reason.manual_check");
      case "low_confidence": return t("doc.reason.low_confidence", { fields: fields(r.fields) });
      case "profile_mismatch": return t("doc.reason.profile_mismatch", { fields: fields(r.fields) });
    }
  };

  // Load; an application still waiting for its documents moves on as soon as they are all in
  // (also when the applicant comes back later). The cross-document check can trail the last scan.
  const completing = useRef(false);
  const load = useCallback(async (): Promise<ApplicationDocuments | null> => {
    try {
      for (let i = 0; i < POLL_TRIES; i++) {
        const d = await ep.listDocuments(applicationId);
        setDocs(d);
        if (d.current_stage !== "SUBMITTED" || d.readiness.pending_slots.length > 0) return d;
        if (d.readiness.ready) {
          if (completing.current) return d; // another finished scan is already moving it on
          completing.current = true;
          try {
            const c = await ep.completeDocuments(applicationId);
            if (!c.advanced) return d;
            setMoved(c);
            const after = await ep.listDocuments(applicationId);
            setDocs(after);
            return after;
          } finally {
            completing.current = false;
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      setError(e);
    }
    return null;
  }, [applicationId]);
  useEffect(() => {
    load();
  }, [load]);

  const waitForScan = async (documentId: string, slot: string) => {
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        if ((await ep.getDocument(documentId)).state !== "PROCESSING") break;
      } catch {
        break;
      }
    }
    const outcome = (await load())?.slots.find((s) => s.slot === slot)?.outcome;
    if (outcome) setStatus(t("apply.statusLive", { doc: tk(`slot.${slot}`, slot), status: t(`doc.outcome.${outcome}`) }));
  };

  // Scanned automatically: upload, then OCR and checks run on the server; the row follows them.
  const onFile = async (slot: string, file: File | undefined) => {
    setError(null);
    if (!file) return;
    // Size and type are checked by the backend (10 MiB; PDF, JPG, PNG); its 413 / 415 message is shown as returned.
    setUploading(slot);
    setStatus(t("apply.statusLive", { doc: tk(`slot.${slot}`, slot), status: t("doc.outcome.SCANNING") }));
    try {
      const res = await ep.uploadDocument(applicationId, slot, file);
      await load();
      if (res.status === "PROCESSING") void waitForScan(res.document_id, slot);
    } catch (e) {
      setStatus("");
      setError(e);
    } finally {
      setUploading(null);
      const input = inputs.current[slot];
      if (input) input.value = "";
    }
  };

  const routed = moved?.eligibility_gate ?? gate;
  const disagree = docs?.readiness.consistency === "INCONSISTENT" || docs?.readiness.consistency === "UNCERTAIN";

  return (
    <>
      <div className="card-heading"><div><h2>{t("apply.docsTitle")}</h2><p>{t("apply.docsText")}</p></div></div>
      {current === "SUBMITTED" && !routed && <InfoNote icon="clock" title={t("apply.awaitingTitle")} text={t("apply.awaitingText")} />}
      {routed && (routed.routed_to === "DEFECTIVE" ? (
        <div className="alert-danger"><Icon name="warning" /><div><strong>{t("apply.gateRefused")}</strong><p>{routed.failed_rules.map((r) => (r.message_key ? tk(`rule.${r.message_key}`, r.explanation, { income: "", limit: "" }) : r.explanation)).join(" ")}</p></div></div>
      ) : (
        <InfoNote icon="check" title={t("apply.submittedTitle")} text={!routed.needs_eligibility_review ? t("apply.submittedText") : routed.outcome === "INDETERMINATE" ? t("apply.submittedReview") : t("apply.submittedDocsReview")} />
      ))}
      <div className="quality-banner"><Icon name="shield" /><div><strong>{t("apply.qualityTitle")}</strong><p>{docs?.mock_notice ? t("apply.qualityMock") : t("apply.qualityText")}</p></div></div>
      {closed && <div className="alert-danger"><Icon name="warning" /><div><strong>{t("reason.application_closed")}</strong></div></div>}
      {disagree && <div className="alert-danger"><Icon name="warning" /><div><strong>{t("apply.consistencyIssue")}</strong></div></div>}
      <ErrorNote error={error} />
      <p className="sr-only" aria-live="polite">{status}</p>
      {!docs && !error && <p>{t("common.loading")}</p>}
      {docs && docs.slots.length === 0 && <p>{t("common.empty")}</p>}
      {docs && docs.slots.length > 0 && <p className="hint">{t("apply.fileHint")}</p>}
      <ul className="upload-list">
        {docs?.slots.map(({ slot, document_id, outcome, reasons }) => {
          const view = docs.documents.find((d) => d.document_id === document_id);
          const shown: SlotOutcome = uploading === slot ? "SCANNING" : outcome;
          return (
            <UploadRow
              key={slot}
              title={tk(`slot.${slot}`, slot)}
              file={view ? `${view.file_name} · ${sizeText(view.file_size_bytes)}` : undefined}
              issues={shown === "NEEDS_ATTENTION" ? reasons.map(reasonText) : []}
              outcome={shown}
              tag={{ tone: OUTCOME_TONE[shown], text: t(`doc.outcome.${shown}`) }}
              action={
                <>
                  <input ref={(el) => { inputs.current[slot] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={(e) => onFile(slot, e.target.files?.[0])} />
                  <Button variant={view ? "ghost" : "blue"} disabled={closed || uploading !== null} onClick={() => inputs.current[slot]?.click()}>{view ? t("apply.replace") : t("apply.chooseFile")}</Button>
                </>
              }
            />
          );
        })}
      </ul>
      <div className="form-actions"><Button onClick={() => navigate(`/dashboard?app=${encodeURIComponent(applicationId)}`)}>{t("apply.toDashboard")} <Icon name="arrow" /></Button></div>
    </>
  );
}
