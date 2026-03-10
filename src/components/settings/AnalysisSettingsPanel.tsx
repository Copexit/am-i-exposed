"use client";

import { RotateCcw, Sliders, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";

export function AnalysisSettingsPanel() {
  const { t } = useTranslation();
  const { settings: analysisSettings, update: updateAnalysis, reset: resetAnalysis, DEFAULTS: ANALYSIS_DEFAULTS } = useAnalysisSettings();
  const [analysisOpen, setAnalysisOpen] = useState(false);

  const isCustomized =
    analysisSettings.maxDepth !== ANALYSIS_DEFAULTS.maxDepth ||
    analysisSettings.minSats !== ANALYSIS_DEFAULTS.minSats ||
    analysisSettings.timeout !== ANALYSIS_DEFAULTS.timeout ||
    analysisSettings.skipLargeClusters !== ANALYSIS_DEFAULTS.skipLargeClusters ||
    analysisSettings.skipCoinJoins !== ANALYSIS_DEFAULTS.skipCoinJoins ||
    analysisSettings.walletGapLimit !== ANALYSIS_DEFAULTS.walletGapLimit;

  return (
    <>
      {/* Analysis settings toggle */}
      <div className="border-t border-card-border pt-1">
        <button
          onClick={() => setAnalysisOpen(!analysisOpen)}
          aria-expanded={analysisOpen}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer w-full py-1"
        >
          <Sliders size={12} />
          {analysisOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {t("settings.analysis", { defaultValue: "Analysis" })}
          {isCustomized && (
            <span className="ml-auto text-xs text-bitcoin">
              {t("settings.customized", { defaultValue: "Customized" })}
            </span>
          )}
        </button>
      </div>

      {analysisOpen && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground uppercase tracking-wider">
              {t("settings.analysisSettings", { defaultValue: "Analysis Settings" })}
            </span>
            <button
              onClick={resetAnalysis}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              {t("settings.resetDefaults", { defaultValue: "Reset" })}
            </button>
          </div>

          {/* Max depth slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="analysis-depth" className="text-xs text-muted">
                {t("settings.maxDepth", { defaultValue: "Chain depth (hops)" })}
              </label>
              <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.maxDepth}</span>
            </div>
            <input
              id="analysis-depth"
              type="range"
              min={1}
              max={50}
              step={1}
              value={analysisSettings.maxDepth}
              onChange={(e) => updateAnalysis({ maxDepth: Number(e.target.value) })}
              className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
            />
            <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
              <span>1</span>
              <span>25</span>
              <span>50</span>
            </div>
          </div>

          {/* Min sats threshold */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="analysis-minsats" className="text-xs text-muted">
                {t("settings.minSats", { defaultValue: "Min sats to trace" })}
              </label>
              <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.minSats.toLocaleString()}</span>
            </div>
            <input
              id="analysis-minsats"
              type="range"
              min={100}
              max={100000}
              step={100}
              value={analysisSettings.minSats}
              onChange={(e) => updateAnalysis({ minSats: Number(e.target.value) })}
              className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
            />
            <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
              <span>100</span>
              <span>1,000</span>
              <span>100,000</span>
            </div>
          </div>

          {/* Timeout slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="analysis-timeout" className="text-xs text-muted">
                {t("settings.analysisTimeout", { defaultValue: "Timeout (seconds)" })}
              </label>
              <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.timeout}s</span>
            </div>
            <input
              id="analysis-timeout"
              type="range"
              min={1}
              max={600}
              step={1}
              value={analysisSettings.timeout}
              onChange={(e) => updateAnalysis({ timeout: Number(e.target.value) })}
              className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
            />
            <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
              <span>1s</span>
              <span>300s</span>
              <span>600s</span>
            </div>
          </div>

          {/* Wallet gap limit */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="analysis-gaplimit" className="text-xs text-muted">
                {t("settings.walletGapLimit", { defaultValue: "Wallet scan gap limit" })}
              </label>
              <span className="text-xs font-mono text-foreground tabular-nums">{analysisSettings.walletGapLimit}</span>
            </div>
            <input
              id="analysis-gaplimit"
              type="range"
              min={1}
              max={100}
              step={1}
              value={analysisSettings.walletGapLimit}
              onChange={(e) => updateAnalysis({ walletGapLimit: Number(e.target.value) })}
              className="w-full h-1.5 bg-surface-inset rounded-full appearance-none cursor-pointer accent-bitcoin"
            />
            <div className="flex justify-between text-[10px] text-muted/60 mt-0.5">
              <span>1</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          {/* Toggle: Skip large clusters */}
          <label className="flex items-center justify-between gap-2 cursor-pointer group">
            <span className="text-xs text-muted group-hover:text-foreground transition-colors">
              {t("settings.skipLargeClusters", { defaultValue: "Skip large clusters" })}
            </span>
            <button
              role="switch"
              aria-checked={analysisSettings.skipLargeClusters}
              onClick={() => updateAnalysis({ skipLargeClusters: !analysisSettings.skipLargeClusters })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                analysisSettings.skipLargeClusters ? "bg-bitcoin" : "bg-surface-inset"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  analysisSettings.skipLargeClusters ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </label>

          {/* Toggle: Skip CoinJoins/batching */}
          <label className="flex items-center justify-between gap-2 cursor-pointer group">
            <span className="text-xs text-muted group-hover:text-foreground transition-colors">
              {t("settings.skipCoinJoins", { defaultValue: "Skip CoinJoins in chain tracing" })}
            </span>
            <button
              role="switch"
              aria-checked={analysisSettings.skipCoinJoins}
              onClick={() => updateAnalysis({ skipCoinJoins: !analysisSettings.skipCoinJoins })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                analysisSettings.skipCoinJoins ? "bg-bitcoin" : "bg-surface-inset"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  analysisSettings.skipCoinJoins ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </label>

          <p className="text-[10px] text-muted/60">
            {t("settings.analysisNote", { defaultValue: "Settings apply to the next analysis. Changes are saved automatically." })}
          </p>
        </div>
      )}
    </>
  );
}
