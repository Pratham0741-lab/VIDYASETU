import { useEffect, useState } from "react";
import * as ep from "../api/endpoints";
import type { HistoryEntry } from "../api/responses";
import { useI18n, type I18n } from "../i18n";
import { ErrorNote, Icon, Loading, SectionTitle, useRunner } from "../ui";

/**
 * Label for a trigger_action. Every value the backend writes is a workflow
 * transition name (backend/api/src/workflow/vidyasetu-workflow.ts, T):
 * eligibility_passed, eligibility_indeterminate, eligibility_failed, verify,
 * reject, mark_defective, resubmit, disburse. Unknown values are humanised.
 */
export function actionLabel(i18n: I18n, action: string): string {
  const human = action.replace(/[_.-]+/g, " ").trim();
  return i18n.tk(`history.action.${action}`, human ? human[0].toUpperCase() + human.slice(1) : action);
}

/** GET /applications/:id/history: stages, action and time only (no officer, no reason). */
export default function HistoryTimeline({ applicationId, refreshKey }: { applicationId: string; refreshKey: string }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const runner = useRunner();

  useEffect(() => {
    void runner.run(async () => setHistory((await ep.getApplicationHistory(applicationId)).history ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, refreshKey]);

  const fmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" });
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : fmt.format(d);
  };
  const stage = (s: string | null) => (s ? i18n.tk(`stage.${s}`, s) : "–");

  return <section className="card history-card">
    <SectionTitle title={t("history.title")} description={t("history.note")} />
    <ErrorNote error={runner.error} />
    {runner.busy && !history && <Loading />}
    {history && history.length === 0 && <div className="muted">{t("history.empty")}</div>}
    {history && history.length > 0 && <ol className="history-list">
      {history.map((h, k) => <li key={`${h.at}-${k}`} className={k === history.length - 1 ? "current" : ""}>
        <span className="history-dot"><Icon name={k === history.length - 1 ? "clock" : "check"} size={12} /></span>
        <div>
          <strong>{actionLabel(i18n, h.trigger_action)}</strong>
          <span>{h.from_stage ? `${stage(h.from_stage)} → ${stage(h.to_stage)}` : stage(h.to_stage)}</span>
          <small>{when(h.at)}</small>
        </div>
      </li>)}
    </ol>}
  </section>;
}
