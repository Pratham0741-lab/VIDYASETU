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
  const { t, tk, formatAmount } = i18n;
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
    const vars = { scheme: r.scheme_name, income: income ? formatAmount(Number(income)) : "", limit: limit !== null ? formatAmount(limit) : "" };
    return rule.message_key ? tk(`rule.${rule.message_key}`, rule.explanation, vars) : rule.explanation;
  };

  return (
    <main className="app-page landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <span className="tag tag-amber">{t("landing.badge")}</span>
        <h1 id="landing-title">{t("brand.name")}</h1>
        <p>{t("landing.intro1")} {t("landing.intro2")} {t("landing.intro3")}</p>
        <ul className="feature-strip">
          {([["search", "landing.f1Title", "landing.f1Text"], ["shield", "landing.f2Title", "landing.f2Text"], ["upload", "landing.f3Title", "landing.f3Text"], ["user", "landing.f4Title", "landing.f4Text"]] as const).map(([icon, title, text]) => (
            <li key={title}><span className="feature-icon"><Icon name={icon} /></span><span><strong>{t(title)}</strong><small>{t(text)}</small></span></li>
          ))}
        </ul>
      </section>

      <section className="checker-grid" id="checker" aria-labelledby="checker-title">
        <Card className="checker-form">
          <div className="card-heading"><h2 id="checker-title">{t("checker.title")}</h2></div>
          <label htmlFor="chk-category">{t("field.category")}</label>
          <select id="chk-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("common.notStated")}</option>
            {categories.map((c) => <option key={c} value={c}>{categoryLabel(i18n, c)}</option>)}
          </select>
          <label htmlFor="chk-income">{t("field.annualIncome")}</label>
          <div className="input-prefix"><span aria-hidden="true">₹</span><input id="chk-income" value={income} onChange={(event) => setIncome(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("checker.incomePlaceholder")} /></div>
          <label htmlFor="chk-level">{t("checker.level")}</label>
          <select id="chk-level" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">{t("common.notStated")}</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Button className="checker-submit" onClick={() => runCheck()} disabled={checking || !schemes}>{checking ? t("common.pleaseWait") : t("header.checkEligibility")}</Button>
        </Card>

        <Card className={`checker-results ${check && eligibleCount > 0 ? "accent-green" : check ? "accent-amber" : ""}`}>
          <div className="card-heading">
            <div><h2 aria-live="polite">{title}</h2><p>{check ? t("checker.basedOn") : t("checker.hint")}</p></div>
          </div>
          <ErrorNote error={loadError || error} />
          {loadError ? <Button variant="secondary" onClick={retry}>{t("common.retry")}</Button> : null}
          {!schemes && !loadError && <p>{t("common.loading")}</p>}
          {schemes && schemes.length === 0 && <p>{t("common.empty")}</p>}
          {schemes && schemes.length > 0 && (
            <ul className="scheme-rows">
              {[...schemes].sort((a, b) => Number(b.code === preselected) - Number(a.code === preselected)).map((s) => {
                const r = results.get(s.code);
                const limit = incomeLimit(s.form);
                return (
                  <li key={s.versionId}>
                    <div><strong>{s.name}</strong><small className="num">{t("checker.version", { code: s.code, version: s.version })}</small>{s.code === preselected && <Tag tone="blue">{t("checker.selectedScheme")}</Tag>}</div>
                    <div className="num"><span>{limit !== null ? t("checker.incomeLimit", { limit: formatAmount(limit) }) : t("checker.noIncomeLimit")}</span><small>{t("checker.fieldCount", { count: s.form?.fields.length ?? 0 })}</small></div>
                    {r ? <Tag tone={OUTCOME_TONE[r.outcome] ?? "gray"}><Icon name={r.outcome === "ELIGIBLE" ? "check" : "warning"} /> {tk(`outcome.${r.outcome}`, r.outcome)}</Tag> : <Tag tone="gray">{t("checker.notChecked")}</Tag>}
                  </li>
                );
              })}
              {unlisted.map((r) => (
                <li key={r.scheme_version_id}>
                  <div><strong>{r.scheme_name}</strong><small className="num">{t("checker.version", { code: r.scheme_code, version: r.version_no })}</small></div>
                  <div><span>{t("common.notAvailable")}</span><small>{t("checker.notInList")}</small></div>
                  <Tag tone={OUTCOME_TONE[r.outcome] ?? "gray"}><Icon name={r.outcome === "ELIGIBLE" ? "check" : "warning"} /> {tk(`outcome.${r.outcome}`, r.outcome)}</Tag>
                </li>
              ))}
            </ul>
          )}
          {failed.map((r) => (
            <div className="alert-warning" key={r.scheme_version_id}><Icon name="warning" /><div><strong>{r.scheme_name}</strong><p>{r.failed_rules.map((f) => ruleText(r, f)).join(" ")}</p></div></div>
          ))}
          <div className="form-actions">
            <Button variant="blue" onClick={() => navigate(status === "signed-in" ? "/apply" : "/register")}>{status === "signed-in" ? t("checker.toApply") : t("checker.toRegister")} <Icon name="arrow" /></Button>
          </div>
        </Card>
      </section>

      <section className="landing-browse" aria-labelledby="browse-title">
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
        <div className="view-all"><Link to="/schemes" className="btn btn-secondary">{t("landing.viewAll", { n: browse?.length ?? 0 })} <Icon name="arrow" /></Link></div>
      </section>

      <section className="card-grid landing-facts" aria-label={t("landing.factsLabel")}>
        {([["document", "landing.m1Title", "landing.m1Text", ""], ["upload", "landing.m2Title", "landing.m2Text", "accent-green"], ["shield", "landing.m3Title", "landing.m3Text", "accent-amber"], ["search", "landing.m4Title", "landing.m4Text", ""]] as const).map(([icon, title, text, accent]) => (
          <Card className={`info-card ${accent}`} key={title}><span className="info-icon"><Icon name={icon} size={24} /></span><div><h3>{t(title)}</h3><p className="muted">{t(text)}</p></div></Card>
        ))}
      </section>
    </main>
  );
}
