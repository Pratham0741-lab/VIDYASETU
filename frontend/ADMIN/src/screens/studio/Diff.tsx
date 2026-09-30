import { useEffect, useState } from "react";
import * as ep from "../../api/endpoints";
import type { SchemeDiff, SchemeSummary } from "../../api/responses";
import { useI18n } from "../../i18n";
import { Action, Badge, ErrorNote, Loading, SectionTitle, useRunner, type Tone } from "../../ui";

const CHANGE_TONE: Record<string, Tone> = { added: "success", removed: "danger", changed: "warning" };

function short(v: unknown): string {
  if (v === undefined) return "–";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

/** GET /admin/schemes/:code/diff?from&to: config changes between two versions (any officer role). */
export default function Diff({ scheme, currentVersion }: { scheme: SchemeSummary; currentVersion: number | null }) {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const versions = scheme.versions ?? [];
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<SchemeDiff | null>(null);
  const runner = useRunner();

  // Default: the version before the selected one, compared with the selected one.
  useEffect(() => {
    const cur = currentVersion ?? versions.at(-1)?.version_no ?? null;
    const idx = versions.findIndex((v) => v.version_no === cur);
    setTo(cur);
    setFrom(idx > 0 ? versions[idx - 1].version_no : versions.find((v) => v.version_no !== cur)?.version_no ?? null);
    setDiff(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme.code, currentVersion]);

  if (versions.length < 2) return null;
  const compare = () => from && to && void runner.run(async () => setDiff(await ep.diffSchemeVersions(scheme.code, from, to)));
  const option = (v: { version_no: number; status: string }) => <option key={v.version_no} value={v.version_no}>{`v${v.version_no} · ${tk(`studio.status.${v.status}`, v.status)}`}</option>;

  return <section className="card studio-card diff-card">
    <SectionTitle title={t("studio.diff")} description={t("studio.diffNote")} />
    <div className="fields-grid">
      <label className="form-control"><span className="field-label">{t("studio.diffFrom")}</span><select value={from ?? ""} onChange={(e) => { setFrom(Number(e.target.value) || null); setDiff(null); }}>{versions.map(option)}</select></label>
      <label className="form-control"><span className="field-label">{t("studio.diffTo")}</span><select value={to ?? ""} onChange={(e) => { setTo(Number(e.target.value) || null); setDiff(null); }}>{versions.map(option)}</select></label>
    </div>
    <div className="decision-row"><Action icon="copy" disabled={!from || !to || from === to || runner.busy} onClick={() => compare()}>{t("studio.compare")}</Action></div>
    <ErrorNote error={runner.error} />
    {runner.busy && !diff && <Loading />}
    {diff && <div className="preview">
      <div className="form-section-title">{t("studio.diffSummary", { n: diff.change_count ?? (diff.changes ?? []).length, from: diff.from?.version_no ?? from ?? "–", to: diff.to?.version_no ?? to ?? "–" })}</div>
      {(diff.changes ?? []).length === 0 ? <div className="muted diff-empty">{t("studio.noDiff")}</div> : <table><thead><tr><th>{t("studio.diffPath")}</th><th>{t("studio.diffChange")}</th><th>{t("studio.diffFromValue")}</th><th>{t("studio.diffToValue")}</th></tr></thead>
        <tbody>{(diff.changes ?? []).map((c, k) => <tr key={k}><td className="mono">{c.path}</td><td><Badge tone={CHANGE_TONE[c.change] ?? "neutral"}>{tk(`studio.change.${c.change}`, c.change)}</Badge></td><td className="mono diff-value">{short(c.from)}</td><td className="mono diff-value">{short(c.to)}</td></tr>)}</tbody></table>}
    </div>}
  </section>;
}
