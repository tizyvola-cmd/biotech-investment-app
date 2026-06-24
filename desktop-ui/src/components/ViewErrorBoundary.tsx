import { Component, type ErrorInfo, type ReactNode } from "react";
import { ViewErrorFallback } from "./ViewErrorFallback";

type Props = {
  label?: string;
  children: ReactNode;
};

type State = { error: Error | null };

/** Catches render errors so one broken panel does not blank the whole app. */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ViewErrorBoundary]", this.props.label ?? "view", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const chunkLoad = /dynamically imported module|failed to fetch.*investSim/i.test(
        this.state.error.message,
      );
      return (
        <ViewErrorFallback
          label={this.props.label}
          message={this.state.error.message}
          chunkLoad={chunkLoad}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
