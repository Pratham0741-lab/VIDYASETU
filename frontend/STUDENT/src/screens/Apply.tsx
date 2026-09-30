import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import * as ep from "../api/endpoints";
import type { ApplicationDocuments, CreatedApplication, DocumentView, Draft, FormField } from "../api/responses";
import type { CreateApplicationDto } from "../api/types";
import { useMyApplications } from "../applications";
import { useAuth } from "../auth/AuthProvider";
import { useI18n, type MessageKey } from "../i18n";
import { categoryLabel } from "../i18n/labels";
import { RECORDED_FIELDS, useSchemeCatalogue, type SchemeEntry } from "../schemes";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag, type Tone } from "../ui";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
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
  return <div className="wizard">{steps.map((step, index) => <div className={index < active ? "done" : index === active ? "active" : ""} key={step}><span>{index < active ? <Icon name="check" /> : index + 1}</span><div><small>{t("apply.stepN", { n: index + 1 })}</small><strong>{t(step)}</strong></div></div>)}</div>;
}

function UploadRow({ title, file, issue, tag, action }: { title: string; file?: string; issue?: string; tag?: { tone: Tone; text: string }; action: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={`upload-row ${issue ? "has-issue" : ""}`}>
      <span className="upload-icon"><Icon name={file ? "document" : "upload"} /></span>
      <div><strong>{title}</strong><p>{file || t("apply.fileHint")}</p>{issue && <small><Icon name="warning" size={14} />{issue}</small>}</div>
      {tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
      {action}
    </div>
  );
}

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ApplicationScreen() {
  const i18n = useI18n();
  const { t, tk, formatDate, formatNumber } = i18n;
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
      let created: CreatedApplication;
      if (draft) {
        await ep.updateDraft(draft.id, toDto(form, scheme));
        created = (await ep.submitDraft(draft.id)).application;
      } else {
        created = await ep.createApplication(toDto(form, scheme));
      }
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

  const stepAction = <Tag tone="blue">{t("apply.stepOf", { n: step + 1 })}</Tag>;
  const eyebrow = step === 3 && selected ? t("apply.eyebrowApp", { no: selected.application_no }) : scheme ? t("apply.eyebrowScheme", { code: scheme.code }) : t("apply.eyebrow");

  return (
    <main className="app-page">
      <ScreenTitle eyebrow={eyebrow} title={t(step === 3 ? "apply.titleDocs" : "apply.title")} description={t(step === 3 ? "apply.descriptionDocs" : "apply.description")} action={stepAction} />
      <WizardSteps active={step} />
      <div className="content-sidebar">
        <Card>
          <ErrorNote error={error || schemesError} />

          {step === 0 && (
            <>
              <div className="card-heading"><div><h2>{t("apply.profileTitle")}</h2><p>{t("apply.profileText")}</p></div></div>
              {profile && (
                <div className="check-table">
                  {([
                    ["field.firstName", `${profile.first_name} ${profile.last_name}`],
                    ["field.category", profile.category ? categoryLabel(i18n, profile.category) : t("common.notStated")],
                    ["field.gender", profile.gender ? tk(`gender.${profile.gender}`, profile.gender) : t("common.notStated")],
                    ["field.dob", profile.dob ? formatDate(profile.dob) : t("common.notStated")],
                    ["field.domicileState", [profile.domicile_state, profile.domicile_district].filter(Boolean).join(", ") || t("common.notStated")],
                    ["field.annualIncome", profile.annual_income ? `₹${formatNumber(Number(profile.annual_income))}` : t("common.notStated")],
                  ] as Array<[MessageKey, string]>).map(([label, value]) => (
                    <div className="check-row" key={label}><span className="rule-check"><Icon name="check" /></span><div><small>{t(label)}</small><strong>{value}</strong></div><div><Tag tone="gray">{t("apply.recorded")}</Tag></div></div>
                  ))}
                </div>
              )}
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
              <div className="type-control-row">
                <label>{t("apply.academicYear")}<input value={form.academic_year} onChange={(e) => setField("academic_year", e.target.value)} placeholder="2026-27" /></label>
                <label>{t("apply.courseYear")}<span>{t("common.optional")}</span><input type="number" min={1} max={10} value={form.course_year} onChange={(e) => setField("course_year", e.target.value)} /></label>
              </div>
              <div className="type-control-row">
                <label>{t("apply.institutionName")}<span>{t("common.optional")}</span><input value={form.institution_name} onChange={(e) => setField("institution_name", e.target.value)} /></label>
                <label>{t("apply.institutionCode")}<span>{t("common.optional")}</span><input value={form.institution_code} onChange={(e) => setField("institution_code", e.target.value)} /></label>
              </div>
              <div className="type-control-row">
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
              <div className="check-table">
                <div className="check-row"><span className="rule-check"><Icon name="document" /></span><div><small>{t("apply.scheme")}</small><strong>{scheme ? `${scheme.name} (${scheme.code} v${scheme.version})` : form.schemeVersionId}</strong></div><div><Tag>{form.academic_year}</Tag></div></div>
                <div className="check-row"><span className="rule-check"><Icon name="home" /></span><div><small>{t("apply.institutionName")}</small><strong>{[form.institution_name, form.institution_code, form.course_name].filter(Boolean).join(" · ") || t("common.notStated")}</strong></div><div><small>{form.course_year ? t("apply.courseYearN", { n: form.course_year }) : ""}</small></div></div>
                {declarableFields(scheme).filter((f) => form.declared[f.key]).map((f) => (
                  <div className="check-row" key={f.key}><span className="rule-check"><Icon name="check" /></span><div><small>{tk(`formField.${f.key}`, f.key.replace(/_/g, " "))}</small><strong>{form.declared[f.key]}</strong></div><div><Tag tone="gray">{t("apply.declared")}</Tag></div></div>
                ))}
              </div>
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
        <aside>
          <Card className="tip-card"><Icon name="document" /><h3>{t("apply.tipTitle")}</h3><ul><li>{t("apply.tip1")}</li><li>{t("apply.tip2")}</li><li>{t("apply.tip3")}</li><li>{t("apply.tip4")}</li></ul></Card>
          <Card className="help-card"><h3>{t("apply.helpTitle")}</h3><p>{t("apply.helpText")}</p>{step === 3 && <Button variant="secondary" onClick={() => navigate("/apply?new=1")}>{t("apply.startAnother")}</Button>}</Card>
        </aside>
      </div>
    </main>
  );
}

function stateTag(state: string, t: ReturnType<typeof useI18n>["t"]): { tone: Tone; text: string } {
  switch (state) {
    case "MISSING": return { tone: "gray", text: t("doc.state.MISSING") };
    case "PROCESSING": return { tone: "blue", text: t("doc.state.PROCESSING") };
    case "QUALITY_REJECTED": return { tone: "amber", text: t("doc.state.QUALITY_REJECTED") };
    case "FAILED": return { tone: "red", text: t("doc.state.FAILED") };
    case "NEEDS_REVIEW": return { tone: "blue", text: t("doc.state.NEEDS_REVIEW") };
    default: return { tone: "green", text: t("doc.state.DONE") };
  }
}

function DocumentsStep({ applicationId, stage, gate }: { applicationId: string; stage: string; gate: CreatedApplication["eligibility_gate"] }) {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const navigate = useNavigate();
  const [docs, setDocs] = useState<ApplicationDocuments | null>(null);
  const [live, setLive] = useState<Record<string, DocumentView>>({});
  const [retake, setRetake] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const closed = stage === "REJECTED" || stage === "DISBURSED";

  const load = useCallback(async () => {
    try {
      setDocs(await ep.listDocuments(applicationId));
    } catch (e) {
      setError(e);
    }
  }, [applicationId]);
  useEffect(() => {
    load();
  }, [load]);

  const poll = async (documentId: string) => {
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const d = await ep.getDocument(documentId);
        setLive((m) => ({ ...m, [documentId]: d }));
        if (d.state !== "PROCESSING") break;
      } catch {
        break;
      }
    }
    await load();
  };

  const onFile = async (slot: string, file: File | undefined) => {
    setError(null);
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setLocalError(t("apply.tooLarge", { name: file.name }));
    if (!ACCEPTED.includes(file.type)) return setLocalError(t("apply.badType", { name: file.name }));
    setUploading(slot);
    try {
      const res = await ep.uploadDocument(applicationId, slot, file);
      if (res.status === "QUALITY_REJECTED") setRetake((m) => ({ ...m, [slot]: res.quality.issues }));
      else {
        setRetake((m) => ({ ...m, [slot]: [] }));
        await load();
        await poll(res.document_id);
      }
    } catch (e) {
      setError(e);
    } finally {
      setUploading(null);
      const input = inputs.current[slot];
      if (input) input.value = "";
    }
  };

  const issueText = (issues: string[]) => t("apply.retake", { issues: issues.map((x) => tk(`quality.${x}`, x.replace(/_/g, " "))).join(", ") || t("quality.unknown") });

  return (
    <>
      <div className="card-heading"><div><h2>{t("apply.docsTitle")}</h2><p>{t("apply.docsText")}</p></div></div>
      {gate && (gate.routed_to === "DEFECTIVE" ? (
        <div className="alert-danger"><Icon name="warning" /><div><strong>{t("apply.gateRefused")}</strong><p>{gate.failed_rules.map((r) => (r.message_key ? tk(`rule.${r.message_key}`, r.explanation, { income: "", limit: "" }) : r.explanation)).join(" ")}</p></div></div>
      ) : (
        <InfoNote icon="check" title={t("apply.submittedTitle")} text={gate.needs_eligibility_review ? t("apply.submittedReview") : t("apply.submittedText")} />
      ))}
      <div className="quality-banner"><Icon name="shield" /><div><strong>{t("apply.qualityTitle")}</strong><p>{docs?.mock_notice ? t("apply.qualityMock") : t("apply.qualityText")}</p></div></div>
      {closed && <div className="alert-danger"><Icon name="warning" /><div><strong>{t("reason.application_closed")}</strong></div></div>}
      <ErrorNote error={error} />
      {localError && <div className="alert-danger" role="alert"><Icon name="warning" /><div><strong>{localError}</strong></div></div>}
      {!docs && !error && <p>{t("common.loading")}</p>}
      {docs && docs.slots.length === 0 && <p>{t("common.empty")}</p>}
      <div className="upload-list">
        {docs?.slots.map(({ slot, document_id, state }) => {
          const view = (document_id && live[document_id]) || docs.documents.find((d) => d.document_id === document_id);
          const current = view?.state ?? state;
          const rejected = retake[slot]?.length ? retake[slot] : current === "QUALITY_REJECTED" ? (view?.quality?.issues ?? []) : null;
          const issue = rejected ? issueText(rejected) : current === "FAILED" ? t("apply.unreadable") : undefined;
          return (
            <UploadRow
              key={slot}
              title={tk(`slot.${slot}`, slot)}
              file={view ? `${view.file_name} · ${sizeText(view.file_size_bytes)}` : undefined}
              issue={issue}
              tag={uploading === slot ? { tone: "blue", text: t("apply.uploading") } : stateTag(retake[slot]?.length ? "QUALITY_REJECTED" : current, t)}
              action={
                <>
                  <input ref={(el) => { inputs.current[slot] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={(e) => onFile(slot, e.target.files?.[0])} />
                  <Button variant={view ? "ghost" : "secondary"} disabled={closed || uploading !== null} onClick={() => inputs.current[slot]?.click()}>{view ? t("apply.replace") : t("apply.chooseFile")}</Button>
                </>
              }
            />
          );
        })}
      </div>
      <div className="form-actions"><Button onClick={() => navigate(`/dashboard?app=${encodeURIComponent(applicationId)}`)}>{t("apply.toDashboard")} <Icon name="arrow" /></Button></div>
    </>
  );
}
