"use client";

import { useTranslation } from "react-i18next";
import { HeatIcon, FingerprintIcon, ExpandIcon, GraphIcon, UndoIcon, ResetIcon } from "./icons";

type EdgeMode = "default" | "linkability" | "entropy";

interface GraphToolbarProps {
  nodeCount: number;
  maxNodes: number;
  hiddenCount: number;
  canUndo: boolean;
  heatMapActive: boolean;
  heatProgress: number;
  fingerprintMode: boolean;
  edgeMode: EdgeMode;
  onToggleHeatMap: () => void;
  onToggleFingerprint: () => void;
  onCycleEdgeMode: () => void;
  onUndo: () => void;
  onReset: () => void;
  /** Fullscreen-specific: omitted in inline mode */
  onExpandFullscreen?: () => void;
  /** Fullscreen-specific zoom controls */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
}

export function GraphToolbar({
  nodeCount,
  maxNodes,
  hiddenCount,
  canUndo,
  heatMapActive,
  heatProgress,
  fingerprintMode,
  edgeMode,
  onToggleHeatMap,
  onToggleFingerprint,
  onCycleEdgeMode,
  onUndo,
  onReset,
  onExpandFullscreen,
  onZoomIn,
  onZoomOut,
  onFitView,
}: GraphToolbarProps) {
  const { t } = useTranslation();
  const atCapacity = nodeCount >= maxNodes;

  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-white/70 min-w-0">
        <GraphIcon />
        <span className="truncate">{t("graphExplorer.title", { defaultValue: "Transaction Graph" })}</span>
        <span className={`text-xs font-normal hidden sm:inline ${atCapacity ? "text-amber-400" : "text-white/40"}`}>
          {t("graphExplorer.nodeCount", { count: nodeCount, max: maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
          {hiddenCount > 0 && (
            <span className="ml-1 text-white/30">
              ({hiddenCount} {t("graphExplorer.hidden", { defaultValue: "hidden" })})
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Heat map toggle */}
        <button
          onClick={onToggleHeatMap}
          className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
            heatMapActive
              ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
              : "text-white/50 hover:text-white/80 border-white/10"
          }`}
          title={t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
        >
          <span className="flex items-center gap-1">
            <HeatIcon />
            <span className="hidden sm:inline">
              {heatMapActive && heatProgress < 100
                ? `${heatProgress}%`
                : t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
            </span>
          </span>
        </button>

        {/* Fingerprint mode toggle */}
        <button
          onClick={onToggleFingerprint}
          className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
            fingerprintMode
              ? "text-purple-400 border-purple-400/30 bg-purple-400/10"
              : "text-white/50 hover:text-white/80 border-white/10"
          }`}
          title="Fingerprint mode - encode locktime, version, and script types"
        >
          <span className="flex items-center gap-1">
            <FingerprintIcon />
            <span className="hidden sm:inline">Fingerprint</span>
          </span>
        </button>

        {/* Edge mode selector */}
        <button
          onClick={onCycleEdgeMode}
          className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
            edgeMode === "linkability"
              ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
              : edgeMode === "entropy"
                ? "text-green-400 border-green-400/30 bg-green-400/10"
                : "text-white/50 hover:text-white/80 border-white/10"
          }`}
          title={edgeMode === "default"
            ? "Edge colors: script type (click to cycle)"
            : edgeMode === "linkability"
              ? "Edge colors: linkability (click to cycle)"
              : "Edge colors: entropy gradient (click to cycle)"}
        >
          <span className="flex items-center gap-1">
            {edgeMode === "entropy" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 20h20" /><path d="M5 20V10" /><path d="M9 20V4" /><path d="M13 20v-8" /><path d="M17 20v-4" /><path d="M21 20v-2" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            )}
            <span className="hidden sm:inline">
              {edgeMode === "default" ? "Edges" : edgeMode === "linkability" ? "Linkability" : "Entropy"}
            </span>
          </span>
        </button>

        {/* Undo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`text-xs transition-colors px-2 py-1 rounded border border-white/10 ${
            canUndo
              ? "text-white/50 hover:text-white/80 cursor-pointer"
              : "text-white/20 cursor-not-allowed"
          }`}
          title={t("common.undo", { defaultValue: "Undo" })}
        >
          <span className="flex items-center gap-1">
            <UndoIcon />
            <span className="hidden sm:inline">{t("common.undo", { defaultValue: "Undo" })}</span>
          </span>
        </button>

        {/* Reset */}
        {nodeCount > 1 && (
          <button
            onClick={onReset}
            className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
            title={t("common.reset", { defaultValue: "Reset" })}
          >
            <span className="flex items-center gap-1">
              <ResetIcon />
              <span className="hidden sm:inline">{t("common.reset", { defaultValue: "Reset" })}</span>
            </span>
          </button>
        )}

        {/* Fullscreen zoom controls */}
        {onZoomIn && onZoomOut && (
          <>
            <span className="text-white/20 hidden sm:inline">|</span>
            <button
              onClick={onZoomIn}
              className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
              title="Zoom in"
            >+</button>
            <button
              onClick={onZoomOut}
              className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
              title="Zoom out"
            >-</button>
          </>
        )}
        {onFitView && (
          <button
            onClick={onFitView}
            className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
            title="Fit to view"
          >{t("graphExplorer.fit", { defaultValue: "Fit" })}</button>
        )}

        {/* Fullscreen toggle (inline mode only) */}
        {onExpandFullscreen && (
          <button
            onClick={onExpandFullscreen}
            className="text-white/50 hover:text-white/80 transition-colors p-1 rounded border border-white/10 cursor-pointer"
            title={t("graphExplorer.fullscreen", { defaultValue: "Fullscreen" })}
          >
            <ExpandIcon />
          </button>
        )}
      </div>
    </div>
  );
}
