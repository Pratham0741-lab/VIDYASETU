import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { DeficiencyItem, DeficiencyList, ResubmitResult } from "../api/responses";
import { ApplicationPicker, useMyApplications } from "../applications";
import { useI18n } from "../i18n";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag, type Tone } from "../ui";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_TONE: Record<string, Tone> = { OPEN: "red", OVERDUE: "red", RESUBMITTED: "blue", RESOLVED: "green" };

/** The marked region of the document (PNG), fetched with the bearer token; shown only when the backend has one. */
function CropPreview({ applicationId, item }: { applicationId: string; item: DeficiencyItem }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!item.crop_ref) return;
    let objectUrl: string | null = null;
    ep.getDeficiencyCrop(applicationId, item.id).then(
      (blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => setFailed(true),
    );
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicationId, item.id, item.crop_ref]);
  if (!item.crop_ref) return null;
  return (
    <figure className="crop-preview">
      <div className="crop-frame">{url ? <img src={url} alt={t("def.cropAlt")} className="crop-image" /> : <span className="muted">{failed ? t("def.cropFailed") : t("common.loading")}</span>}</div>
      <figcaption>{t("def.cropCaption")}</figcaption>
    </figure>
  );
}

export default function DeficiencyScreen() {
  const i18n = useI18n();
  const { t, tk, formatDate } = i18n;
  const navigate = useNavigate();
  const { apps, selected, select, error: appsError, reload: reloadApps } = useMyApplications();
  const [list, setList] = useState<DeficiencyList | null>(null);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ResubmitResult | null>(null);
  const [resubmitted, setResubmitted] = useState<string | null>(null);
  const [otherSlot, setOtherSlot] = useState("");
  const [slotFor, setSlotFor] = useState<Record<string, string>>({});
  const [live, setLive] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    if (!selected) return;
    setError(null);
    try {
      const [defs, docs] = await Promise.all([ep.listDeficiencies(selected.id), ep.listDocuments(selected.id)]);
      setList(defs);
      setChecklist(docs.checklist);
    } catch (e) {
      setError(e);
    }
  }, [selected]);
  useEffect(() => {
    setList(null);
    setResult(null);
    load();
  }, [load]);

  const upload = async (key: string, slot: string, file: File | undefined) => {
    setError(null);
    setLocalError(null);
    if (!selected || !file || !slot) return;
    if (file.size > MAX_BYTES) return setLocalError(t("apply.tooLarge", { name: file.name }));
    if (!ACCEPTED.includes(file.type)) return setLocalError(t("apply.badType", { name: file.name }));
    setBusy(key);
    const doc = tk(`slot.${slot}`, slot);
    setLive(t("def.uploadingLive", { doc }));
    try {
      const res = await ep.uploadDocument(selected.id, slot, file);
      setLive(res.status === "QUALITY_REJECTED" ? "" : t("def.uploadedLive", { doc }));
      if (res.status === "QUALITY_REJECTED") {
        setLocalError(t("apply.retake", { issues: res.quality.issues.map((x) => tk(`quality.${x}`, x.replace(/_/g, " "))).join(", ") || t("quality.unknown") }));
      }
      await load();
    } catch (e) {
      setLive("");
      // e.g. 409 slot_not_in_open_deficiency for a document that no open item names.
      setError(e);
    } finally {
      setBusy(null);
      const input = inputs.current[key];
      if (input) input.value = "";
    }
  };

  const openDef = list?.deficiencies.find((d) => d.itemised && d.status === "OPEN") ?? null;
  const items = openDef?.items ?? [];
  const pending = items.filter((i) => i.status === "OPEN" || i.status === "OVERDUE");
  const uploaded = items.filter((i) => i.status === "RESUBMITTED" || i.status === "RESOLVED").length;
  const deadlines = pending.map((i) => i.deadline_at).filter((d): d is string => !!d).sort();
  const deadline = deadlines[0] ?? null;
  const daysLeft = deadline ? Math.ceil((new Date(deadline).getTime() - Date.now()) / DAY_MS) : null;
  const defective = selected?.current_stage === "DEFECTIVE";

  const resubmit = async () => {
    if (!selected) return;
    setBusy("resubmit");
    setError(null);
    try {
      if (openDef) {
        const r = await ep.resubmitDeficiency(selected.id, openDef.id);
        setResult(r);
        if (r.resubmitted && r.transition) setResubmitted(r.transition.to_stage);
      } else {
        const r = await ep.resubmitApplication(selected.id);
        setResubmitted(r.transition.to_stage);
      }
      await reloadApps();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const fileButton = (key: string, slot: string, label: string) => (
    <>
      <input ref={(el) => { inputs.current[key] = el; }} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => upload(key, slot, e.target.files?.[0])} />
      <Button variant="blue" icon="upload" disabled={busy !== null || !slot} onClick={() => inputs.current[key]?.click()}>{busy === key ? t("apply.uploading") : label}</Button>
    </>
  );
  const slotPicker = (value: string, onChange: (v: string) => void, id: string) => (
    <label className="slot-picker" htmlFor={id}>{t("def.chooseDocument")}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("def.chooseDocument")}</option>
        {checklist.map((s) => <option key={s} value={s}>{tk(`slot.${s}`, s)}</option>)}
      </select>
    </label>
  );
  const countdown = daysLeft === null ? "" : daysLeft < 0 ? t("def.overdue") : daysLeft === 0 ? t("def.dueToday") : t("def.daysLeft", { n: daysLeft });

  return (
    <main className="app-page def-page">
      <ScreenTitle
        eyebrow={t("def.eyebrow")}
        title={items.length ? t("def.title", { n: items.length }) : t("def.titleNone")}
        description={t("def.description")}
        action={deadline ? <div className={`deadline-box ${daysLeft !== null && daysLeft < 0 ? "is-overdue" : ""}`}><span>{t("def.respondBy")}</span><strong><time dateTime={deadline}>{formatDate(deadline, true)}</time></strong></div> : undefined}
      />
      <ApplicationPicker apps={apps} selected={selected} onSelect={select} />
      <ErrorNote error={appsError || error} />
      {localError && <div className="alert-danger" role="alert"><Icon name="warning" /><div><strong>{localError}</strong></div></div>}
      <p className="sr-only" aria-live="polite">{live}</p>
      {resubmitted && <InfoNote icon="check" title={t("def.resubmittedTitle")} text={t("def.resubmittedText", { stage: tk(`stage.${resubmitted}`, resubmitted) })} />}
      {result && !result.resubmitted && <InfoNote icon="warning" title={t("def.notClearedTitle")} text={t("def.notClearedText")} />}
      {!list && !error && selected && <p>{t("common.loading")}</p>}
      {apps && !selected && <InfoNote title={t("dash.noAppTitle")} text={t("dash.noAppText")} />}

      {countdown && pending.length > 0 && (
        <div className="alert-danger countdown"><Icon name="warning" size={24} /><div><strong className="num">{countdown}</strong><p>{t("def.deadlineText")}</p></div></div>
      )}

      {list && !defective && !openDef && !resubmitted && <InfoNote icon="check" title={t("def.nothingTitle")} text={t("def.nothingText", { stage: tk(`stage.${list.current_stage}`, list.current_stage) })} />}

      {list && defective && !openDef && (
        <Card className="def-item">
          <span className="def-icon"><Icon name="refresh" size={24} /></span>
          <div className="def-copy"><Tag tone="red">{t("stage.DEFECTIVE")}</Tag><h2>{t("def.gateTitle")}</h2><p>{t("def.gateText")}</p></div>
          <div className="def-actions"><Button variant="secondary" onClick={() => navigate(`/dashboard?app=${encodeURIComponent(selected!.id)}#notifications`)}>{t("def.seeNotice")}</Button></div>
        </Card>
      )}

      {items.length > 0 && selected && (
        <div className="def-list">
          {items.map((item) => {
            const slot = item.document_slot ?? slotFor[item.id] ?? "";
            const done = item.status === "RESUBMITTED" || item.status === "RESOLVED";
            return (
              <Card className={`def-item ${item.crop_ref ? "has-crop" : ""} ${done ? "accent-green" : ""}`} key={item.id}>
                <span className="def-icon"><Icon name={done ? "check" : "document"} size={24} /></span>
                <div className="def-copy">
                  <div className="def-meta">
                    <Tag tone={ITEM_TONE[item.status] ?? "amber"}>{tk(`def.status.${item.status}`, item.status)}</Tag>
                    <span>{item.document_slot ? tk(`slot.${item.document_slot}`, item.document_slot) : t("def.allDocuments")}</span>
                  </div>
                  <h2>{item.problem_code ? tk(item.problem_code, item.problem_code) : t("def.problemUnknown")}</h2>
                  {item.fix_code && <p>{tk(item.fix_code, item.fix_code)}</p>}
                  {item.deadline_at && (
                    <dl className="kv">
                      <dt>{t("def.itemDeadline")}</dt>
                      <dd><time dateTime={item.deadline_at}>{formatDate(item.deadline_at, true)}</time>{item.source ? <span className="muted"> · {tk(`def.source.${item.source}`, item.source)}</span> : null}</dd>
                    </dl>
                  )}
                </div>
                <CropPreview applicationId={selected.id} item={item} />
                {item.status !== "RESOLVED" && defective && (
                  <div className="def-actions">
                    {!item.document_slot && slotPicker(slotFor[item.id] ?? "", (v) => setSlotFor((m) => ({ ...m, [item.id]: v })), `slot-${item.id}`)}
                    <span className="hint">{t("apply.fileHint")}</span>
                    {fileButton(item.id, slot, done ? t("apply.replace") : t("apply.chooseFile"))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {list && defective && checklist.length > 0 && (
        <Card className="def-item accent-none">
          <span className="def-icon"><Icon name="document" size={24} /></span>
          <div className="def-copy"><h2>{t("def.otherTitle")}</h2><p>{t("def.otherText")}</p></div>
          <div className="def-actions">
            {slotPicker(otherSlot, setOtherSlot, "slot-other")}
            {fileButton("other", otherSlot, t("apply.chooseFile"))}
          </div>
        </Card>
      )}

      {list && defective && (
        <div className="def-submit">
          <div>
            <strong className="num">{openDef ? t("def.progress", { n: uploaded, m: items.length }) : t("def.progressGate")}</strong>
            <span>{openDef ? t("def.progressHint") : t("def.progressGateHint")}</span>
          </div>
          <Button disabled={busy !== null || (openDef !== null && uploaded === 0)} onClick={resubmit}>{busy === "resubmit" ? t("common.pleaseWait") : t("def.resubmit")}</Button>
        </div>
      )}
    </main>
  );
}
