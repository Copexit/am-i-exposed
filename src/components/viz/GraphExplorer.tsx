"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { useChartTooltip } from "./shared/ChartTooltip";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGraphBoltzmann } from "@/hooks/useGraphBoltzmann";
import { GraphSidebar } from "./graph/GraphSidebar";
import { MAX_ZOOM, MIN_ZOOM } from "./graph/constants";
import {
  layoutGraph, computeFitView, computeCompactView, computeRootCenterView, getViewportDims, findFreeY,
  SEED_BACKWARD_DX, SEED_FORWARD_GAP,
} from "./graph/layout";
import { CloseIcon } from "./graph/icons";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphLegend } from "./graph/GraphLegend";
import { GraphTooltipContent } from "./graph/GraphTooltipContent";
import { GraphViewport } from "./graph/GraphViewport";
import { useGraphExplorerState } from "./graph/useGraphExplorerState";
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
    handleNodePositionChange, handleSetNodeLabel, handleSetEdgeLabel,
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
  } = state;

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
    findFreeY(x, y, [nodePositionsRef.current, nodePositionOverrides], excludeTxid),
  [nodePositionsRef, nodePositionOverrides]);

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

  // Seed position before any expand (backward or forward, node button or port)
  const seedBackward = useCallback((txid: string) => {
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      const targetX = triggerPos.x - SEED_BACKWARD_DX;
      const y = freeY(targetX, triggerPos.y);
      pendingSeedRef.current = { triggerTxid: txid, direction: "backward", x: targetX, y };
    }
  }, [nodePositionsRef, freeY]);

  const seedForward = useCallback((txid: string) => {
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      const targetX = triggerPos.x + triggerPos.w + SEED_FORWARD_GAP;
      const y = freeY(targetX, triggerPos.y);
      pendingSeedRef.current = { triggerTxid: txid, direction: "forward", x: targetX, y };
    }
  }, [nodePositionsRef, freeY]);

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

  const handleFitView = useCallback(() => {
    const { layoutNodes: ln } = layoutGraph(graph.nodes, graph.rootTxid, filter, graph.rootTxids, undefined, true);
    const vt = computeFitView(ln, containerDimsRef.current);
    if (vt) dispatch({ type: "SET_VIEW_TRANSFORM", vt });
  }, [graph.nodes, graph.rootTxid, filter, graph.rootTxids, dispatch, containerDimsRef]);

  const handleExpandFullscreen = useCallback(() => {
    pendingFrameRef.current = true;
    expandFullscreen();
  }, [expandFullscreen]);

  const onLayoutComplete = useCallback((info: Parameters<typeof handleLayoutComplete>[0]) => {
    handleLayoutComplete(info);
    if (!pendingFrameRef.current || info.containerHeight <= 0) return;
    pendingFrameRef.current = false;
    // rAF: run after GraphCanvas's own first-render root centering
    requestAnimationFrame(() => {
      if (isExpanded) { handleFitView(); return; }
      const { layoutNodes: ln } = layoutGraph(graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, false, nodePositionOverrides);
      const vt = computeCompactView(ln, containerDimsRef.current);
      if (vt) dispatch({ type: "SET_VIEW_TRANSFORM", vt });
    });
  }, [handleLayoutComplete, handleFitView, isExpanded, graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, nodePositionOverrides, containerDimsRef, dispatch]);

  // Auto-center on root change in alwaysFullscreen mode.
  // GraphCanvas handles first-render centering (it knows the real container dims).
  // This effect handles subsequent root changes (e.g., navigating to a new txid).
  const prevRootRef = useRef<string>("");
  useEffect(() => {
    if (!props.alwaysFullscreen || !graph.rootTxid || graph.nodes.size === 0) return;
    if (prevRootRef.current === graph.rootTxid) return;
    prevRootRef.current = graph.rootTxid;
    // Skip if containerDims not yet populated (first render handled by GraphCanvas)
    const dims = containerDimsRef.current;
    if (!dims || dims.width === 0) return;
    const { layoutNodes: ln } = layoutGraph(graph.nodes, graph.rootTxid, filter, graph.rootTxids, undefined, true);
    const roots = ln.filter((n) => n.isRoot);
    if (roots.length > 0) dispatch({ type: "SET_VIEW_TRANSFORM", vt: computeRootCenterView(roots, dims) });
  }, [props.alwaysFullscreen, graph.rootTxid, graph.nodes, filter, graph.rootTxids, dispatch, containerDimsRef]);

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
  const { undo, reset } = graph;
  const tbHandlersRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); tbHandlersRef.current.save?.(); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      switch (e.key) {
        case "h": handleToggleHeatMap(); break;
        case "g": handleToggleFingerprint(); break;
        case "l": cycleEdgeMode(); break;
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
  }, [handleToggleHeatMap, handleToggleFingerprint, cycleEdgeMode, isExpanded, collapseFullscreen, handleExpandFullscreen, undo, reset, zoomBy, handleFitView, dispatch]);

  // Compact inline: canvas height fits the laid-out graph (260-500px).
  const compactHeight = useMemo(() => {
    if (!compact) return undefined;
    const { height } = layoutGraph(graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, false, nodePositionOverrides);
    return Math.min(500, Math.max(260, height + 48));
  }, [compact, graph.nodes, graph.rootTxid, filter, graph.rootTxids, graph.expandedNodeTxid, nodePositionOverrides]);

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
    nodePositionOverrides, annotations, nodeLabels, edgeLabels,
  };

  const canvasProps = {
    nodes: graph.nodes, rootTxid: graph.rootTxid, rootTxids: graph.rootTxids,
    walletUtxos: props.walletUtxos, loading: graph.loading,
    nodeCount: graph.nodeCount, maxNodes: graph.maxNodes,
    onCollapse: graph.collapse, rootBoltzmannResult: props.rootBoltzmannResult,
    expandedNodeTxid: graph.expandedNodeTxid, onToggleExpand: graph.toggleExpand,
    outspendCache: graph.outspendCache,
    onExpandInput: handleExpandInput,
    onExpandOutput: handleExpandOutput,
    onExpandPortInput: handleExpandPortInput,
    onExpandPortOutput: handleExpandPortOutput,
    tooltip, scrollRef, filter, hoveredNode,
    setHoveredNode: (txid: string | null) => dispatch({ type: "SET_HOVERED_NODE", txid }),
    selectedNode,
    setSelectedNode: (node: { txid: string; x: number; y: number } | null) => dispatch({ type: "SET_SELECTED_NODE", node }),
    focusedNode,
    setFocusedNode: (txid: string | null) => dispatch({ type: "SET_FOCUSED_NODE", txid }),
    heatMap, heatMapActive, linkabilityEdgeMode, fingerprintMode, entropyGradientMode,
    changeOutputs, onLayoutComplete, boltzmannCache,
    nodePositionOverrides, onNodePositionChange: handleNodePositionChange,
    annotations, annotateMode, onAnnotationsChange: setAnnotations,
    nodeLabels, onSetNodeLabel: handleSetNodeLabel, edgeLabels, onSetEdgeLabel: handleSetEdgeLabel,
  };

  const legend = (
    <GraphLegend
      filter={filter}
      onToggleFilter={(key: keyof NodeFilter) => dispatch({ type: "TOGGLE_FILTER", key })}
      fingerprintMode={fingerprintMode}
      changeOutputs={changeOutputs}
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
          legend={legend} tooltipContent={tooltipContent} sidebar={renderSidebar("af-")}
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
        className="relative rounded-xl border border-card-border bg-surface-inset p-4 space-y-3"
      >
        <GraphToolbar {...toolbarProps} compact={compact} onExpandFullscreen={handleExpandFullscreen} />

        {!isExpanded && (
          <div className="relative flex overflow-hidden rounded-lg" style={compactHeight ? { height: compactHeight } : undefined}>
            <GraphViewport
              canvasProps={canvasProps} viewTransform={viewTransform} onViewTransformChange={setViewTransform}
              showSidebar={showSidebar} scrollRef={scrollRef}
              legend={compact ? null : legend} tooltipContent={tooltipContent} sidebar={renderSidebar("")}
              scrollClassName={compactHeight ? "overflow-hidden h-full -mx-4 px-4" : "overflow-hidden h-[500px] -mx-4 px-4"}
              outerStyle={{ touchAction: "none" }}
            />
          </div>
        )}
        {compact && !isExpanded && (
          <p className="text-xs text-muted">
            {t("v2.graph.compactHint", { defaultValue: "Expand any input or output with +, or open fullscreen for heat map, fingerprints and linkability." })}
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
          className="fixed inset-0 z-[100] bg-card-bg/80 backdrop-blur-sm flex flex-col"
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
            legend={legend} tooltipContent={tooltipContent} sidebar={renderSidebar("fs-")}
            outerStyle={{ touchAction: "none" }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
