"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary that catches render errors in chart/viz components.
 * Prevents a chart crash from taking down the entire results panel.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="w-full text-center py-4 text-xs text-muted">
          Visualization could not be rendered.
        </div>
      );
    }
    return this.props.children;
  }
}
