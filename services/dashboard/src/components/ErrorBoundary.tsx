import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AEGIS Dashboard] Uncaught rendering error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="card card-error" style={{ margin: "24px", padding: "24px", background: "#2a1515", border: "1px solid #ff4a4a" }}>
          <h2 style={{ color: "#ff4a4a", marginBottom: "8px" }}>Dashboard Render Crash</h2>
          <p className="muted">An unhandled error occurred in the React layout. The rendering state is shown below:</p>
          <pre style={{
            whiteSpace: "pre-wrap",
            marginTop: "12px",
            color: "#ffcaca",
            background: "#1a0a0a",
            padding: "12px",
            borderRadius: "4px",
            fontSize: "13px",
            fontFamily: "monospace"
          }}>
            {this.state.error && this.state.error.toString()}
            {this.state.error?.stack && `\n\nStack:\n${this.state.error.stack}`}
          </pre>
          <button
            type="button"
            className="btn-small"
            style={{ marginTop: "16px", background: "#ff4a4a", color: "#fff" }}
            onClick={() => {
              // Clear active dispatch state to prevent infinite crash loop on reload
              try {
                localStorage.clear();
                sessionStorage.clear();
              } catch {}
              window.location.reload();
            }}
          >
            Reset State & Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
