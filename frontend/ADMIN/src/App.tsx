import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { can, modulesFor, type Permission } from "./auth/permissions";
import { I18nProvider, useI18n } from "./i18n";
import AppShell from "./layout";
import LoginScreen from "./screens/Login";
import AnalyticsScreen from "./screens/Analytics";
import AuditInspector from "./screens/Audit";
import SchemeStudio from "./screens/SchemeStudio";
import FraudPanel from "./screens/Fraud";
import ScrutinyWorkspace from "./screens/Scrutiny";
import SelectionDashboard from "./screens/Selection";

/**
 * Signed-in routes. While the session is being restored (page refresh) the
 * guard waits instead of redirecting, so a refresh keeps the officer on the
 * same screen.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, signOutReason } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (status === "loading") return <div className="login-page"><p className="muted">{t("auth.checking")}</p></div>;
  // Only an expired session (or a first visit) returns to the same screen; an explicit logout starts fresh.
  if (status !== "signed-in") return <Navigate to="/login" replace state={signOutReason === null && location.key !== "default" ? undefined : { from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** A module route: roles without its permission go to their first module. */
function RequireModule({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { me } = useAuth();
  if (!can(me?.role, permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const { me } = useAuth();
  const first = modulesFor(me?.role)[0];
  return first ? <Navigate to={`/${first}`} replace /> : null;
}

function AnonymousOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (status === "signed-in") return <Navigate to={from} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="login" element={<AnonymousOnly><LoginScreen /></AnonymousOnly>} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="scrutiny" element={<RequireModule permission="module.scrutiny"><ScrutinyWorkspace /></RequireModule>} />
              <Route path="fraud" element={<RequireModule permission="module.fraud"><FraudPanel /></RequireModule>} />
              <Route path="selection" element={<RequireModule permission="module.selection"><SelectionDashboard /></RequireModule>} />
              <Route path="audit" element={<RequireModule permission="module.audit"><AuditInspector /></RequireModule>} />
              <Route path="studio" element={<RequireModule permission="module.studio"><SchemeStudio /></RequireModule>} />
              <Route path="analytics" element={<RequireModule permission="module.analytics"><AnalyticsScreen /></RequireModule>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
