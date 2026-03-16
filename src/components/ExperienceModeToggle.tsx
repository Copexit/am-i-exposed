"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useExperienceMode } from "@/hooks/useExperienceMode";

/** Normie icon: simplified eye */
function NormieIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    </svg>
  );
}

/** Cypherpunk icon: lock with code brackets */
function CypherpunkIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
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
          <NormieIcon className="sm:hidden shrink-0" />
          <span className="hidden sm:inline">
            {t("settings.modeNormie", { defaultValue: "Normie" })}
          </span>
        </span>
      </button>
      <button
        role="radio"
        aria-checked={proMode}
        onClick={() => setProMode(true)}
        className={`relative text-xs px-1.5 sm:px-3 py-1 rounded-full transition-colors cursor-pointer flex items-center gap-1 ${
          proMode
            ? "text-bitcoin"
            : "text-bitcoin/80 hover:text-bitcoin animate-pulse"
        }`}
      >
        {proMode ? (
          <motion.span
            layoutId="exp-mode-pill"
            className="absolute inset-0 bg-bitcoin/15 border border-bitcoin/30 rounded-full"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        ) : (
          <span className="absolute inset-0 rounded-full bg-bitcoin/5 border border-bitcoin/20 shadow-[0_0_8px_rgba(247,147,26,0.3)]" />
        )}
        <span className="relative z-10 flex items-center gap-1">
          <CypherpunkIcon className="sm:hidden shrink-0" />
          <span className="hidden sm:inline">
            {t("settings.modeCypherpunk", { defaultValue: "Cypherpunk" })}
          </span>
        </span>
      </button>
    </div>
  );
}
