"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { truncateId, TXID_RE } from "@/lib/constants";
import { HeatIcon, FingerprintIcon, GraphIcon, UndoIcon, ResetIcon } from "./icons";
import { SaveGraphPanel } from "./SaveGraphPanel";
import { useSaveLoadShare } from "./useSaveLoadShare";
import type { GraphNode } from "@/components/viz/graph/types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { SavedGraph, GraphAnnotation } from "@/lib/graph/saved-graph-types";

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
  onExpandFullscreen?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  // ─── Search ───
  onSearch?: (txid: string) => void;
  searchLoading?: boolean;
  searchError?: string | null;
  currentTxid?: string | null;
  currentLabel?: string | null;
  // ─── Save/Load/Share ───
  nodes?: Map<string, GraphNode>;
  rootTxid?: string;
  rootTxids?: Set<string>;
  network?: BitcoinNetwork;
  currentGraphId?: string | null;
  onLoadSavedGraph?: (graph: SavedGraph) => void;
  /** Register keyboard shortcut handlers with parent. */
  onRegisterHandlers?: (handlers: Record<string, () => void>) => void;
  // ─── Annotate mode ───
  annotateMode?: boolean;
  onToggleAnnotateMode?: () => void;
  nodePositionOverrides?: Map<string, { x: number; y: number }>;
  annotations?: GraphAnnotation[];
  nodeLabels?: Map<string, string>;
  edgeLabels?: Map<string, string>;
  /** Inline (non-fullscreen) shows only node count, undo/reset and fullscreen. */
  compact?: boolean;
}

const SEP = <span className="text-muted/30 hidden sm:inline select-none">|</span>;

const btnBase = "text-xs transition-colors px-2 py-1 rounded border cursor-pointer";
const btnOff = `${btnBase} text-muted hover:text-foreground border-card-border`;
const btnDisabled = `${btnBase} text-muted/50 border-card-border cursor-not-allowed`;

export function GraphToolbar(props: GraphToolbarProps) {
  const {
    nodeCount, maxNodes, hiddenCount, canUndo,
    heatMapActive, heatProgress, fingerprintMode, edgeMode,
    onToggleHeatMap, onToggleFingerprint, onCycleEdgeMode, onUndo, onReset,
    onExpandFullscreen, onZoomIn, onZoomOut, onFitView,
    onSearch, searchLoading, searchError, currentTxid, currentLabel,
    nodes, rootTxid, rootTxids, network, currentGraphId, onLoadSavedGraph,
    annotateMode: annotateModeActive, onToggleAnnotateMode,
    nodePositionOverrides: posOverrides, annotations: savedAnnotations,
  } = props;
  const { t } = useTranslation();
  const atCapacity = nodeCount >= maxNodes;
  // Show save/load/share only in fullscreen modes (alwaysFullscreen or modal), not inline embedded
  const isFullscreenMode = !!(onZoomIn || onSearch);
  const hasSaveLoad = !!network && isFullscreenMode;
  const slim = !!props.compact && !isFullscreenMode;
  const isEmpty = !nodes || nodes.size === 0;

  // ─── Search state ──────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (TXID_RE.test(trimmed) && onSearch) {
      onSearch(trimmed);
      setSearchInput("");
    }
  };

  // ─── Save/Load/Share (extracted hook) ──────────────────────────
  const saveLoadShare = useSaveLoadShare({
    nodes, rootTxid, rootTxids, network, currentGraphId,
    onLoadSavedGraph, nodePositionOverrides: posOverrides,
    annotations: savedAnnotations, nodeLabels: props.nodeLabels, edgeLabels: props.edgeLabels,
  });

  // ─── Keyboard shortcut registration ───────────────────────────
  // Refs hold the latest handler closures so we can register stable
  // wrapper functions once and always dispatch to the current logic.
  const handlersRef = useRef({
    save: () => {},
    open: () => {},
    share: () => {},
    focusSearch: () => {},
  });

  // Sync handler closures into refs after each render (must be in
  // useEffect, not during render, to satisfy the React compiler).
  const { onRegisterHandlers } = props;
  useEffect(() => {
    handlersRef.current = {
      save: () => {
        if (!isEmpty && hasSaveLoad) {
          saveLoadShare.setActivePanel("save");
          saveLoadShare.setSaveName(currentLabel || (rootTxid ? `Graph - ${truncateId(rootTxid)}` : ""));
        }
      },
      open: () => {
        saveLoadShare.setActivePanel(saveLoadShare.activePanel === "load" ? null : "load");
        saveLoadShare.setConfirmDeleteId(null);
      },
      share: () => { if (!isEmpty && hasSaveLoad) saveLoadShare.handleShare(); },
      focusSearch: () => searchRef.current?.focus(),
    };

    onRegisterHandlers?.({
      save: () => handlersRef.current.save(),
      open: () => handlersRef.current.open(),
      share: () => handlersRef.current.share(),
      focusSearch: () => handlersRef.current.focusSearch(),
    });
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5 gap-y-2">
      {/* ── Search ──────────────────────────────────────────── */}
      {onSearch && (
        <>
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
            <div className={`${btnBase} border-card-border flex items-center gap-1 pr-1`}>
              {searchLoading ? (
                <Loader2 size={12} className="text-bitcoin animate-spin shrink-0" />
              ) : (
                <Search size={12} className="text-muted shrink-0" />
              )}
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={
                  currentTxid
                    ? `${currentLabel ? `${currentLabel} - ` : ""}${truncateId(currentTxid)}`
                    : "txid... (/)"
                }
                className="bg-transparent text-xs text-foreground placeholder:text-muted/60 outline-none w-32 sm:w-48 focus:w-44 sm:focus:w-64 transition-[width] duration-200 min-w-0"
                spellCheck={false}
                autoComplete="off"
              />
              {searchInput.trim() && TXID_RE.test(searchInput.trim()) && (
                <button type="submit" className="text-[10px] text-bitcoin hover:text-bitcoin-hover cursor-pointer shrink-0">
                  {t("graph.searchGo", { defaultValue: "Go" })}
                </button>
              )}
            </div>
          </form>
          {searchError && (
            <span className="text-[10px] text-severity-critical">{searchError}</span>
          )}
        </>
      )}

      {/* ── Node count ──────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-xs text-muted min-w-0">
        {!onSearch && <GraphIcon />}
        <span className={`${atCapacity ? "text-severity-medium" : ""}`}>
          ({nodeCount}/{maxNodes})
        </span>
        {hiddenCount > 0 && (
          <span className="text-muted/70 hidden sm:inline">
            +{hiddenCount} {t("graph.hidden", { defaultValue: "hidden" })}
          </span>
        )}
      </div>

      {!slim && <>
      {SEP}

      {/* ── Analysis toggles ────────────────────────────────── */}
      <button
        onClick={onToggleHeatMap}
        className={`${btnBase} ${
          heatMapActive
            ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
            : "text-muted hover:text-foreground border-card-border"
        }`}
        title={t("graph.heatMap", { defaultValue: "Heat Map (H)" })}
      >
        <span className="flex items-center gap-1">
          <HeatIcon />
          <span className="hidden sm:inline">
            {heatMapActive && heatProgress < 100 ? `${heatProgress}%` : t("graph.heatMapLabel", { defaultValue: "Heat Map" })}
          </span>
        </span>
      </button>

      <button
        onClick={onToggleFingerprint}
        className={`${btnBase} ${
          fingerprintMode
            ? "text-purple-500 border-purple-500/30 bg-purple-500/10"
            : "text-muted hover:text-foreground border-card-border"
        }`}
        title={t("graph.fingerprint", { defaultValue: "Fingerprint (G)" })}
      >
        <span className="flex items-center gap-1">
          <FingerprintIcon />
          <span className="hidden sm:inline">{t("graph.fingerprintLabel", { defaultValue: "Fingerprint" })}</span>
        </span>
      </button>

      <button
        onClick={onCycleEdgeMode}
        className={`${btnBase} ${
          edgeMode === "linkability"
            ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
            : edgeMode === "entropy"
              ? "text-severity-good border-severity-good/30 bg-severity-good/10"
              : "text-muted hover:text-foreground border-card-border"
        }`}
        title={edgeMode === "default" ? t("graph.edgesScript", { defaultValue: "Edges: script type (L)" }) : edgeMode === "linkability" ? t("graph.edgesLink", { defaultValue: "Edges: linkability (L)" }) : t("graph.edgesEntropy", { defaultValue: "Edges: entropy (L)" })}
      >
        <span className="flex items-center gap-1">
          {edgeMode === "entropy" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 20h20" /><path d="M5 20V10" /><path d="M9 20V4" /><path d="M13 20v-8" /><path d="M17 20v-4" /><path d="M21 20v-2" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          )}
          <span className="hidden sm:inline">
            {edgeMode === "default" ? t("graph.edges", { defaultValue: "Edges" }) : edgeMode === "linkability" ? t("graph.linkability", { defaultValue: "Linkability" }) : t("graph.entropy", { defaultValue: "Entropy" })}
          </span>
        </span>
      </button>

      {SEP}

      {/* ── Annotate mode ───────────────────────────────────── */}
      {onToggleAnnotateMode && (
        <button
          onClick={onToggleAnnotateMode}
          className={`${btnBase} ${
            annotateModeActive
              ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
              : "text-muted hover:text-foreground border-card-border"
          }`}
          title={t("graph.annotate", { defaultValue: "Annotate (A)" })}
        >
          <span className="flex items-center gap-1">
            <Pencil size={12} />
            <span className="hidden sm:inline">{t("graph.annotateLabel", { defaultValue: "Annotate" })}</span>
          </span>
        </button>
      )}

      {SEP}
      </>}

      {/* ── Actions ─────────────────────────────────────────── */}
      {(!slim || canUndo) && <button
        onClick={onUndo}
        disabled={!canUndo}
        className={canUndo ? btnOff : btnDisabled}
        title={t("graph.undo", { defaultValue: "Undo (U)" })}
      >
        <span className="flex items-center gap-1">
          <UndoIcon />
          <span className="hidden sm:inline">{t("graph.undoLabel", { defaultValue: "Undo" })}</span>
        </span>
      </button>}

      {nodeCount > 1 && (
        <button onClick={onReset} className={btnOff} title={t("graph.reset", { defaultValue: "Reset (R)" })}>
          <span className="flex items-center gap-1">
            <ResetIcon />
            <span className="hidden sm:inline">{t("graph.resetLabel", { defaultValue: "Reset" })}</span>
          </span>
        </button>
      )}

      {/* ── Zoom ────────────────────────────────────────────── */}
      {onZoomIn && onZoomOut && (
        <>
          {SEP}
          <button onClick={onZoomIn} className={btnOff} title={t("graph.zoomIn", { defaultValue: "Zoom in (+)" })}>+</button>
          <button onClick={onZoomOut} className={btnOff} title={t("graph.zoomOut", { defaultValue: "Zoom out (-)" })}>-</button>
        </>
      )}
      {onFitView && (
        <button onClick={onFitView} className={btnOff} title={t("graph.fitView", { defaultValue: "Fit to view (0)" })}>{t("graph.fit", { defaultValue: "Fit" })}</button>
      )}

      {/* ── Save / Load / Share (right-aligned) ─────────────── */}
      {hasSaveLoad && (
        <SaveGraphPanel
          activePanel={saveLoadShare.activePanel}
          setActivePanel={saveLoadShare.setActivePanel}
          saveName={saveLoadShare.saveName}
          setSaveName={saveLoadShare.setSaveName}
          handleSave={saveLoadShare.handleSave}
          handleUpdate={saveLoadShare.handleUpdate}
          handleShare={saveLoadShare.handleShare}
          graphs={saveLoadShare.graphs}
          deleteGraph={saveLoadShare.deleteGraph}
          confirmDeleteId={saveLoadShare.confirmDeleteId}
          setConfirmDeleteId={saveLoadShare.setConfirmDeleteId}
          panelRef={saveLoadShare.panelRef}
          timeAgo={saveLoadShare.timeAgo}
          isEmpty={isEmpty}
          currentGraphId={currentGraphId}
          network={network}
          onLoadSavedGraph={onLoadSavedGraph}
          rootTxid={rootTxid}
          currentLabel={currentLabel}
        />
      )}

      {/* ── Fullscreen toggle (inline mode - always rightmost) ── */}
      {onExpandFullscreen && (
        <>
          {!hasSaveLoad && <div className="ml-auto" />}
          <button onClick={onExpandFullscreen} className={btnOff} title={t("graph.fullscreen", { defaultValue: "Fullscreen (F)" })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </>
      )}

      {/* Toast */}
      {saveLoadShare.toast && (
        <span className="text-[10px] text-bitcoin animate-pulse">{saveLoadShare.toast}</span>
      )}
    </div>
  );
}
