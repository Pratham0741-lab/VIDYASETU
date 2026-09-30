import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "./i18n";
import { Button, Icon } from "./ui";

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="app-page">
      <div className="alert-danger" role="alert">
        <Icon name="warning" />
        <div><strong>{t("common.renderErrorTitle")}</strong><p>{t("common.renderErrorText")}</p></div>
      </div>
      <Button variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>
    </main>
  );
}

/** Catches render errors of one screen so the shell (header, navigation) stays usable. Logs nothing. */
class Boundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally silent: error text may contain personal data, so nothing is logged.
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <Fallback onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}

/** Resets automatically when the route changes. */
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
