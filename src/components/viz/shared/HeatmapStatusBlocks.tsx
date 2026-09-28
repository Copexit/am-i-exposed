"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Grid3X3 } from "lucide-react";
import { formatRemainingTime } from "./heatmapHelpers";
import type { BoltzmannProgress } from "@/hooks/useBoltzmann";

interface IdleBlockProps {
  nIn: number;
  nOut: number;
  compute: () => void;
}

export function HeatmapIdleBlock({ nIn, nOut, compute }: IdleBlockProps) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-6 space-y-3">
      <p className="text-xs text-muted">
        {t("boltzmann.largeTxInfo", {
          defaultValue: "This transaction has {{nIn}} inputs and {{nOut}} outputs. Computation may take a long time.",
          nIn,
          nOut,
        })}
      </p>
      <button
        onClick={compute}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-bitcoin border border-bitcoin/30 rounded-lg hover:bg-bitcoin/10 transition-colors cursor-pointer"
      >
        <Grid3X3 size={14} />
        {t("boltzmann.compute", { defaultValue: "Compute Boltzmann LPM" })}
      </button>
    </div>
  );
}

interface ProgressBlockProps {
  progress: BoltzmannProgress | null;
}

export function HeatmapProgressBlock({ progress }: ProgressBlockProps) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-8 space-y-3">
      <div className="mx-auto max-w-xs">
        <div className="h-1.5 bg-surface-inset rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-bitcoin rounded-full"
            initial={{ width: "0%" }}
            animate={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        {progress && progress.fraction > 0
          ? `${Math.round(progress.fraction * 100)}%`
          : t("boltzmann.computing", { defaultValue: "Computing link probabilities..." })}
        {progress?.estimatedRemainingMs != null && (() => {
          const timeStr = formatRemainingTime(progress.estimatedRemainingMs);
          return timeStr ? <span className="ml-2 text-muted/60">~{timeStr}</span> : null;
        })()}
      </p>
    </div>
  );
}

interface ErrorBlockProps {
  error: string | undefined;
  compute: () => void;
}

export function HeatmapErrorBlock({ error, compute }: ErrorBlockProps) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-6 space-y-3">
      <p className="text-xs text-severity-critical">{error}</p>
      <button
        onClick={compute}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted border border-card-border rounded-lg hover:text-foreground transition-colors cursor-pointer"
      >
        {t("boltzmann.retry", { defaultValue: "Retry" })}
      </button>
    </div>
  );
}

export function HeatmapUnsupportedBlock() {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted text-center py-4">
      {t("boltzmann.unsupported", { defaultValue: "Web Workers are required for Boltzmann analysis." })}
    </p>
  );
}

export function HeatmapTooComplexBlock({ nIn, nOut }: { nIn: number; nOut: number }) {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted text-center py-4">
      {t("boltzmann.tooComplex", {
        nIn,
        nOut,
        defaultValue: "Too complex to compute in the browser: {{nIn}} inputs and {{nOut}} outputs would need gigabytes of memory for an exact Boltzmann analysis.",
      })}
    </p>
  );
}
