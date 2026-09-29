/**
 * Remount host for Recharts (and similar SVG charts) that can throw
 * NotFoundError removeChild/insertBefore during React DOM reconcile.
 * Isolates the failure so the surrounding desk stays usable.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  label?: string;
  children: ReactNode;
  className?: string;
  /** Max automatic remounts before showing a tiny retry chip. */
  maxRemounts?: number;
};

type State = { error: Error | null; remounts: number; mountKey: number };

function isDomReconcileError(error: Error): boolean {
  return /removeChild|insertBefore|not a child of this node|NotFoundError/i.test(
    error.message || String(error),
  );
}

export class SafeRechartsMount extends Component<Props, State> {
  state: State = { error: null, remounts: 0, mountKey: 0 };
  private timer: number | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const max = this.props.maxRemounts ?? 4;
    if (isDomReconcileError(error) && this.state.remounts < max) {
      if (this.timer != null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.setState((s) => ({
          error: null,
          remounts: s.remounts + 1,
          mountKey: s.mountKey + 1,
        }));
      }, 16);
    }
  }

  componentWillUnmount() {
    if (this.timer != null) window.clearTimeout(this.timer);
  }

  render() {
    const max = this.props.maxRemounts ?? 4;
    if (this.state.error && !(isDomReconcileError(this.state.error) && this.state.remounts < max)) {
      return (
        <div
          className={`flex h-full min-h-[4rem] items-center justify-center ${this.props.className || ""}`.trim()}
        >
          <button
            type="button"
            className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-ink-muted hover:text-ink"
            onClick={() =>
              this.setState((s) => ({
                error: null,
                remounts: 0,
                mountKey: s.mountKey + 1,
              }))
            }
          >
            Reload chart
          </button>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div
          className={`h-full min-h-[4rem] ${this.props.className || ""}`.trim()}
          aria-busy="true"
        />
      );
    }
    return (
      <div className={`h-full w-full min-h-0 ${this.props.className || ""}`.trim()} key={this.state.mountKey}>
        {this.props.children}
      </div>
    );
  }
}
