import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FormField } from "../api/responses";
import { useAuth } from "../auth/AuthProvider";
import { useI18n, type MessageKey } from "../i18n";
import { humanise } from "../i18n/labels";
import { APPLICATION_FIELDS, PROFILE_FIELDS, useFormSchema, useSchemeList } from "../schemes";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle, Tag } from "../ui";
import { schemeDates } from "./Schemes";

type Group = { key: MessageKey; hint: MessageKey; fields: FormField[] };

/** One field as returned by the form schema: label, allowed options, limits (values only). */
function FieldRow({ field }: { field: FormField }) {
  const { t, tk, formatNumber } = useI18n();
  const limits = field.limits.map((l) => (typeof l.value === "number" ? formatNumber(l.value) : String(l.value)));
  return (
    <div className="check-row">
      <span className="rule-check"><Icon name="check" /></span>
      <div>
        <small>{field.key}</small>
        <strong>{tk(`formField.${field.key}`, humanise(field.key))}</strong>
        {field.options.length > 0 && <small>{t("detail.options", { options: field.options.map(String).join(" · ") })}</small>}
      </div>
      <div>{limits.length > 0 ? <Tag tone="blue">{t("detail.limit", { values: limits.join(" / ") })}</Tag> : null}</div>
    </div>
  );
}

export default function SchemeDetailScreen() {
  const i18n = useI18n();
  const { t, tk } = i18n;
  const navigate = useNavigate();
  const { status } = useAuth();
  const { code = "" } = useParams();
  const { schemes, error: listError, loading, refresh, refreshIn } = useSchemeList();
  const scheme = schemes?.find((s) => s.scheme_code === code) ?? null;
  const { form, error: formError, retry } = useFormSchema(scheme);

  const groups = useMemo<Group[]>(() => {
    const fields = form?.fields ?? [];
    return [
      { key: "detail.groupProfile", hint: "detail.groupProfileHint", fields: fields.filter((f) => PROFILE_FIELDS.has(f.key)) },
      { key: "detail.groupApplication", hint: "detail.groupApplicationHint", fields: fields.filter((f) => APPLICATION_FIELDS.has(f.key)) },
      { key: "detail.groupScheme", hint: "detail.groupSchemeHint", fields: fields.filter((f) => !PROFILE_FIELDS.has(f.key) && !APPLICATION_FIELDS.has(f.key)) },
    ];
  }, [form]);

  const enc = encodeURIComponent(code);
  const apply = () => {
    const target = `/apply?new=1&scheme=${enc}`;
    if (status === "signed-in") navigate(target);
    else navigate("/login", { state: { from: target } });
  };
  const back = <Link to="/schemes" className="btn btn-secondary">{t("detail.back")}</Link>;

  // The list is still loading (or failed before any list arrived).
  if (!schemes) {
    return (
      <main className="app-page">
        <ScreenTitle eyebrow={t("schemes.eyebrow")} title={t("detail.loadingTitle")} description={code} action={back} />
        <ErrorNote error={listError} />
        {listError ? <Button variant="secondary" icon="refresh" disabled={loading || refreshIn > 0} onClick={refresh}>{t("common.retry")}</Button> : <p>{t("common.loading")}</p>}
      </main>
    );
  }

  // Unknown or no longer active code.
  if (!scheme) {
    return (
      <main className="app-page">
        <ScreenTitle eyebrow={t("schemes.eyebrow")} title={t("detail.notFoundTitle")} description={t("detail.notFoundText", { code })} action={back} />
        <Card className="scheme-card"><Icon name="search" /><h3>{t("detail.notFoundHint")}</h3><div className="scheme-card-actions"><Button onClick={() => navigate("/schemes")}>{t("detail.allSchemes")}</Button></div></Card>
      </main>
    );
  }

  const required = form?.documents.required_documents ?? [];
  const ruleDocs = form?.documents.rule_doc_refs ?? [];
  return (
    <main className="app-page">
      <ScreenTitle
        eyebrow={`${t("schemes.eyebrow")} · ${scheme.scheme_code}`}
        title={scheme.scheme_name}
        description={`${t("schemes.version", { n: scheme.version_no })} · ${schemeDates(scheme, i18n)}`}
        action={back}
      />
      <div className="scheme-card-actions detail-actions">
        <Button variant="secondary" onClick={() => navigate(`/?scheme=${enc}#checker`)}>{t("detail.checkThis")}</Button>
        <Button onClick={apply}>{t("detail.apply")} <Icon name="arrow" /></Button>
      </div>
      <ErrorNote error={formError} />
      {formError ? <Button variant="secondary" icon="refresh" onClick={retry}>{t("common.retry")}</Button> : null}
      {!form && !formError && <p>{t("common.loading")}</p>}
      {form && (
        <div className="verification-grid">
          <Card>
            <div className="card-heading"><div><span className="eyebrow">{t("detail.fieldsEyebrow")}</span><h2>{t("detail.fieldsTitle")}</h2><p>{t("detail.fieldsText")}</p></div></div>
            {form.fields.length === 0 && <p>{t("detail.noFields")}</p>}
            {groups.filter((g) => g.fields.length > 0).map((g) => (
              <div key={g.key} className="detail-group">
                <h3>{t(g.key)}</h3>
                <p>{t(g.hint)}</p>
                <div className="check-table">{g.fields.map((f) => <FieldRow key={f.key} field={f} />)}</div>
              </div>
            ))}
            <div className="human-note"><Icon name="shield" /><div><strong>{t("detail.eligibilityTitle")}</strong><p>{t("detail.eligibilityText")}</p></div></div>
          </Card>
          <Card className="documents-card">
            <h3>{t("detail.docsTitle")}</h3>
            {required.length === 0 && ruleDocs.length === 0 && <p>{t("detail.noDocs")}</p>}
            {required.map((d) => (
              <div className="doc-row" key={d}><Icon name="document" /><div><strong>{d}</strong><small>{t("detail.requiredDoc")}</small></div><Tag tone="amber">{t("detail.required")}</Tag></div>
            ))}
            {ruleDocs.length > 0 && <p className="scheme-note">{t("detail.ruleDocsIntro")}</p>}
            {ruleDocs.map((d) => (
              <div className="doc-row" key={d.doc_ref}><Icon name="document" /><div><strong>{tk(`slot.${d.doc_ref}`, humanise(d.doc_ref))}</strong><small>{t("detail.usedBy", { rules: d.rule_ids.join(", ") })}</small></div></div>
            ))}
            <p className="scheme-note">{t("schemes.englishOnly")}</p>
          </Card>
        </div>
      )}
      {form && form.unparseable_rules.length > 0 && <InfoNote icon="warning" title={t("detail.unparseable", { n: form.unparseable_rules.length })} />}
    </main>
  );
}
