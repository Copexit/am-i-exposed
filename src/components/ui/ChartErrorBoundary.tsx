"use client";

import { Component, type ReactNode } from "react";
import i18n from "@/lib/i18n/config";

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
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[ChartErrorBoundary]", error);
    }
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="w-full text-center py-4 text-xs text-muted">
          {i18n.t("common.vizError", { defaultValue: "Visualization could not be rendered." })}
        </div>
      );
    }
    return this.props.children;
  }
}
