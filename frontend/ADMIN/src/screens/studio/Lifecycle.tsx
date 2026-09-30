import { useState } from "react";
import * as ep from "../../api/endpoints";
import type { SchemeVersionDetail } from "../../api/responses";
import { useI18n } from "../../i18n";
import { Action, ErrorNote, Note, useRunner } from "../../ui";
import { IssueList, issuesOf } from "./issues";

type Mode = "none" | "publish" | "retire";

/**
 * Publish a DRAFT (it becomes immutable; the active version it supersedes is
 * archived) or retire an ACTIVE version (no new applications). Shown only to
 * publisher roles; the server decides and a 403 is shown as such.
 */
export default function Lifecycle({ detail, canPublish, onChanged }: { detail: SchemeVersionDetail; canPublish: boolean; onChanged: (message: string) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [mode, setMode] = useState<Mode>("none");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const runner = useRunner();
  const v = detail.version;
  const code = detail.scheme.code;
  if (!canPublish || (v.status !== "draft" && v.status !== "active")) return null;

  const close = () => {
    setMode("none");
    runner.setError(null);
  };
  const publish = () => void runner.run(async () => {
    const r = await ep.publishSchemeVersion(code, v.version_no, effectiveFrom ? { effective_from: effectiveFrom } : {});
    close();
    const superseded = (r.superseded ?? []).map((s) => `v${s.version_no}`).join(", ");
    onChanged(superseded ? t("studio.publishedSuperseded", { v: v.version_no, old: superseded }) : t("studio.published", { v: v.version_no }));
  });
  const retire = () => void runner.run(async () => {
    await ep.retireSchemeVersion(code, v.version_no);
    close();
    onChanged(t("studio.retired", { v: v.version_no }));
  });

  return <>
    {v.status === "draft" && <div className="scheme-publish-action"><Action variant="primary" onClick={() => setMode("publish")}>{t("studio.publish")}</Action></div>}
    {v.status === "active" && <Action variant="danger" onClick={() => setMode("retire")}>{t("studio.retire")}</Action>}
    {mode !== "none" && <div className="modal-backdrop" role="presentation" onClick={close}>
      <div className="card modal-card" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title" onClick={(e) => e.stopPropagation()}>
        <div className="section-title" id="lifecycle-title">{mode === "publish" ? t("studio.publishTitle", { code, v: v.version_no }) : t("studio.retireTitle", { code, v: v.version_no })}</div>
        {mode === "publish" ? <>
          <Note tone="warning" title={t("studio.immutableTitle")}>{t("studio.immutableText")}</Note>
          <label className="form-control"><span className="field-label">{t("studio.effectiveFrom")} ({t("common.optional")})</span>
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /><small className="hint">{t("studio.effectiveHint")}</small></label>
        </> : <Note tone="warning" title={t("studio.retireWarnTitle")}>{t("studio.retireWarnText")}</Note>}
        <ErrorNote error={runner.error} />
        <IssueList issues={issuesOf(runner.error)} />
        <div className="decision-row">
          <Action variant="ghost" onClick={close}>{t("common.cancel")}</Action>
          <Action variant={mode === "publish" ? "primary" : "danger"} disabled={runner.busy} onClick={mode === "publish" ? publish : retire}>{runner.busy ? t("common.pleaseWait") : mode === "publish" ? t("studio.confirmPublish") : t("studio.confirmRetire")}</Action>
        </div>
      </div>
    </div>}
  </>;
}
