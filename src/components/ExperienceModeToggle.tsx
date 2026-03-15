"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useExperienceMode } from "@/hooks/useExperienceMode";

/** Noob icon: simplified eye (basic view) */
function NoobIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    </svg>
  );
}

/** Pro icon: microscope / deep analysis */
function ProIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 18h8" />
      <path d="M3 22h18" />
      <path d="M14 22a7 7 0 1 0 0-14h-1" />
      <path d="M9 14h2" />
      <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
      <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
    </svg>
  );
}

export function ExperienceModeToggle() {
  const { t } = useTranslation();
  const { proMode, setProMode } = useExperienceMode();

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.experienceMode", { defaultValue: "Experience mode" })}
      className="inline-flex items-center rounded-full bg-surface-inset border border-card-border p-0.5"
    >
      <button
        role="radio"
        aria-checked={!proMode}
        onClick={() => setProMode(false)}
        className={`relative text-xs px-1.5 sm:px-3 py-1 rounded-full transition-colors cursor-pointer flex items-center gap-1 ${
          !proMode ? "text-bitcoin" : "text-muted hover:text-foreground"
        }`}
      >
        {!proMode && (
          <motion.span
            layoutId="exp-mode-pill"
            className="absolute inset-0 bg-bitcoin/15 border border-bitcoin/30 rounded-full"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-1">
          <NoobIcon className="sm:hidden shrink-0" />
          <span className="hidden sm:inline">
            {t("settings.modeNoob", { defaultValue: "Noob" })}
          </span>
        </span>
      </button>
      <button
        role="radio"
        aria-checked={proMode}
        onClick={() => setProMode(true)}
        className={`relative text-xs px-1.5 sm:px-3 py-1 rounded-full transition-colors cursor-pointer flex items-center gap-1 ${
          proMode ? "text-bitcoin" : "text-muted hover:text-foreground"
        }`}
      >
        {proMode && (
          <motion.span
            layoutId="exp-mode-pill"
            className="absolute inset-0 bg-bitcoin/15 border border-bitcoin/30 rounded-full"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-1">
          <ProIcon className="sm:hidden shrink-0" />
          <span className="hidden sm:inline">
            {t("settings.modePro", { defaultValue: "Pro" })}
          </span>
        </span>
      </button>
    </div>
  );
}
