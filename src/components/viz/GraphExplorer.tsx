"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { useChartTooltip } from "./shared/ChartTooltip";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGraphBoltzmann } from "@/hooks/useGraphBoltzmann";
import { useConnectionSearch } from "@/hooks/useConnectionSearch";
import type { ConnectionPath } from "@/lib/graph/connection-search";
import { ConnectionPanel, CONNECTION_PANEL_INSET, SM_BREAKPOINT } from "./graph/ConnectionPanel";
import { GraphSidebar } from "./graph/GraphSidebar";
import { MAX_ZOOM, MIN_ZOOM } from "./graph/constants";
import {
  layoutGraph, computeFitView, computeAutoFitView, getViewportDims, findFreeY,
  SEED_BACKWARD_DX, SEED_FORWARD_GAP,
} from "./graph/layout";
import { CloseIcon } from "./graph/icons";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphLegend } from "./graph/GraphLegend";
import { GraphTooltipContent } from "./graph/GraphTooltipContent";
import { GraphViewport } from "./graph/GraphViewport";
import { useGraphExplorerState, activePositionOverrides } from "./graph/useGraphExplorerState";
import { useGraphHeatMap } from "./graph/useGraphHeatMap";
import { useChangeOutputDetection } from "./graph/useChangeOutputDetection";
import type { GraphExplorerProps, TooltipData, NodeFilter, ViewTransform } from "./graph/types";
import type { GraphAnnotation, SavedGraph } from "@/lib/graph/saved-graph-types";

// Re-export types for consumers that import from this file
export type { GraphExplorerProps } from "./graph/types";

/**
 * OXT-style interactive graph explorer.
 *
 * Renders an expandable transaction DAG where each node represents a transaction.
 * Users can click inputs (left side) to expand backward or outputs (right side)
 * to expand forward. Nodes are colored by privacy grade and entity attribution.
 */
export function GraphExplorer(props: GraphExplorerProps) {
  const { graph } = props;
  const { t } = useTranslation();
  const tooltip = useChartTooltip<TooltipData>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Reducer state ──────────────────────────────────────
  const {
    state, dispatch, userToggledRef, toggleChange,
    handleNodePositionChange, handleSetNodeLabel, handleSetEdgeLabel, handleSetLabels,
    handleToggleHeatMap, handleToggleFingerprint,
    handleLayoutComplete, handleFullscreenExit,
    restoreSavedGraph, restoreFromLastLoaded,
    nodePositionsRef, containerDimsRef,
  } = useGraphExplorerState(props.alwaysFullscreen);

  const {
    hoveredNode, selectedNode, focusedNode, filter, sidebarCollapsed,
    nodePositionOverrides, annotations, annotateMode, nodeLabels, edgeLabels,
    viewTransform, edgeMode, heatMapActive, heatMap, heatProgress,
    fingerprintMode, changeOutputs, visibleCount,
    connection, pickMode, highlightTxids,
    layoutMode, unbundledPairs,
  } = state;
  const timeMode = layoutMode === "time";
  // Saved (hops) positions go to the toolbar; the canvas lays out with the active mode's
  const positionOverrides = activePositionOverrides(state);

  const linkabilityEdgeMode = edgeMode === "linkability";
  const entropyGradientMode = edgeMode === "entropy";

  // Restore state when a saved graph is loaded (from URL or workspace)
  useEffect(() => {
    restoreFromLastLoaded(props.lastLoadedGraph);
  }, [props.lastLoadedGraph, restoreFromLastLoaded]);

  // Sidebar tx data
  const sidebarTx = graph.expandedNodeTxid ? graph.nodes.get(graph.expandedNodeTxid)?.tx : undefined;
  const showSidebar = !!sidebarTx && !sidebarCollapsed;

  // Seed new nodes near their trigger node.
  const pendingSeedRef = useRef<{ triggerTxid: string; direction: "backward" | "forward"; x: number; y: number } | null>(null);
  const prevNodeKeysRef = useRef<Set<string>>(new Set());

  // Free y slot near (x, y), avoiding laid-out nodes and pending drag overrides
  const freeY = useCallback((x: number, y: number, excludeTxid?: string) =>
    findFreeY(x, y, [nodePositionsRef.current, positionOverrides], excludeTxid),
  [nodePositionsRef, positionOverrides]);

  // When nodes change, detect new nodes and seed their position
  useEffect(() => {
    const seed = pendingSeedRef.current;
    if (!seed) { prevNodeKeysRef.current = new Set(graph.nodes.keys()); return; }
    const prevKeys = prevNodeKeysRef.current;
    for (const txid of graph.nodes.keys()) {
      if (!prevKeys.has(txid)) {
        const y = freeY(seed.x, seed.y, txid);
        dispatch({ type: "SET_NODE_POSITION", txid, x: seed.x, y });
        pendingSeedRef.current = null;
        break;
      }
    }
    prevNodeKeysRef.current = new Set(graph.nodes.keys());
  }, [graph.nodes, dispatch, freeY]);

  const { expandInput, expandOutput, expandPortInput, expandPortOutput } = graph;

  // Seed position before any expand (backward or forward, node button or port).
  // The time layout places new nodes by block height instead.
  const seedBackward = useCallback((txid: string) => {
    if (timeMode) return;
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      const targetX = triggerPos.x - SEED_BACKWARD_DX;
      const y = freeY(targetX, triggerPos.y);
      pendingSeedRef.current = { triggerTxid: txid, direction: "backward", x: targetX, y };
    }
  }, [nodePositionsRef, freeY, timeMode]);

  const seedForward = useCallback((txid: string) => {
    if (timeMode) return;
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      const targetX = triggerPos.x + triggerPos.w + SEED_FORWARD_GAP;
      const y = freeY(targetX, triggerPos.y);
      pendingSeedRef.current = { triggerTxid: txid, direction: "forward", x: targetX, y };
    }
  }, [nodePositionsRef, freeY, timeMode]);

  const handleExpandInput = useCallback((txid: string, inputIndex: number) => {
    seedBackward(txid);
    // Fire-and-forget: the callee catches its own errors.
    void expandInput(txid, inputIndex);
  }, [expandInput, seedBackward]);

  const handleExpandOutput = useCallback((txid: string, outputIndex: number) => {
    seedForward(txid);
    // Fire-and-forget: the callee catches its own errors.
    void expandOutput(txid, outputIndex);
  }, [expandOutput, seedForward]);

  const handleExpandPortInput = useCallback((txid: string, inputIndex: number) => {
    seedBackward(txid);
    // Fire-and-forget: the callee catches its own errors.
    void expandPortInput(txid, inputIndex);
  }, [expandPortInput, seedBackward]);

  const handleExpandPortOutput = useCallback((txid: string, outputIndex: number) => {
    seedForward(txid);
    // Fire-and-forget: the callee catches its own errors.
    void expandPortOutput(txid, outputIndex);
  }, [expandPortOutput, seedForward]);

  // ─── Boltzmann ─────────────────────────────────────────
  const {
    getBoltzmannResult, triggerBoltzmann,
    computingBoltzmann, boltzmannProgressMap, boltzmannCache,
  } = useGraphBoltzmann({
    nodes: graph.nodes,
    rootTxid: graph.rootTxid,
    rootBoltzmannResult: props.rootBoltzmannResult,
    paused: graph.autoTracing,
  });

  const hasLinkability = !!props.rootBoltzmannResult || boltzmannCache.size > 0;

  // ─── Find connection ───────────────────────────────────
  const connectionSearch = useConnectionSearch(graph.fetcher);
  const { addPath } = graph;
  // Focus returns to whatever opened the panel (toolbar or sidebar button)
  const connectionTriggerRef = useRef<HTMLElement | null>(null);
  const openConnection = useCallback((from?: string) => {
    connectionTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch({ type: "OPEN_CONNECTION", from: from ?? graph.expandedNodeTxid ?? graph.rootTxid });
  }, [dispatch, graph.expandedNodeTxid, graph.rootTxid]);
  const { reset: resetConnectionSearch } = connectionSearch;
  const closeConnection = useCallback(() => {
    resetConnectionSearch();
    dispatch({ type: "CLOSE_CONNECTION" });
    const trigger = connectionTriggerRef.current;
    connectionTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [resetConnectionSearch, dispatch]);
  /** Adds the paths in order; highlights every path tx and returns the totals. */
  const handleAddPaths = useCallback(async (paths: ConnectionPath[]) => {
    const total = { added: 0, skipped: 0 };
    for (const path of paths) {
      const r = await addPath(path, connectionSearch.txs);
      total.added += r.added;
      total.skipped += r.skipped;
    }
    dispatch({ type: "SET_HIGHLIGHT", txids: new Set(paths.flatMap((p) => p.hops.map((h) => h.txid))) });
    return total;
  }, [addPath, connectionSearch.txs, dispatch]);

  // While the desktop panel is open, framing leaves its width free on the right
  const panelOpen = !!connection;
  const fitDims = useCallback(() => {
    const d = containerDimsRef.current;
    const inset = panelOpen && window.innerWidth >= SM_BREAKPOINT ? CONNECTION_PANEL_INSET : 0;
    return inset && d.width > inset + 240 ? { ...d, width: d.width - inset } : d;
  }, [panelOpen, containerDimsRef]);

  const cycleEdgeMode = useCallback(() => {
    dispatch({ type: "CYCLE_EDGE_MODE", hasLinkability });
  }, [hasLinkability, dispatch]);

  // Fullscreen toggle
  // Re-frame the view once the next canvas has measured its real size: on first
  // compact render, on opening fullscreen, and on returning to compact inline.
  const pendingFrameRef = useRef(!!props.compact);
  const { compact } = props;
  const onFullscreenExit = useCallback(() => {
    pendingFrameRef.current = !!compact;
    handleFullscreenExit();
  }, [compact, handleFullscreenExit]);
  const { isExpanded, expand: expandFullscreen, collapse: collapseFullscreen } = useFullscreen(onFullscreenExit);

  // Zoom helper (reads container dims at call time, so a resize is honored)
  const zoomBy = useCallback((factor: number) => {
    if (!viewTransform) return;
    const { cw, ch } = getViewportDims(containerDimsRef.current);
    const cx = cw / 2;
    const cy = ch / 2;
    const gx = (cx - viewTransform.x) / viewTransform.scale;
    const gy = (cy - viewTransform.y) / viewTransform.scale;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewTransform.scale * factor));
    dispatch({ type: "SET_VIEW_TRANSFORM", vt: { x: cx - gx * s, y: cy - gy * s, scale: s } });
  }, [viewTransform, dispatch, containerDimsRef]);

  // ─── Heat map computation ──────────────────────────────
  useGraphHeatMap({ active: heatMapActive, nodes: graph.nodes, dispatch });

  // ─── Auto-mark change outputs ──────────────────────────
  useChangeOutputDetection({ nodes: graph.nodes, dispatch, userToggledRef });

  // ─── Layout helpers ────────────────────────────────────
  const hiddenCount = graph.nodeCount - visibleCount;

  // Fit/auto-fit frame the boxes the canvas actually rendered (seeded and
  // dragged positions, expanded-node sizes), not a separately recomputed layout.
  const handleFitView = useCallback(() => {
    const vt = computeFitView([...nodePositionsRef.current.values()], fitDims());
    if (vt) dispatch({ type: "SET_VIEW_TRANSFORM", vt });
  }, [dispatch, nodePositionsRef, fitDims]);

  // A layout switch moves every column: frame all of the result (like Fit)
  const fitAllNextRef = useRef(false);
  const toggleLayoutMode = useCallback(() => {
    pendingFrameRef.current = true;
    fitAllNextRef.current = true;
    dispatch({ type: "TOGGLE_LAYOUT_MODE" });
  }, [dispatch]);

  const handleExpandFullscreen = useCallback(() => {
    pendingFrameRef.current = true;
    expandFullscreen();
  }, [expandFullscreen]);

  // Auto-fit only when the set of visible nodes changes (load, expand, collapse,
  // new root) or a new canvas mounts; drags and manual pan/zoom are left alone.
  const fittedKeysRef = useRef<Set<string>>(new Set());
  const { rootTxid, rootTxids } = graph;
  const onLayoutComplete = useCallback((info: Parameters<typeof handleLayoutComplete>[0]) => {
    handleLayoutComplete(info);
    if (info.containerHeight <= 0 || info.nodePositions.size === 0) return;
    // A new node's seed position lands on the next layout: frame that one instead
    if (pendingSeedRef.current) return;
    const prev = fittedKeysRef.current;
    const keys = new Set(info.nodePositions.keys());
    const added = prev.size > 0 ? [...keys].filter((k) => !prev.has(k)) : [];
    const changed = keys.size !== prev.size || added.length > 0;
    if (!changed && !pendingFrameRef.current) return;
    pendingFrameRef.current = false;
    const fitAll = fitAllNextRef.current;
    fitAllNextRef.current = false;
    fittedKeysRef.current = keys;
    // rAF: run after GraphCanvas's own first-render root centering
    requestAnimationFrame(() => {
      const pos = nodePositionsRef.current;
      const focus = [rootTxid, ...(rootTxids ?? []), ...added].flatMap((id) => pos.get(id) ?? []);
      const vt = fitAll ? computeFitView([...pos.values()], fitDims()) : computeAutoFitView([...pos.values()], focus, fitDims());
      if (vt) dispatch({ type: "SET_VIEW_TRANSFORM", vt });
    });
  }, [handleLayoutComplete, rootTxid, rootTxids, nodePositionsRef, fitDims, dispatch]);

  // ─── Stable callbacks ──────────────────────────────────
  const { onLoadSavedGraph } = props;
  const handleLoadSavedGraph = useCallback((graph: SavedGraph) => {
    restoreSavedGraph(graph);
    onLoadSavedGraph?.(graph);
  }, [restoreSavedGraph, onLoadSavedGraph]);

  const setViewTransform = useCallback((vt: ViewTransform | undefined) => {
    dispatch({ type: "SET_VIEW_TRANSFORM", vt });
  }, [dispatch]);

  const setAnnotations = useCallback((a: GraphAnnotation[]) => {
    dispatch({ type: "SET_ANNOTATIONS", annotations: a });
  }, [dispatch]);

  // ─── Keyboard shortcuts ────────────────────────────────
  const { undo, reset: resetGraph } = graph;
  const reset = useCallback(() => {
    resetGraph();
    dispatch({ type: "RESET_VIEW" });
  }, [resetGraph, dispatch]);
  const tbHandlersRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); tbHandlersRef.current.save?.(); return; }
      if (e.key === "Escape" && pickMode) { dispatch({ type: "SET_PICK_MODE", active: false }); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      switch (e.key) {
        case "h": handleToggleHeatMap(); break;
        case "g": handleToggleFingerprint(); break;
        case "l": cycleEdgeMode(); break;
        case "t": toggleLayoutMode(); break;
        case "u": undo(); break;
        case "r": reset(); break;
        case "+": case "=": zoomBy(1.25); break;
        case "-": zoomBy(1 / 1.25); break;
        case "0": handleFitView(); break;
        case "/": e.preventDefault(); tbHandlersRef.current.focusSearch?.(); break;
        case "s": tbHandlersRef.current.save?.(); break;
        case "o": tbHandlersRef.current.open?.(); break;
        case "c": tbHandlersRef.current.share?.(); break;
        case "a": dispatch({ type: "TOGGLE_ANNOTATE_MODE" }); break;
        case "f": if (isExpanded) collapseFullscreen(); else handleExpandFullscreen(); break;
        case "Escape": if (isExpanded) collapseFullscreen(); break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleToggleHeatMap, handleToggleFingerprint, cycleEdgeMode, isExpanded, collapseFullscreen, handleExpandFullscreen, undo, reset, zoomBy, handleFitView, dispatch, pickMode, toggleLayoutMode]);

  // Compact inline: canvas height fits the laid-out graph (260-500px).
  const compactHeight = useMemo(() => {
    if (!compact) return undefined;
    const { height } = layoutGraph(graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, false, positionOverrides, layoutMode);
    return Math.min(500, Math.max(260, height + 48));
  }, [compact, graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, positionOverrides, layoutMode]);

  // Early return for empty graph (but not alwaysFullscreen)
  if (graph.nodes.size === 0 && !props.alwaysFullscreen) return null;

  // ─── Shared prop objects ───────────────────────────────

  const toolbarProps = {
    nodeCount: graph.nodeCount, maxNodes: graph.maxNodes, hiddenCount,
    heatMapActive, heatProgress, fingerprintMode, edgeMode,
    onToggleHeatMap: handleToggleHeatMap, onToggleFingerprint: handleToggleFingerprint,
    canUndo: graph.canUndo, onUndo: undo,
    onCycleEdgeMode: cycleEdgeMode, onReset: reset,
    onSearch: props.onSearch, searchLoading: props.searchLoading, searchError: props.searchError,
    currentTxid: graph.rootTxid || null, currentLabel: props.currentLabel ?? null,
    nodes: graph.nodes, rootTxid: graph.rootTxid, rootTxids: graph.rootTxids,
    network: props.network, currentGraphId: props.currentGraphId ?? null,
    onLoadSavedGraph: onLoadSavedGraph ? handleLoadSavedGraph : undefined,
    onRegisterHandlers: (handlers: Record<string, () => void>) => { tbHandlersRef.current = handlers; },
    annotateMode, onToggleAnnotateMode: () => dispatch({ type: "TOGGLE_ANNOTATE_MODE" }),
    nodePositionOverrides, annotations, nodeLabels, edgeLabels, onSetLabels: handleSetLabels,
    onFindConnection: graph.fetcher ? () => (connection ? closeConnection() : openConnection()) : undefined,
    findConnectionOpen: !!connection,
    layoutMode, onToggleLayoutMode: toggleLayoutMode,
  };

  // Any canvas click ends the highlight; in pick mode a node click sets To instead
  const clearHighlight = () => dispatch({ type: "SET_HIGHLIGHT", txids: new Set() });

  const canvasProps = {
    nodes: graph.nodes, rootTxid: graph.rootTxid, rootTxids: graph.rootTxids,
    walletUtxos: props.walletUtxos, loading: graph.loading,
    nodeCount: graph.nodeCount, maxNodes: graph.maxNodes,
    onCollapse: graph.collapse, rootBoltzmannResult: props.rootBoltzmannResult,
    expandedNodeTxid: graph.expandedNodeTxid,
    onToggleExpand: (txid: string) => {
      clearHighlight();
      if (pickMode) dispatch({ type: "PICK_NODE", txid });
      else void graph.toggleExpand(txid);
    },
    outspendCache: graph.outspendCache,
    onExpandInput: handleExpandInput,
    onExpandOutput: handleExpandOutput,
    onExpandPortInput: handleExpandPortInput,
    onExpandPortOutput: handleExpandPortOutput,
    tooltip, scrollRef, filter, hoveredNode,
    setHoveredNode: (txid: string | null) => dispatch({ type: "SET_HOVERED_NODE", txid }),
    selectedNode,
    setSelectedNode: (node: { txid: string; x: number; y: number } | null) => {
      if (!node) clearHighlight();
      dispatch({ type: "SET_SELECTED_NODE", node });
    },
    focusedNode, highlightTxids,
    setFocusedNode: (txid: string | null) => dispatch({ type: "SET_FOCUSED_NODE", txid }),
    heatMap, heatMapActive, linkabilityEdgeMode, fingerprintMode, entropyGradientMode,
    changeOutputs, onLayoutComplete, boltzmannCache,
    nodePositionOverrides: positionOverrides, onNodePositionChange: handleNodePositionChange,
    annotations, annotateMode, onAnnotationsChange: setAnnotations,
    nodeLabels, onSetNodeLabel: handleSetNodeLabel, edgeLabels, onSetEdgeLabel: handleSetEdgeLabel,
    layoutMode, unbundledPairs,
    onToggleBundle: (key: string) => dispatch({ type: "TOGGLE_BUNDLE", key }),
  };

  const legend = (
    <GraphLegend
      filter={filter}
      onToggleFilter={(key: keyof NodeFilter) => dispatch({ type: "TOGGLE_FILTER", key })}
      fingerprintMode={fingerprintMode}
      changeOutputs={changeOutputs}
    />
  );

  const connectionPanel = connection && (
    <ConnectionPanel
      from={connection.from}
      to={connection.to}
      onFieldChange={(field, value) => dispatch({ type: "SET_CONNECTION_FIELD", field, value })}
      pickMode={pickMode}
      onTogglePick={() => dispatch({ type: "SET_PICK_MODE", active: !pickMode })}
      onClose={closeConnection}
      search={connectionSearch}
      boltzmannCache={boltzmannCache}
      onAddPaths={handleAddPaths}
    />
  );

  const tooltipContent = (
    <GraphTooltipContent tooltip={tooltip} scrollRef={scrollRef} heatMapActive={heatMapActive} heatMap={heatMap} />
  );

  // ─── Sidebar rendering (shared between all modes) ──────
  const renderSidebar = (keyPrefix: string) => {
    if (!sidebarTx || !graph.expandedNodeTxid) return null;
    if (sidebarCollapsed) {
      return (
        <button
          onClick={() => dispatch({ type: "SET_SIDEBAR_COLLAPSED", collapsed: false })}
          className="absolute right-0 top-2 z-10 w-5 h-8 bg-card-bg/90 border border-card-border border-r-0 rounded-l transition-colors cursor-pointer flex items-center justify-center hover:bg-surface-inset"
          title={t("graph.showSidebar", { defaultValue: "Show sidebar" })}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      );
    }
    return (
      <AnimatePresence>
        <GraphSidebar
          key={`${keyPrefix}${graph.expandedNodeTxid}`}
          tx={sidebarTx}
          outspends={graph.outspendCache?.get(graph.expandedNodeTxid)}
          onClose={() => graph.toggleExpand(graph.expandedNodeTxid!)}
          onCollapse={() => dispatch({ type: "SET_SIDEBAR_COLLAPSED", collapsed: true })}
          onFullScan={(txid) => props.onTxClick?.(txid)}
          onExpandInput={handleExpandInput}
          onExpandOutput={handleExpandOutput}
          changeOutputs={changeOutputs}
          onToggleChange={toggleChange}
          boltzmannResult={graph.expandedNodeTxid ? getBoltzmannResult(graph.expandedNodeTxid) : undefined}
          computingBoltzmann={graph.expandedNodeTxid ? computingBoltzmann.has(graph.expandedNodeTxid) : false}
          boltzmannProgress={graph.expandedNodeTxid ? boltzmannProgressMap.get(graph.expandedNodeTxid) : undefined}
          onComputeBoltzmann={graph.expandedNodeTxid ? () => triggerBoltzmann(graph.expandedNodeTxid!) : undefined}
          onAutoTrace={props.noAutoTrace ? undefined : graph.autoTrace}
          onAutoTraceLinkability={props.noAutoTrace ? undefined : (txid, outputIndex) => graph.autoTraceLinkability(txid, outputIndex, { boltzmannCache })}
          autoTracing={graph.autoTracing}
          autoTraceProgress={graph.autoTraceProgress}
          onCancelAutoTrace={props.noAutoTrace ? undefined : graph.cancelAutoTrace}
          autoTraceStop={graph.lastAutoTraceStop}
          onSetAsRoot={props.onSetAsRoot}
          onFindConnection={graph.fetcher ? openConnection : undefined}
        />
      </AnimatePresence>
    );
  };

  const zoomProps = { onZoomIn: () => zoomBy(1.25), onZoomOut: () => zoomBy(1 / 1.25), onFitView: handleFitView };

  const lastError = graph.errors.size > 0 && graph.loading.size === 0
    ? [...graph.errors.values()].at(-1)
    : null;

  // ─── Render ────────────────────────────────────────────

  // Standalone fullscreen mode (e.g. /graph page)
  if (props.alwaysFullscreen) {
    return (
      <div className="flex flex-col h-full">
        <div className="pt-4 px-4 space-y-2 shrink-0">
          <GraphToolbar {...toolbarProps} {...zoomProps} />
        </div>
        <GraphViewport
          canvasProps={canvasProps} viewTransform={viewTransform} onViewTransformChange={setViewTransform}
          isFullscreen showSidebar={showSidebar} scrollRef={scrollRef}
          legend={<>{legend}{connectionPanel}</>} tooltipContent={tooltipContent} sidebar={renderSidebar("af-")}
          outerStyle={{ touchAction: "none" }}
        />
        {lastError && <div className="text-xs text-severity-medium/80 px-4 pb-2">{lastError}</div>}
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="graph-canvas relative rounded-xl border border-card-border bg-surface-inset p-4 space-y-3"
      >
        <GraphToolbar {...toolbarProps} compact={compact} onExpandFullscreen={handleExpandFullscreen} />

        {!isExpanded && (
          <div className="relative flex overflow-hidden rounded-lg" style={compactHeight ? { height: compactHeight } : undefined}>
            <GraphViewport
              canvasProps={canvasProps} viewTransform={viewTransform} onViewTransformChange={setViewTransform}
              showSidebar={showSidebar} scrollRef={scrollRef}
              legend={<>{compact ? null : legend}{connectionPanel}</>} tooltipContent={tooltipContent} sidebar={renderSidebar("")}
              scrollClassName={compactHeight ? "overflow-hidden h-full -mx-4 px-4" : "overflow-hidden h-[500px] -mx-4 px-4"}
              outerStyle={{ touchAction: "none" }}
            />
          </div>
        )}
        {compact && !isExpanded && (
          <p className="text-xs text-muted">
            {t("graph.compactHint", { defaultValue: "Expand any input or output with +, or open fullscreen for heat map, fingerprints and linkability." })}
          </p>
        )}

        {graph.nodeCount >= graph.maxNodes && (
          <div className="text-xs text-severity-medium bg-severity-medium/10 border border-severity-medium/20 rounded-lg px-3 py-1.5">
            {t("graphExplorer.maxNodesReached", {
              max: graph.maxNodes,
              defaultValue: "Maximum number of nodes reached ({{max}}). Remove some nodes before expanding further.",
            })}
          </div>
        )}
        {graph.loading.size > 0 && (
          <div className="text-xs text-muted animate-pulse">{t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}</div>
        )}
        {lastError && <div className="text-xs text-severity-medium/80">{lastError}</div>}
      </motion.div>

      {/* Fullscreen modal overlay: portaled so no transformed/sticky ancestor can clip or cover it */}
      {isExpanded && createPortal(
        <div
          role="dialog" aria-modal="true"
          aria-label={t("graphExplorer.fullscreenLabel", { defaultValue: "Transaction graph fullscreen" })}
          className="graph-canvas-backdrop fixed inset-0 z-[100] bg-card-bg/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapseFullscreen(); }}
        >
          <button
            onClick={collapseFullscreen}
            className="fixed top-3 right-3 z-10 text-muted hover:text-foreground transition-colors p-2 rounded-lg bg-card-bg/80 hover:bg-surface-inset backdrop-blur-sm cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <CloseIcon />
          </button>
          <div className="p-4 pr-12 space-y-2 shrink-0">
            <GraphToolbar {...toolbarProps} onSearch={undefined} onLoadSavedGraph={undefined} {...zoomProps} />
          </div>
          <GraphViewport
            canvasProps={canvasProps} viewTransform={viewTransform} onViewTransformChange={setViewTransform}
            isFullscreen showSidebar={showSidebar} scrollRef={scrollRef}
            legend={<>{legend}{connectionPanel}</>} tooltipContent={tooltipContent} sidebar={renderSidebar("fs-")}
            outerStyle={{ touchAction: "none" }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
