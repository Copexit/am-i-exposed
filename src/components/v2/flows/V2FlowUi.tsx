"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";

/** Page frame shared by the v2 flow views: width, gutters, a 200ms fade-up. */
export function FlowShell({ width = "wide", className = "", children, testId }: {
  width?: "wide" | "narrow";
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const max = width === "wide" ? "max-w-[1360px]" : "max-w-2xl";
  return (
    <motion.div
      data-testid={testId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`w-full ${max} mx-auto px-4 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** Quiet "New scan" control that returns to the home view. */
export function NewScanLink({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-2 min-h-[44px] -ml-2 px-2 rounded-lg text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {t("results.newScan", { defaultValue: "New scan" })}
    </button>
  );
}

/** Small uppercase mono chip (script type, network...). */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="v2-num text-[11px] leading-none uppercase tracking-wider text-muted border border-hairline-strong rounded px-1.5 py-1">
      {children}
    </span>
  );
}
