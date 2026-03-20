"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Loader2, Save, FolderOpen, Link2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSavedGraphs } from "@/hooks/useSavedGraphs";
import { serializeGraph } from "@/lib/graph/saved-graph-types";
import { encodeGraphToUrl } from "@/lib/graph/graph-url-codec";
import { truncateId, TXID_RE } from "@/lib/constants";
import { HeatIcon, FingerprintIcon, GraphIcon, UndoIcon, ResetIcon } from "./icons";
import type { GraphNode } from "@/lib/graph/graph-reducer";
import type { GraphState } from "@/lib/graph/graph-reducer";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

type EdgeMode = "default" | "linkability" | "entropy";
type Panel = "save" | "load" | null;

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
  } = props;

  const { t } = useTranslation();
  const atCapacity = nodeCount >= maxNodes;
  // Show save/load/share only in fullscreen modes (alwaysFullscreen or modal), not inline embedded
  const isFullscreenMode = !!(onZoomIn || onSearch);
  const hasSaveLoad = !!network && isFullscreenMode;
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

  // ─── Save/Load state ──────────────────────────────────────────
  const { graphs, saveGraph, updateGraph, deleteGraph } = useSavedGraphs();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [saveName, setSaveName] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!activePanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActivePanel(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activePanel]);

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const buildGraphState = useCallback((): GraphState => ({
    nodes: nodes ?? new Map(),
    rootTxid: rootTxid ?? "",
    rootTxids: rootTxids ?? new Set(),
    maxNodes: 100,
    undoStack: [],
    loading: new Set(),
    errors: new Map(),
  }), [nodes, rootTxid, rootTxids]);

  const handleSave = useCallback(() => {
    if (!network) return;
    const name = saveName.trim() || `Graph - ${truncateId(rootTxid ?? "")}`;
    const saved = serializeGraph(buildGraphState(), name, network);
    const id = saveGraph(saved);
    if (id) {
      setToast(t("graphSaveLoad.saved", { defaultValue: "Graph saved" }));
      setActivePanel(null);
    } else {
      setToast(t("graphSaveLoad.limitReached", { defaultValue: "Max 50 saved graphs reached" }));
    }
  }, [saveName, rootTxid, buildGraphState, network, saveGraph, t]);

  const handleUpdate = useCallback(() => {
    if (!currentGraphId) return;
    const state = buildGraphState();
    const nodesArr = [...state.nodes.values()].map((n) => ({
      txid: n.txid, depth: n.depth,
      parentEdge: n.parentEdge ? { ...n.parentEdge } : undefined,
      childEdge: n.childEdge ? { ...n.childEdge } : undefined,
    }));
    updateGraph(currentGraphId, {
      nodes: nodesArr,
      rootTxid: state.rootTxid,
      rootTxids: [...state.rootTxids],
    });
    setToast(t("graphSaveLoad.updated", { defaultValue: "Graph updated" }));
    setActivePanel(null);
  }, [currentGraphId, buildGraphState, updateGraph, t]);

  const handleShare = useCallback(() => {
    if (!network) return;
    const saved = serializeGraph(buildGraphState(), "", network);
    const encoded = encodeGraphToUrl(saved);
    if (!encoded) {
      setToast(t("graphSaveLoad.tooLarge", { defaultValue: "Graph too large for URL - use JSON export" }));
      return;
    }
    const url = `${window.location.origin}/graph/?network=${network}#graph=${encoded}`;
    navigator.clipboard.writeText(url).then(
      () => setToast(t("graphSaveLoad.linkCopied", { defaultValue: "Link copied to clipboard" })),
      () => setToast("Failed to copy"),
    );
  }, [buildGraphState, network, t]);

  // Expose handlers for keyboard shortcuts to parent
  useEffect(() => {
    props.onRegisterHandlers?.({
      save: () => {
        if (!isEmpty && hasSaveLoad) {
          setActivePanel("save");
          setSaveName(currentLabel || (rootTxid ? `Graph - ${truncateId(rootTxid)}` : ""));
        }
      },
      open: () => { setActivePanel(activePanel === "load" ? null : "load"); setConfirmDeleteId(null); },
      share: () => { if (!isEmpty && hasSaveLoad) handleShare(); },
      focusSearch: () => searchRef.current?.focus(),
    });
  });

  const [now] = useState(() => Date.now());
  const timeAgo = useCallback((ms: number): string => {
    const secs = Math.floor((now - ms) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }, [now]);

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
                  Go
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
            +{hiddenCount} hidden
          </span>
        )}
      </div>

      {SEP}

      {/* ── Analysis toggles ────────────────────────────────── */}
      <button
        onClick={onToggleHeatMap}
        className={`${btnBase} ${
          heatMapActive
            ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
            : "text-muted hover:text-foreground border-card-border"
        }`}
        title="Heat Map (H)"
      >
        <span className="flex items-center gap-1">
          <HeatIcon />
          <span className="hidden sm:inline">
            {heatMapActive && heatProgress < 100 ? `${heatProgress}%` : "Heat Map"}
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
        title="Fingerprint (G)"
      >
        <span className="flex items-center gap-1">
          <FingerprintIcon />
          <span className="hidden sm:inline">Fingerprint</span>
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
        title={edgeMode === "default" ? "Edges: script type (L)" : edgeMode === "linkability" ? "Edges: linkability (L)" : "Edges: entropy (L)"}
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

      {SEP}

      {/* ── Actions ─────────────────────────────────────────── */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className={canUndo ? btnOff : btnDisabled}
        title="Undo (U)"
      >
        <span className="flex items-center gap-1">
          <UndoIcon />
          <span className="hidden sm:inline">Undo</span>
        </span>
      </button>

      {nodeCount > 1 && (
        <button onClick={onReset} className={btnOff} title="Reset (R)">
          <span className="flex items-center gap-1">
            <ResetIcon />
            <span className="hidden sm:inline">Reset</span>
          </span>
        </button>
      )}

      {/* ── Zoom ────────────────────────────────────────────── */}
      {onZoomIn && onZoomOut && (
        <>
          {SEP}
          <button onClick={onZoomIn} className={btnOff} title="Zoom in (+)">+</button>
          <button onClick={onZoomOut} className={btnOff} title="Zoom out (-)">-</button>
        </>
      )}
      {onFitView && (
        <button onClick={onFitView} className={btnOff} title="Fit to view (0)">Fit</button>
      )}

      {/* ── Save / Load / Share (right-aligned) ─────────────── */}
      {hasSaveLoad && (
        <>
          <div className="ml-auto" />
          <div ref={panelRef} className="relative flex items-center gap-1.5">
            <button
              onClick={() => {
                setActivePanel(activePanel === "save" ? null : "save");
                setSaveName(currentLabel || (rootTxid ? `Graph - ${truncateId(rootTxid)}` : ""));
              }}
              disabled={isEmpty}
              className={isEmpty ? btnDisabled : btnOff}
              title="Save graph (S)"
            >
              <span className="flex items-center gap-1">
                <Save size={14} />
                <span className="hidden sm:inline">Save</span>
              </span>
            </button>

            {onLoadSavedGraph && (
              <button
                onClick={() => { setActivePanel(activePanel === "load" ? null : "load"); setConfirmDeleteId(null); }}
                className={btnOff}
                title="Open saved graph (O)"
              >
                <span className="flex items-center gap-1">
                  <FolderOpen size={14} />
                  <span className="hidden sm:inline">Open</span>
                </span>
              </button>
            )}

            <button
              onClick={handleShare}
              disabled={isEmpty}
              className={isEmpty ? btnDisabled : btnOff}
              title="Copy share link (C)"
            >
              <span className="flex items-center gap-1">
                <Link2 size={14} />
                <span className="hidden sm:inline">Share</span>
              </span>
            </button>

            {/* Save panel */}
            {activePanel === "save" && (
              <div className="absolute top-full right-0 mt-2 z-30 glass rounded-xl border border-glass-border p-3 w-72">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-foreground">Save Graph</span>
                  <button onClick={() => setActivePanel(null)} className="text-muted hover:text-foreground cursor-pointer"><X size={12} /></button>
                </div>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Graph name..."
                  className="w-full bg-surface-inset text-sm text-foreground placeholder:text-muted/60 rounded-lg px-2.5 py-1.5 outline-none border border-card-border mb-2"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setActivePanel(null); }}
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="flex-1 text-xs bg-bitcoin/20 text-bitcoin hover:bg-bitcoin/30 rounded-lg px-3 py-1.5 transition-colors cursor-pointer">
                    Save
                  </button>
                  {currentGraphId && (
                    <button onClick={handleUpdate} className="flex-1 text-xs bg-surface-inset text-muted hover:text-foreground rounded-lg px-3 py-1.5 transition-colors cursor-pointer border border-card-border">
                      Update
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Load panel */}
            {activePanel === "load" && onLoadSavedGraph && (
              <div className="absolute top-full right-0 mt-2 z-30 glass rounded-xl border border-glass-border w-80 max-h-80 overflow-y-auto">
                <div className="sticky top-0 glass border-b border-glass-border px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">Saved Graphs</span>
                  <button onClick={() => setActivePanel(null)} className="text-muted hover:text-foreground cursor-pointer"><X size={12} /></button>
                </div>
                {graphs.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted">No saved graphs yet</div>
                ) : (
                  <div className="py-1">
                    {graphs.map((g) => (
                      <div key={g.id} className="px-3 py-2 hover:bg-white/5 flex items-center gap-2 group">
                        <button
                          onClick={() => { onLoadSavedGraph(g); setActivePanel(null); }}
                          className="flex-1 text-left min-w-0 cursor-pointer"
                        >
                          <div className="text-sm text-foreground truncate">{g.name}</div>
                          <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                            <span>{g.nodes.length} nodes</span>
                            {g.network !== network && (
                              <span className="px-1 rounded bg-severity-medium/20 text-severity-medium">{g.network}</span>
                            )}
                            <span>{timeAgo(g.savedAt)}</span>
                          </div>
                        </button>
                        {confirmDeleteId === g.id ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => { deleteGraph(g.id); setConfirmDeleteId(null); }} className="text-[10px] text-severity-critical hover:underline cursor-pointer">Delete</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-muted hover:underline cursor-pointer">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(g.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-severity-critical transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Fullscreen toggle (inline mode - always rightmost) ── */}
      {onExpandFullscreen && (
        <>
          {!hasSaveLoad && <div className="ml-auto" />}
          <button onClick={onExpandFullscreen} className={btnOff} title="Fullscreen (F)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </>
      )}

      {/* Toast */}
      {toast && (
        <span className="text-[10px] text-bitcoin animate-pulse">{toast}</span>
      )}
    </div>
  );
}
