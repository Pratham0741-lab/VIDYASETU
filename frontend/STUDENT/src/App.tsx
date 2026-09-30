import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { I18nProvider, useI18n } from "./i18n";
import Shell from "./layout";
import ApplicationScreen from "./screens/Apply";
import ConsentScreen from "./screens/Consent";
import DashboardScreen from "./screens/Dashboard";
import DeficiencyScreen from "./screens/Deficiencies";
import LandingScreen from "./screens/Landing";
import LoginScreen from "./screens/Login";
import RegisterScreen from "./screens/Register";
import SchemeDetailScreen from "./screens/SchemeDetail";
import SchemesScreen from "./screens/Schemes";
import MeritScreen from "./screens/Result";

/**
 * Signed-in routes. While the session is being restored (page refresh) the
 * guard waits instead of redirecting, so a refresh keeps the user on the
 * same screen.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (status === "loading") return <main className="app-page"><p>{t("auth.checking")}</p></main>;
  if (status !== "signed-in") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Login and register are for signed-out visitors only. */
function AnonymousOnly({ children, next = "/dashboard" }: { children: ReactNode; next?: string }) {
  const { status } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? next;
  if (status === "signed-in") return <Navigate to={from} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<LandingScreen />} />
              <Route path="schemes" element={<SchemesScreen />} />
              <Route path="schemes/:code" element={<SchemeDetailScreen />} />
              <Route path="login" element={<AnonymousOnly><LoginScreen /></AnonymousOnly>} />
              <Route path="register" element={<AnonymousOnly next="/consent"><RegisterScreen /></AnonymousOnly>} />
              <Route path="consent" element={<RequireAuth><ConsentScreen /></RequireAuth>} />
              <Route path="apply" element={<RequireAuth><ApplicationScreen /></RequireAuth>} />
              <Route path="dashboard" element={<RequireAuth><DashboardScreen /></RequireAuth>} />
              <Route path="deficiencies" element={<RequireAuth><DeficiencyScreen /></RequireAuth>} />
              <Route path="result" element={<RequireAuth><MeritScreen /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
