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
const ITEM_TONE: Record<string, Tone> = { OPEN: "red", OVERDUE: "red", RESUBMITTED: "amber", RESOLVED: "green" };

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
    <div className="crop-preview">
      <div className="document-mock">{url ? <img src={url} alt={t("def.cropAlt")} className="crop-image" /> : <span>{failed ? t("def.cropFailed") : t("common.loading")}</span>}</div>
      <small>{t("def.cropCaption")}</small>
    </div>
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
    try {
      const res = await ep.uploadDocument(selected.id, slot, file);
      if (res.status === "QUALITY_REJECTED") {
        setLocalError(t("apply.retake", { issues: res.quality.issues.map((x) => tk(`quality.${x}`, x.replace(/_/g, " "))).join(", ") || t("quality.unknown") }));
      }
      await load();
    } catch (e) {
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

  const fileButton = (key: string, slot: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <>
      <input ref={(el) => { inputs.current[key] = el; }} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => upload(key, slot, e.target.files?.[0])} />
      <Button variant={variant} disabled={busy !== null || !slot} onClick={() => inputs.current[key]?.click()}>{busy === key ? t("apply.uploading") : label}</Button>
    </>
  );

  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={t("def.eyebrow")}
        title={items.length ? t("def.title", { n: pending.length }) : t("def.titleNone")}
        description={t("def.description")}
        action={deadline ? <div className="deadline"><Icon name="clock" /><div><small>{t("def.respondBy")}</small><strong>{formatDate(deadline, true)}</strong></div></div> : undefined}
      />
      <ApplicationPicker apps={apps} selected={selected} onSelect={select} />
      <ErrorNote error={appsError || error} />
      {localError && <div className="alert-danger" role="alert"><Icon name="warning" /><div><strong>{localError}</strong></div></div>}
      {resubmitted && <InfoNote icon="check" title={t("def.resubmittedTitle")} text={t("def.resubmittedText", { stage: tk(`stage.${resubmitted}`, resubmitted) })} />}
      {result && !result.resubmitted && <InfoNote icon="warning" title={t("def.notClearedTitle")} text={t("def.notClearedText")} />}
      {!list && !error && selected && <p>{t("common.loading")}</p>}
      {apps && !selected && <InfoNote title={t("dash.noAppTitle")} text={t("dash.noAppText")} />}

      {daysLeft !== null && pending.length > 0 && (
        <div className="alert-danger"><Icon name="warning" /><div><strong>{daysLeft >= 0 ? t("def.daysLeft", { n: daysLeft }) : t("def.overdue")}</strong><p>{t("def.deadlineText")}</p></div></div>
      )}

      {list && !defective && !openDef && !resubmitted && <InfoNote icon="check" title={t("def.nothingTitle")} text={t("def.nothingText", { stage: tk(`stage.${list.current_stage}`, list.current_stage) })} />}

      {list && defective && !openDef && (
        <Card className="deficiency-card compact">
          <div className="issue-num">01</div>
          <div className="issue-copy"><Tag tone="red">{t("stage.DEFECTIVE")}</Tag><h2>{t("def.gateTitle")}</h2><p>{t("def.gateText")}</p></div>
          <div className="fix-upload"><Icon name="refresh" /><strong>{t("def.gateAction")}</strong><Button variant="secondary" onClick={() => navigate(`/dashboard?app=${encodeURIComponent(selected!.id)}`)}>{t("def.seeNotice")}</Button></div>
        </Card>
      )}

      {items.length > 0 && selected && (
        <div className="deficiency-list">
          {items.map((item, index) => {
            const slot = item.document_slot ?? slotFor[item.id] ?? "";
            const done = item.status === "RESUBMITTED" || item.status === "RESOLVED";
            return (
              <Card className={`deficiency-card ${item.crop_ref ? "" : "compact"}`} key={item.id}>
                <div className="issue-num">{String(index + 1).padStart(2, "0")}</div>
                <div className="issue-copy">
                  <Tag tone={ITEM_TONE[item.status] ?? "amber"}>{item.document_slot ? tk(`slot.${item.document_slot}`, item.document_slot) : t("def.allDocuments")} · {tk(`def.status.${item.status}`, item.status)}</Tag>
                  <h2>{item.problem_code ? tk(item.problem_code, item.problem_code) : t("def.problemUnknown")}</h2>
                  <p>{item.fix_code ? tk(item.fix_code, item.fix_code) : ""}</p>
                  {item.deadline_at && <div className="officer-note"><strong>{t("def.itemDeadline")}</strong><p>{formatDate(item.deadline_at, true)}{item.source ? ` · ${tk(`def.source.${item.source}`, item.source)}` : ""}</p></div>}
                </div>
                <CropPreview applicationId={selected.id} item={item} />
                <div className="fix-upload">
                  <Icon name={done ? "check" : "upload"} />
                  <strong>{done ? t("def.uploadedFix") : t("def.dropHere")}</strong>
                  <span>{t("apply.fileHint")}</span>
                  {!item.document_slot && (
                    <select value={slotFor[item.id] ?? ""} onChange={(e) => setSlotFor((m) => ({ ...m, [item.id]: e.target.value }))}>
                      <option value="">{t("def.chooseDocument")}</option>
                      {checklist.map((s) => <option key={s} value={s}>{tk(`slot.${s}`, s)}</option>)}
                    </select>
                  )}
                  {item.status !== "RESOLVED" && defective && fileButton(item.id, slot, done ? t("apply.replace") : t("apply.chooseFile"))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {list && defective && checklist.length > 0 && (
        <Card className="deficiency-card compact other-upload">
          <div className="issue-num"><Icon name="document" /></div>
          <div className="issue-copy"><h2>{t("def.otherTitle")}</h2><p>{t("def.otherText")}</p></div>
          <div className="fix-upload">
            <select value={otherSlot} onChange={(e) => setOtherSlot(e.target.value)}>
              <option value="">{t("def.chooseDocument")}</option>
              {checklist.map((s) => <option key={s} value={s}>{tk(`slot.${s}`, s)}</option>)}
            </select>
            {fileButton("other", otherSlot, t("apply.chooseFile"))}
          </div>
        </Card>
      )}

      {list && defective && (
        <div className="sticky-submit">
          <div>
            <strong>{openDef ? t("def.progress", { n: uploaded, m: items.length }) : t("def.progressGate")}</strong>
            <span>{openDef ? t("def.progressHint") : t("def.progressGateHint")}</span>
          </div>
          <Button disabled={busy !== null || (openDef !== null && pending.length > 0)} onClick={resubmit}>{busy === "resubmit" ? t("common.pleaseWait") : t("def.resubmit")}</Button>
        </div>
      )}
    </main>
  );
}
