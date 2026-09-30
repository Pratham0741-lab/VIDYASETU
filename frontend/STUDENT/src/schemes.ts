import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as ep from "./api/endpoints";
import type { ActiveScheme, EligibilityCheck, FormSchema, SchemeResult } from "./api/responses";

/**
 * The public scheme list (GET /schemes) and each version's public form schema.
 *
 * List: kept in memory for LIST_TTL_MS; opening the landing page or the
 * Schemes section refetches it once the TTL has passed, and refresh()
 * bypasses the TTL. Never more than one GET /schemes per MIN_INTERVAL_MS
 * (the route allows 60 per minute per IP). When several active versions of
 * one scheme_code are returned, only the highest version_no is kept.
 *
 * Form schemas: a published scheme version is immutable, so each is fetched
 * once per page load, keyed by scheme_version_id.
 *
 * Nothing is filtered out besides older versions of the same code.
 */
export const LIST_TTL_MS = 30_000;
export const MIN_INTERVAL_MS = 10_000;

export interface SchemeEntry {
  code: string;
  name: string;
  version: number;
  versionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  form: FormSchema | null;
}

/** All scheme results of one eligibility check, whatever their outcome. */
export function allResults(check: EligibilityCheck): SchemeResult[] {
  return [...check.eligible, ...check.not_eligible, ...check.indeterminate];
}

/** Highest version_no per scheme_code (the API may return several active versions of one code). */
export function latestVersions(schemes: ActiveScheme[]): ActiveScheme[] {
  const best = new Map<string, ActiveScheme>();
  for (const s of schemes) {
    const current = best.get(s.scheme_code);
    if (!current || s.version_no > current.version_no) best.set(s.scheme_code, s);
  }
  return [...best.values()];
}

// ------------------------------------------------------------------ list store
interface ListState {
  schemes: ActiveScheme[] | null;
  error: unknown;
  loading: boolean;
  /** When the current list was fetched (0 = never). */
  fetchedAt: number;
  /** When the last request was sent (0 = never): the 10-second floor. */
  requestedAt: number;
}

let state: ListState = { schemes: null, error: null, loading: false, fetchedAt: 0, requestedAt: 0 };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<ListState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Milliseconds until another GET /schemes may be sent (0 = now). */
export function msUntilAllowed(now = Date.now()): number {
  return state.requestedAt ? Math.max(0, state.requestedAt + MIN_INTERVAL_MS - now) : 0;
}

/**
 * Loads the list when it is missing or older than the TTL (or always, with
 * force), unless a request is already running or the 10-second floor has
 * not passed. Returns without a request in those cases.
 */
export function loadSchemeList(force = false): Promise<void> {
  if (inflight) return inflight;
  const now = Date.now();
  const fresh = state.schemes !== null && now - state.fetchedAt < LIST_TTL_MS;
  if ((fresh && !force) || msUntilAllowed(now) > 0) return Promise.resolve();
  setState({ loading: true, requestedAt: now });
  inflight = ep
    .listSchemes()
    .then(
      (r) => setState({ schemes: latestVersions(r.schemes), error: null, fetchedAt: Date.now() }),
      (e) => setState({ error: e }),
    )
    .finally(() => {
      inflight = null;
      setState({ loading: false });
    });
  return inflight;
}

/**
 * The scheme list for a screen: loads it on mount (TTL rules above) and
 * offers refresh() (bypasses the TTL, keeps the 10-second floor).
 * `refreshIn` is the wait in ms before refresh() may send a request.
 */
export function useSchemeList() {
  const snap = useSyncExternalStore(subscribe, () => state);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void loadSchemeList();
  }, []);
  // Re-render every second while the 10-second floor runs, so a Refresh button can count down and enable itself.
  const wait = msUntilAllowed();
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait, 1000) + 20);
    return () => clearTimeout(id);
  }, [now, wait, snap.requestedAt]);
  const refresh = useCallback(() => {
    void loadSchemeList(true).then(() => setNow(Date.now()));
    setNow(Date.now());
  }, []);
  return { schemes: snap.schemes, error: snap.error, loading: snap.loading, fetchedAt: snap.fetchedAt, refresh, refreshIn: wait };
}

// ------------------------------------------------------------ form schemas
const formCache = new Map<string, Promise<FormSchema | null>>();

/** A version's form schema; one request per scheme_version_id per page load (errors are retried next time). */
export function loadFormSchema(s: Pick<ActiveScheme, "scheme_code" | "version_no" | "scheme_version_id">): Promise<FormSchema | null> {
  let p = formCache.get(s.scheme_version_id);
  if (!p) {
    p = ep.getFormSchema(s.scheme_code, s.version_no).catch(() => {
      formCache.delete(s.scheme_version_id);
      return null;
    });
    formCache.set(s.scheme_version_id, p);
  }
  return p;
}

/** One version's form schema with its own loading and error state (the error keeps the requestId). */
export function useFormSchema(s: Pick<ActiveScheme, "scheme_code" | "version_no" | "scheme_version_id"> | null) {
  const [form, setForm] = useState<FormSchema | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const versionId = s?.scheme_version_id ?? null;
  useEffect(() => {
    setForm(null);
    setError(null);
    if (!s) return;
    let live = true;
    ep.getFormSchema(s.scheme_code, s.version_no).then(
      (f) => {
        if (!live) return;
        formCache.set(s.scheme_version_id, Promise.resolve(f));
        setForm(f);
      },
      (e) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [versionId, attempt]);
  return { form, error, retry: () => setAttempt((n) => n + 1) };
}

/**
 * List plus form schemas: what the landing checker and the application
 * scheme picker need. Keeps the old { schemes, error, retry } shape.
 */
export function useSchemeCatalogue() {
  const { schemes: list, error, refresh } = useSchemeList();
  const [forms, setForms] = useState<Map<string, FormSchema | null> | null>(null);
  useEffect(() => {
    if (!list) return;
    let live = true;
    Promise.all(list.map((s) => loadFormSchema(s).then((f) => [s.scheme_version_id, f] as const))).then((pairs) => {
      if (live) setForms(new Map(pairs));
    });
    return () => {
      live = false;
    };
  }, [list]);
  const schemes = useMemo<SchemeEntry[] | null>(() => {
    if (!list || !forms) return null;
    return [...list]
      .sort((a, b) => a.scheme_name.localeCompare(b.scheme_name))
      .map((s) => ({
        code: s.scheme_code,
        name: s.scheme_name,
        version: s.version_no,
        versionId: s.scheme_version_id,
        effectiveFrom: s.effective_from,
        effectiveTo: s.effective_to,
        form: forms.get(s.scheme_version_id) ?? null,
      }));
  }, [list, forms]);
  // A failed refresh keeps the last good list on screen; the error shows only while there is no list.
  return { schemes, error: list ? null : error, retry: refresh };
}

/** Income limit of a scheme from its form schema (a limit on family_income_annual), if any. */
export function incomeLimit(form: FormSchema | null): number | null {
  const field = form?.fields.find((f) => f.key === "family_income_annual");
  const values = (field?.limits ?? []).map((l) => Number(l.value)).filter((n) => Number.isFinite(n));
  return values.length ? Math.min(...values) : null;
}

/** Distinct options of a profile field across schemes (e.g. category, education_level). */
export function optionsFor(schemes: SchemeEntry[], key: string): string[] {
  const set = new Set<string>();
  for (const s of schemes) for (const f of s.form?.fields ?? []) if (f.key === key) f.options.forEach((o) => set.add(String(o)));
  return [...set];
}
