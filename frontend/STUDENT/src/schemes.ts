import { useEffect, useState } from "react";
import * as ep from "./api/endpoints";
import type { EligibilityCheck, FormSchema, SchemeResult } from "./api/responses";

/**
 * The schemes an applicant can see: the public GET /schemes list (active
 * scheme versions, ordered by code), plus each version's public form schema
 * for its fields, options, limits and document checklist. Loaded once per
 * page load and kept in memory (the routes are throttled per IP). No scheme
 * is filtered out here.
 */
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

let cache: Promise<SchemeEntry[]> | null = null;

async function loadCatalogue(): Promise<SchemeEntry[]> {
  const { schemes } = await ep.listSchemes();
  const forms = await Promise.all(schemes.map((s) => ep.getFormSchema(s.scheme_code, s.version_no).catch(() => null)));
  return schemes.map((s, i) => ({
    code: s.scheme_code,
    name: s.scheme_name,
    version: s.version_no,
    versionId: s.scheme_version_id,
    effectiveFrom: s.effective_from,
    effectiveTo: s.effective_to,
    form: forms[i],
  }));
}

export function useSchemeCatalogue() {
  const [schemes, setSchemes] = useState<SchemeEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!cache) cache = loadCatalogue();
    cache.then(
      (s) => live && setSchemes(s),
      (e) => {
        cache = null;
        if (live) setError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };
  return { schemes, error, retry };
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
