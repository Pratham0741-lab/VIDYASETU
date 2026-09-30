import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ActiveScheme } from "../api/responses";
import { useI18n } from "../i18n";
import { useSchemeList } from "../schemes";
import { Button, Card, ErrorNote, Icon, ScreenTitle, Tag } from "../ui";

/** Effective dates as returned: "From 1 Apr 2022 · no end date" / "From … to …". */
export function schemeDates(s: ActiveScheme, i18n: ReturnType<typeof useI18n>): string {
  const from = i18n.formatDate(s.effective_from);
  return s.effective_to ? i18n.t("schemes.fromTo", { from, to: i18n.formatDate(s.effective_to) }) : i18n.t("schemes.fromOpen", { from });
}

/** One scheme card (used on /schemes and on the landing page). Only fields from GET /schemes. */
export function SchemeCard({ scheme }: { scheme: ActiveScheme }) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const code = encodeURIComponent(scheme.scheme_code);
  return (
    <Card className="scheme-card">
      <Tag tone="gray">{scheme.scheme_code}</Tag>
      <h3>{scheme.scheme_name}</h3>
      <p>{t("schemes.version", { n: scheme.version_no })}</p>
      <p>{schemeDates(scheme, i18n)}</p>
      <div className="scheme-card-actions">
        <Button variant="secondary" onClick={() => navigate(`/schemes/${code}`)}>{t("schemes.viewDetails")}</Button>
        <Button onClick={() => navigate(`/?scheme=${code}#checker`)}>{t("schemes.checkMine")}</Button>
      </div>
    </Card>
  );
}

/** Refresh control: bypasses the 30 s TTL but never sends more than one request per 10 s. */
export function RefreshSchemes({ refresh, refreshIn, loading, fetchedAt }: { refresh: () => void; refreshIn: number; loading: boolean; fetchedAt: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const waitS = Math.ceil(refreshIn / 1000);
  return (
    <div className="scheme-refresh">
      {fetchedAt > 0 && <small>{t("schemes.updatedAt", { time: new Date(fetchedAt).toLocaleTimeString(i18n.lang === "hi" ? "hi-IN" : "en-IN") })}</small>}
      <Button variant="secondary" icon="refresh" disabled={loading || refreshIn > 0} onClick={refresh}>
        {loading ? t("common.loading") : refreshIn > 0 ? t("schemes.refreshWait", { s: waitS }) : t("schemes.refresh")}
      </Button>
    </div>
  );
}

export default function SchemesScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { schemes, error, loading, fetchedAt, refresh, refreshIn } = useSchemeList();
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => (schemes ? [...schemes].sort((a, b) => a.scheme_name.localeCompare(b.scheme_name)) : null), [schemes]);
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!sorted || !q) return sorted;
    return sorted.filter((s) => s.scheme_name.toLocaleLowerCase().includes(q) || s.scheme_code.toLocaleLowerCase().includes(q));
  }, [sorted, query]);

  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={t("schemes.eyebrow")}
        title={t("schemes.title")}
        description={t("schemes.description")}
        action={<RefreshSchemes refresh={refresh} refreshIn={refreshIn} loading={loading} fetchedAt={fetchedAt} />}
      />
      <ErrorNote error={error} />
      {!sorted && !error && <p>{t("common.loading")}</p>}
      {!sorted && error ? <div className="scheme-refresh"><Button variant="secondary" icon="refresh" disabled={loading || refreshIn > 0} onClick={refresh}>{refreshIn > 0 ? t("schemes.refreshWait", { s: Math.ceil(refreshIn / 1000) }) : t("common.retry")}</Button></div> : null}
      {sorted && (
        <>
          <div className="scheme-toolbar">
            <label>{t("schemes.search")}
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("schemes.searchPlaceholder")} />
            </label>
            <strong aria-live="polite">{t("schemes.count", { n: shown?.length ?? 0 })}</strong>
          </div>
          {sorted.length === 0 && <Card className="scheme-card"><Icon name="document" /><h3>{t("schemes.emptyTitle")}</h3><p>{t("schemes.emptyText")}</p></Card>}
          {sorted.length > 0 && shown?.length === 0 && <Card className="scheme-card"><Icon name="search" /><h3>{t("schemes.noMatchTitle")}</h3><p>{t("schemes.noMatchText", { q: query.trim() })}</p></Card>}
          <div className="scheme-grid">
            {shown?.map((s) => <SchemeCard key={s.scheme_version_id} scheme={s} />)}
          </div>
          <p className="scheme-note">{t("schemes.englishOnly")}</p>
        </>
      )}
    </main>
  );
}
