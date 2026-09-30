import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { EligibilityCheck, SchemeResult } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { categoryLabel } from "../i18n/labels";
import { allResults, incomeLimit, optionsFor, useSchemeCatalogue, useSchemeList } from "../schemes";
import { SchemeCard } from "./Schemes";
import { Button, Card, ErrorNote, Icon, Tag, type Tone } from "../ui";

const OUTCOME_TONE: Record<string, Tone> = { ELIGIBLE: "green", INELIGIBLE: "red", INDETERMINATE: "amber" };

export default function LandingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const preselected = params.get("scheme");
  const { schemes: browse, error: browseError } = useSchemeList();
  const i18n = useI18n();
  const { t, tk, formatNumber } = i18n;
  const { status } = useAuth();
  const { schemes, error: loadError, retry } = useSchemeCatalogue();
  const [category, setCategory] = useState("");
  const [income, setIncome] = useState("");
  const [level, setLevel] = useState("");
  const [check, setCheck] = useState<EligibilityCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (location.hash === "#checker" || preselected) document.getElementById("checker")?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, preselected]);

  const categories = useMemo(() => optionsFor(schemes ?? [], "category"), [schemes]);
  const levels = useMemo(() => optionsFor(schemes ?? [], "education_level"), [schemes]);
  const results = useMemo(() => {
    const byCode = new Map<string, SchemeResult>();
    if (check) for (const r of allResults(check)) byCode.set(r.scheme_code, r);
    return byCode;
  }, [check]);

  const runCheck = async () => {
    const applicant: Record<string, unknown> = {};
    if (category) applicant.category = category;
    if (income) applicant.family_income_annual = Number(income);
    if (level) applicant.education_level = level;
    setChecking(true);
    setError(null);
    try {
      setCheck(await ep.checkEligibility(applicant));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  // Schemes the check evaluated that GET /schemes does not list: shown, never hidden (docs/FRONTEND_FINDINGS.md).
  const unlisted = check && schemes ? allResults(check).filter((r) => !schemes.some((s) => s.code === r.scheme_code)) : [];
  const eligibleCount = check?.eligible.length ?? 0;
  const failed = check?.not_eligible ?? [];
  const title = !check
    ? t("checker.resultsIdle")
    : eligibleCount > 0
      ? t("checker.resultsEligible", { count: eligibleCount })
      : check.indeterminate.length > 0
        ? t("checker.resultsMore")
        : t("checker.resultsNone");
  const ruleText = (r: SchemeResult, rule: { rule_id: string; message_key: string | null; explanation: string }) => {
    const limit = incomeLimit(schemes?.find((s) => s.code === r.scheme_code)?.form ?? null);
    const vars = { scheme: r.scheme_name, income: income ? `₹${formatNumber(Number(income))}` : "", limit: limit !== null ? `₹${formatNumber(limit)}` : "" };
    return rule.message_key ? tk(`rule.${rule.message_key}`, rule.explanation, vars) : rule.explanation;
  };

  return (
    <div className="landing-page">
      <section className="vidya-hero">
        <div className="vidya-overlay" />
        <div className="vidya-content">
          <div className="vidya-title">
            <h1>{t("brand.name")}</h1>
            <span>{t("landing.badge")}</span>
          </div>
          <p>{t("landing.intro1")}<br />{t("landing.intro2")}<br />{t("landing.intro3")}</p>
          <div className="feature-strip">
            <div><span><Icon name="search" /></span><div><strong>{t("landing.f1Title")}</strong><small>{t("landing.f1Text")}</small></div></div>
            <div><span><Icon name="shield" /></span><div><strong>{t("landing.f2Title")}</strong><small>{t("landing.f2Text")}</small></div></div>
            <div><span><Icon name="arrow" /></span><div><strong>{t("landing.f3Title")}</strong><small>{t("landing.f3Text")}</small></div></div>
            <div><span><Icon name="user" /></span><div><strong>{t("landing.f4Title")}</strong><small>{t("landing.f4Text")}</small></div></div>
          </div>
          <div className="hero-quote">{t("landing.quote1")}<br /><span>{t("landing.quote2")}</span><br />{t("landing.quote3")}</div>
        </div>
      </section>

      <main className="vidya-checker" id="checker">
        <div className="vidya-checker-grid">
          <Card className="vidya-form">
            <div className="vidya-card-title"><span><Icon name="document" /></span><h2>{t("checker.title")}</h2></div>
            <label>{t("field.category")}
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">{t("common.notStated")}</option>
                {categories.map((c) => <option key={c} value={c}>{categoryLabel(i18n, c)}</option>)}
              </select>
            </label>
            <label><span className="field-icon">₹</span> {t("field.annualIncome")}
              <input value={income} onChange={(event) => setIncome(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("checker.incomePlaceholder")} />
            </label>
            <label><Icon name="document" size={17} /> {t("checker.level")}
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="">{t("common.notStated")}</option>
                {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <Button onClick={() => runCheck()} disabled={checking || !schemes}>{checking ? t("common.pleaseWait") : t("header.checkEligibility")}</Button>
          </Card>

          <Card className="vidya-results">
            <div className="vidya-result-title">
              <span><Icon name={check && eligibleCount === 0 ? "warning" : "check"} /></span>
              <div><h2>{title}</h2><small>{check ? t("checker.basedOn") : t("checker.hint")}</small></div>
            </div>
            <ErrorNote error={loadError || error} />
            {loadError ? <div className="view-schemes"><Button variant="secondary" onClick={retry}>{t("common.retry")}</Button></div> : null}
            {!schemes && !loadError && <p>{t("common.loading")}</p>}
            {schemes && schemes.length === 0 && <p>{t("common.empty")}</p>}
            {schemes && schemes.length > 0 && (
              <div className="scheme-table">
                <div className="scheme-header"><strong>{t("checker.colScheme")}</strong><strong>{t("checker.colRule")}</strong><strong>{t("checker.colStatus")}</strong></div>
                {[...schemes].sort((a, b) => Number(b.code === preselected) - Number(a.code === preselected)).map((s) => {
                  const r = results.get(s.code);
                  const limit = incomeLimit(s.form);
                  return (
                    <div key={s.versionId}>
                      <div><strong>{s.name}</strong><small>{t("checker.version", { code: s.code, version: s.version })}</small>{s.code === preselected && <Tag tone="blue">{t("checker.selectedScheme")}</Tag>}</div>
                      <div><span>{limit !== null ? t("checker.incomeLimit", { limit: `₹${formatNumber(limit)}` }) : t("checker.noIncomeLimit")}</span><small>{t("checker.fieldCount", { count: s.form?.fields.length ?? 0 })}</small></div>
                      {r ? <Tag tone={OUTCOME_TONE[r.outcome] ?? "gray"}><Icon name={r.outcome === "ELIGIBLE" ? "check" : "warning"} /> {tk(`outcome.${r.outcome}`, r.outcome)}</Tag> : <Tag tone="gray">{t("checker.notChecked")}</Tag>}
                    </div>
                  );
                })}
                {unlisted.map((r) => (
                  <div key={r.scheme_version_id}>
                    <div><strong>{r.scheme_name}</strong><small>{t("checker.version", { code: r.scheme_code, version: r.version_no })}</small></div>
                    <div><span>{t("common.notAvailable")}</span><small>{t("checker.notInList")}</small></div>
                    <Tag tone={OUTCOME_TONE[r.outcome] ?? "gray"}><Icon name={r.outcome === "ELIGIBLE" ? "check" : "warning"} /> {tk(`outcome.${r.outcome}`, r.outcome)}</Tag>
                  </div>
                ))}
              </div>
            )}
            {failed.map((r) => (
              <div className="vidya-explain" key={r.scheme_version_id}><Icon name="warning" /><p><span className="fg-inline-bold">{r.scheme_name}:</span> {r.failed_rules.map((f) => ruleText(r, f)).join(" ")}</p></div>
            ))}
            <div className="view-schemes">
              <Button variant="secondary" onClick={() => navigate(status === "signed-in" ? "/apply" : "/register")}>{status === "signed-in" ? t("checker.toApply") : t("checker.toRegister")} <Icon name="arrow" /></Button>
            </div>
          </Card>
        </div>
      </main>
      <section className="landing-main landing-browse" aria-labelledby="browse-title">
        <div className="section-intro">
          <span className="eyebrow">{t("schemes.eyebrow")}</span>
          <h2 id="browse-title">{t("landing.browseTitle")}</h2>
          <p>{t("landing.browseText")}</p>
        </div>
        <ErrorNote error={browse ? null : browseError} />
        {!browse && !browseError && <p>{t("common.loading")}</p>}
        {browse && browse.length === 0 && <p>{t("schemes.emptyText")}</p>}
        {browse && browse.length > 0 && (
          <div className="scheme-grid">
            {[...browse].sort((a, b) => a.scheme_name.localeCompare(b.scheme_name)).slice(0, 6).map((s) => <SchemeCard key={s.scheme_version_id} scheme={s} />)}
          </div>
        )}
        <div className="view-schemes"><Link to="/schemes" className="btn btn-secondary">{t("landing.viewAll", { n: browse?.length ?? 0 })} <Icon name="arrow" /></Link></div>
      </section>
      <section className="vidya-metrics" aria-label={t("landing.factsLabel")}>
        <div><span><Icon name="document" /></span><div><strong>{t("landing.m1Title")}</strong><small>{t("landing.m1Text")}</small></div></div>
        <div><span><Icon name="upload" /></span><div><strong>{t("landing.m2Title")}</strong><small>{t("landing.m2Text")}</small></div></div>
        <div><span><Icon name="shield" /></span><div><strong>{t("landing.m3Title")}</strong><small>{t("landing.m3Text")}</small></div></div>
        <div><span><Icon name="search" /></span><div><strong>{t("landing.m4Title")}</strong><small>{t("landing.m4Text")}</small></div></div>
      </section>
    </div>
  );
}
