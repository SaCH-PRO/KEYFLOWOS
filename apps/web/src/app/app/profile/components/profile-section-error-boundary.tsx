"use client";

import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ProfileSectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ProfileSection] ${this.props.sectionName ?? "Section"} error:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl p-6 flex flex-col items-center gap-3 text-center"
          style={{
            border: "1px solid hsl(var(--kf-error) / 0.3)",
            background: "hsl(var(--kf-error) / 0.05)",
          }}
          role="alert"
        >
          <AlertCircle className="w-8 h-8" style={{ color: "hsl(var(--kf-error))" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-error))" }}>
              {this.props.sectionName ? `${this.props.sectionName} failed to load` : "Section failed to load"}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              An unexpected error occurred. Reload the page or try again.
            </p>
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium min-h-[44px] transition-colors"
            style={{
              background: "hsl(var(--kf-error) / 0.1)",
              color: "hsl(var(--kf-error))",
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
