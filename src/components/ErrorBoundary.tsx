import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null };

// Top-level safety net. If anything in the React tree throws, this
// catches it and shows a recoverable fallback instead of leaving
// the user with a blank window. Lives at the root (above <App />)
// so modal/portal throws are caught too.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log so the dev console / Tauri devtools surface the stack and
    // component trace. We deliberately don't ship a remote error
    // reporter — this is a local-first desktop app.
    console.error("ErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h1>Something broke.</h1>
            <p className="muted">
              mimo hit an unexpected error. Your file on disk is unchanged.
            </p>
            <pre>{error.message}</pre>
            <div className="error-boundary-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => window.location.reload()}
              >
                Reload window
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={this.reset}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
