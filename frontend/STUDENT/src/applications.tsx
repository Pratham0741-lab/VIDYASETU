import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as ep from "./api/endpoints";
import type { Application } from "./api/responses";
import { useI18n } from "./i18n";

/**
 * The signed-in applicant's applications (GET /applications, newest first)
 * and the one the screen is about: `?app=<id>` in the URL, else the newest.
 */
export function useMyApplications() {
  const [params, setParams] = useSearchParams();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setApps(await ep.listApplications());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const wanted = params.get("app");
  const selected = apps ? (apps.find((a) => a.id === wanted) ?? apps[0] ?? null) : null;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("app", id);
    setParams(next, { replace: true });
  };
  return { apps, selected, select, error, reload };
}

/** A selector shown only when the applicant has more than one application. */
export function ApplicationPicker({ apps, selected, onSelect }: { apps: Application[] | null; selected: Application | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  if (!apps || apps.length < 2 || !selected) return null;
  return (
    <label className="app-picker">{t("apps.pick")}
      <select value={selected.id} onChange={(e) => onSelect(e.target.value)}>
        {apps.map((a) => <option key={a.id} value={a.id}>{a.application_no} · {a.academic_year}</option>)}
      </select>
    </label>
  );
}
