"use client";

import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { FlowShell } from "./V2FlowUi";

interface V2ErrorProps {
  error: string | null;
  query?: string | null;
  /** When "not-retryable", Retry is hidden. */
  errorCode?: string | null;
  onRetry?: (query: string) => void;
  onBack: () => void;
}

/** Failed scan: what failed, the query, and the way forward. */
export function V2Error({ error, query, errorCode, onRetry, onBack }: V2ErrorProps) {
  const { t } = useTranslation();
  const canRetry = !!query && !!error && errorCode !== "not-retryable" && !!onRetry;

  return (
    <FlowShell width="narrow" className="py-16 sm:py-24" testId="v2-error">
      <div data-testid="error-message" role="alert" className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) overflow-hidden">
        <div className="h-0.5 bg-severity-critical/70" aria-hidden="true" />
        <div className="p-6 sm:p-8 space-y-5">
          <div className="space-y-2">
            <span className="v2-eyebrow">{t("v2.flows.errorEyebrow", { defaultValue: "Scan stopped" })}</span>
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance">
              {t("page.error_title", { defaultValue: "Analysis failed" })}
            </h1>
          </div>
          {error && <p className="text-[15px] text-muted leading-relaxed max-w-[60ch]">{error}</p>}
          {query && (
            <p className="v2-num text-[13px] text-muted break-all rounded-lg bg-surface-2 border border-hairline px-3 py-2.5">
              {query}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] px-4 rounded-lg text-sm text-muted hover:text-foreground border border-hairline hover:border-hairline-strong transition-colors cursor-pointer"
            >
              {t("page.new_scan", { defaultValue: "New scan" })}
            </button>
            {canRetry && (
              <button
                type="button"
                onClick={() => { if (query) onRetry?.(query); }}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg bg-bitcoin text-background text-sm font-semibold hover:bg-bitcoin-hover transition-colors cursor-pointer sm:order-first"
              >
                <RotateCw size={14} aria-hidden="true" />
                {t("page.retry", { defaultValue: "Retry" })}
              </button>
            )}
          </div>
        </div>
      </div>
    </FlowShell>
  );
}
