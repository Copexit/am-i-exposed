"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertCircle } from "lucide-react";

interface ErrorViewProps {
  /** The error message to display */
  error: string | null;
  /** The query that caused the error (shown as mono-spaced detail) */
  query?: string | null;
  /** Error code - when "not-retryable", the retry button is hidden */
  errorCode?: string | null;
  /** Called when the user clicks "Retry" */
  onRetry?: (query: string) => void;
  /** Called when the user clicks "New scan" */
  onBack: () => void;
}

export function ErrorView({ error, query, errorCode, onRetry, onBack }: ErrorViewProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-6 w-full max-w-xl mt-8 sm:mt-0"
    >
      <div data-testid="error-message" className="glass border-severity-critical/30 rounded-xl p-8 w-full space-y-4 text-center">
        <AlertCircle size={32} className="text-severity-critical mx-auto" />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            {t("page.error_title", { defaultValue: "Analysis failed" })}
          </h2>
          {query && (
            <p className="font-mono text-sm text-muted break-all text-left mx-auto max-w-sm">
              {query}
            </p>
          )}
          <p className="text-sm text-muted leading-relaxed">
            {error}
          </p>
        </div>
        <div className="flex items-center justify-center gap-4">
          {query && error && errorCode !== "not-retryable" && onRetry && (
            <button
              onClick={() => onRetry(query)}
              className="px-4 py-1.5 bg-bitcoin text-background font-semibold text-sm rounded-lg
                hover:bg-bitcoin-hover transition-all duration-150 cursor-pointer"
            >
              {t("page.retry", { defaultValue: "Retry" })}
            </button>
          )}
          <button
            onClick={onBack}
            className="text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            {t("page.new_scan", { defaultValue: "New scan" })}
          </button>
        </div>
      </div>
      <div className="pb-2" />
    </motion.div>
  );
}
