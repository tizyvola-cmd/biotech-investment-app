import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { ViewErrorFallback } from "./ViewErrorFallback";
import { reportUiError } from "../sheet/reportUiError";

type Props = {
  label?: string;
  /** When true, show raw exception text (owner/admin only). */
  showTechnicalDetail?: boolean;
  children: ReactNode;
};

type State = { error: Error | null; recoveries: number };

const MAX_DOM_RECOVERIES = 6;

function isBenignDomReconcile(error: Error): boolean {
  return /removeChild|insertBefore|not a child of this node|NotFoundError/i.test(
    error.message || String(error),
  );
}

function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|failed to fetch.*investSim|Importing a module script failed|error loading dynamically imported module/i.test(
    error.message || "",
  );
}

/** Catches render errors so one broken panel does not blank the whole app. */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recoveries: 0 };
  private recoverTimer: number | null = null;
  private reportedRecoveryKey: string | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ViewErrorBoundary]", this.props.label ?? "view", error, info.componentStack);
    const recovering =
      isBenignDomReconcile(error) && this.state.recoveries < MAX_DOM_RECOVERIES;
    // Avoid flooding Access: one report for a reconcile storm, another if we give up.
    const reportKey = `${this.props.label ?? "view"}|${(error.message || "").slice(0, 80)}`;
    if (!recovering || this.reportedRecoveryKey !== reportKey) {
      this.reportedRecoveryKey = recovering ? reportKey : null;
      reportUiError({
        label: this.props.label ?? "view",
        message: error.message || String(error),
        stack: `${error.stack || ""}\n${info.componentStack || ""}`,
        source: "boundary",
        problem: recovering ? "dom_reconcile_recovered" : undefined,
      });
    }

    // Recharts / React DOM portal races: remount after the failed commit finishes.
    if (recovering) {
      if (this.recoverTimer != null) window.clearTimeout(this.recoverTimer);
      this.recoverTimer = window.setTimeout(() => {
        this.recoverTimer = null;
        this.setState((s) => ({ error: null, recoveries: s.recoveries + 1 }));
      }, 32);
    }
  }

  componentWillUnmount() {
    if (this.recoverTimer != null) window.clearTimeout(this.recoverTimer);
  }

  render() {
    if (this.state.error) {
      const recovering =
        isBenignDomReconcile(this.state.error) &&
        this.state.recoveries < MAX_DOM_RECOVERIES;
      if (recovering) {
        // Brief blank while we remount — avoids re-throw loops and red walls for testers.
        return (
          <div
            className="flex-1 min-h-[120px]"
            aria-busy="true"
            aria-label="Loading"
            key={`recover-${this.state.recoveries}`}
          />
        );
      }
      const chunkLoad = isChunkLoadError(this.state.error);
      return (
        <ViewErrorFallback
          label={this.props.label}
          message={this.state.error.message}
          chunkLoad={chunkLoad}
          showTechnicalDetail={this.props.showTechnicalDetail === true}
          onRetry={() => {
            if (chunkLoad && typeof window !== "undefined") {
              const u = new URL(window.location.href);
              u.searchParams.set("_sn", String(Date.now()));
              window.location.replace(u.toString());
              return;
            }
            this.reportedRecoveryKey = null;
            this.setState({ error: null, recoveries: 0 });
          }}
        />
      );
    }
    // Remount children after DOM recoveries so chart hosts get a clean tree.
    return <Fragment key={`veb-${this.state.recoveries}`}>{this.props.children}</Fragment>;
  }
}
