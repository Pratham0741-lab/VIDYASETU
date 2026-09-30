import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as ep from "../api/endpoints";
import type { RegisterDto } from "../api/types";
import { NotApplicantError, useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { Button, Card, ErrorNote, Icon, InfoNote, ScreenTitle } from "../ui";

type Form = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  category: RegisterDto["category"];
  gender: "" | NonNullable<RegisterDto["gender"]>;
  dob: string;
  phone: string;
  domicile_state: string;
  domicile_district: string;
  annual_income: string;
  caste_cert_number: string;
  bank_account: string;
  is_disabled: boolean;
  disability_percentage: string;
};

const EMPTY: Form = {
  email: "",
  password: "",
  first_name: "",
  last_name: "",
  category: "ST",
  gender: "",
  dob: "",
  phone: "",
  domicile_state: "",
  domicile_district: "",
  annual_income: "",
  caste_cert_number: "",
  bank_account: "",
  is_disabled: false,
  disability_percentage: "",
};

export default function RegisterScreen() {
  const { t, lang } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const dto: RegisterDto = {
      email: form.email.trim(),
      password: form.password,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      category: form.category,
      domicile_state: form.domicile_state.trim(),
      caste_cert_number: form.caste_cert_number.trim(),
      annual_income: Number(form.annual_income || 0).toFixed(2),
      bank_account: form.bank_account.trim(),
      preferred_language: lang,
      ...(form.domicile_district.trim() ? { domicile_district: form.domicile_district.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.gender ? { gender: form.gender } : {}),
      ...(form.dob ? { dob: form.dob } : {}),
      ...(form.is_disabled ? { is_disabled: true, disability_percentage: Number(form.disability_percentage || 0) } : {}),
    };
    try {
      await ep.register(dto);
      await login(dto.email, dto.password);
      setForm(EMPTY);
      navigate("/consent", { replace: true });
    } catch (e) {
      set("password", "");
      setError(e instanceof NotApplicantError ? null : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-page">
      <ScreenTitle eyebrow={t("register.eyebrow")} title={t("register.title")} description={t("register.description")} />
      <div className="content-sidebar">
        <Card>
          <div className="card-heading"><div><h2>{t("register.heading")}</h2><p>{t("register.subheading")}</p></div></div>
          <InfoNote title={t("register.recordedTitle")} text={t("register.recordedText")} />
          <ErrorNote error={error} />
          <form onSubmit={submit}>
            <div className="type-control-row">
              <label>{t("field.firstName")}<input required autoComplete="given-name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></label>
              <label>{t("field.lastName")}<input required autoComplete="family-name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></label>
            </div>
            <div className="type-control-row">
              <label>{t("field.email")}<input type="email" required autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
              <label>{t("field.newPassword")}<span>{t("field.passwordHint")}</span><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} /></label>
            </div>
            <div className="type-control-row">
              <label>{t("field.category")}
                <select value={form.category} onChange={(e) => set("category", e.target.value as Form["category"])}>
                  <option value="ST">{t("category.ST")}</option>
                  <option value="PVTG">{t("category.PVTG")}</option>
                </select>
              </label>
              <label>{t("field.gender")}<span>{t("common.optional")}</span>
                <select value={form.gender} onChange={(e) => set("gender", e.target.value as Form["gender"])}>
                  <option value="">{t("common.notStated")}</option>
                  <option value="FEMALE">{t("gender.FEMALE")}</option>
                  <option value="MALE">{t("gender.MALE")}</option>
                  <option value="OTHER">{t("gender.OTHER")}</option>
                </select>
              </label>
            </div>
            <div className="type-control-row">
              <label>{t("field.dob")}<span>{t("common.optional")}</span><input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></label>
              <label>{t("field.phone")}<span>{t("common.optional")}</span><input type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d+]/g, ""))} /></label>
            </div>
            <div className="type-control-row">
              <label>{t("field.domicileState")}<input required value={form.domicile_state} onChange={(e) => set("domicile_state", e.target.value)} /></label>
              <label>{t("field.domicileDistrict")}<span>{t("common.optional")}</span><input value={form.domicile_district} onChange={(e) => set("domicile_district", e.target.value)} /></label>
            </div>
            <div className="type-control-row">
              <label>{t("field.annualIncome")}<input required inputMode="numeric" value={form.annual_income} onChange={(e) => set("annual_income", e.target.value.replace(/\D/g, ""))} /></label>
              <label>{t("field.casteCert")}<input required value={form.caste_cert_number} onChange={(e) => set("caste_cert_number", e.target.value)} /></label>
            </div>
            <label>{t("field.bankAccount")}<input required autoComplete="off" value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} /></label>
            <div className="type-control-row">
              <label>{t("field.isDisabled")}
                <select value={form.is_disabled ? "yes" : "no"} onChange={(e) => set("is_disabled", e.target.value === "yes")}>
                  <option value="no">{t("common.no")}</option>
                  <option value="yes">{t("common.yes")}</option>
                </select>
              </label>
              {form.is_disabled && <label>{t("field.disabilityPct")}<input type="number" min={0} max={100} value={form.disability_percentage} onChange={(e) => set("disability_percentage", e.target.value)} /></label>}
            </div>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => navigate("/login")}>{t("register.toLogin")}</Button>
              <Button type="submit" disabled={busy}>{busy ? t("common.pleaseWait") : t("register.submit")} <Icon name="arrow" /></Button>
            </div>
          </form>
        </Card>
        <aside>
          <Card className="tip-card"><Icon name="document" /><h3>{t("register.tipTitle")}</h3><ul><li>{t("register.tip1")}</li><li>{t("register.tip2")}</li><li>{t("register.tip3")}</li></ul></Card>
        </aside>
      </div>
    </main>
  );
}
