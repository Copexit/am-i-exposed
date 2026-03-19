"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import { Tooltip } from "@/components/ui/Tooltip";

/** Normie icon: smile face */
function NormieIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

/** Cypherpunk icon: terminal prompt */
function CypherpunkIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export function ExperienceModeToggle() {
  const { t } = useTranslation();
  const { proMode, setProMode } = useExperienceMode();

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.experienceMode", { defaultValue: "Experience" })}
      className="inline-flex items-center rounded-full bg-surface-inset border border-card-border p-0.5"
    >
      <Tooltip content={t("settings.normieTooltip", { defaultValue: "Clean results - score, key findings, and recommendations" })} side="bottom">
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
      </Tooltip>
      <Tooltip content={t("settings.cypherpunkTooltip", { defaultValue: "Full dashboard - tx graph, Boltzmann entropy, taint analysis, deep chain tracing" })} side="bottom">
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
      </Tooltip>
    </div>
  );
}
