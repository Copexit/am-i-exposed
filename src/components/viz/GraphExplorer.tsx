"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { useChartTooltip } from "./shared/ChartTooltip";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGraphBoltzmann } from "@/hooks/useGraphBoltzmann";
import { GraphSidebar } from "./graph/GraphSidebar";
import { MAX_ZOOM, MIN_ZOOM } from "./graph/constants";
import { layoutGraph } from "./graph/layout";
import { CloseIcon } from "./graph/icons";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphLegend } from "./graph/GraphLegend";
import { GraphTooltipContent } from "./graph/GraphTooltipContent";
import { GraphViewport } from "./graph/GraphViewport";
import { useGraphExplorerState } from "./graph/useGraphExplorerState";
import { useGraphHeatMap } from "./graph/useGraphHeatMap";
import { useChangeOutputDetection } from "./graph/useChangeOutputDetection";
import type { GraphExplorerProps, TooltipData, NodeFilter, ViewTransform, LayoutNode } from "./graph/types";
import type { GraphAnnotation, SavedGraph } from "@/lib/graph/saved-graph-types";

// Re-export types for consumers that import from this file
export type { GraphExplorerProps } from "./graph/types";

/** Vertical padding subtracted from window.innerHeight for viewport calculations. */
const VIEWPORT_PAD_Y = 160;
/** Minimum horizontal margin on each side for small screens. */
const MIN_MARGIN_X = 16;

/** Compute the usable viewport dimensions (window minus padding). */
function getViewportDims() {
  // On small screens (<400px), use tighter padding to maximize usable space.
  const padX = Math.max(MIN_MARGIN_X * 2, Math.min(48, window.innerWidth * 0.08));
  return { cw: window.innerWidth - padX, ch: window.innerHeight - VIEWPORT_PAD_Y };
}

/** Compute a ViewTransform that centers the root nodes within the viewport. */
function computeRootCenterView(roots: LayoutNode[]): ViewTransform {
  const { cw, ch } = getViewportDims();
  if (roots.length === 0) return { x: 0, y: 0, scale: 1 };
  const avgX = roots.reduce((s, n) => s + n.x + n.width / 2, 0) / roots.length;
  const avgY = roots.reduce((s, n) => s + n.y + n.height / 2, 0) / roots.length;
  return { x: cw / 2 - avgX, y: ch / 2 - avgY, scale: 1 };
}

/** Compute a ViewTransform that fits all layout nodes within the viewport. */
function computeFitView(ln: LayoutNode[]): ViewTransform | null {
  if (ln.length === 0) return null;
  const { cw, ch } = getViewportDims();
  const minX = Math.min(...ln.map((n) => n.x));
  const minY = Math.min(...ln.map((n) => n.y));
  const maxX = Math.max(...ln.map((n) => n.x + n.width));
  const maxY = Math.max(...ln.map((n) => n.y + n.height));
  const nodesW = maxX - minX;
  const nodesH = maxY - minY;
  const s = Math.min(cw / nodesW, ch / nodesH, 1.5);
  const rawX = (cw - nodesW * s) / 2 - minX * s;
  // Ensure nodes don't clip the left edge on small screens
  const x = Math.max(rawX, MIN_MARGIN_X - minX * s);
  return { x, y: (ch - nodesH * s) / 2 - minY * s, scale: s };
}

/**
 * OXT-style interactive graph explorer.
 *
 * Renders an expandable transaction DAG where each node represents a transaction.
 * Users can click inputs (left side) to expand backward or outputs (right side)
 * to expand forward. Nodes are colored by privacy grade and entity attribution.
 */
export function GraphExplorer(props: GraphExplorerProps) {
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
    nodePositionsRef,
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
  const sidebarTx = props.expandedNodeTxid ? props.nodes.get(props.expandedNodeTxid)?.tx : undefined;
  const showSidebar = !!sidebarTx && !sidebarCollapsed;

  // Seed new nodes near their trigger node.
  // Track the trigger position for the next expansion (backward or forward).
  const pendingSeedRef = useRef<{ triggerTxid: string; direction: "backward" | "forward"; x: number; y: number } | null>(null);
  const prevNodeKeysRef = useRef<Set<string>>(new Set());

  // When nodes change, detect new nodes and seed their position
  useEffect(() => {
    const seed = pendingSeedRef.current;
    if (!seed) { prevNodeKeysRef.current = new Set(props.nodes.keys()); return; }
    const prevKeys = prevNodeKeysRef.current;
    for (const txid of props.nodes.keys()) {
      if (!prevKeys.has(txid)) {
        dispatch({ type: "SET_NODE_POSITION", txid, x: seed.x, y: seed.y });
        pendingSeedRef.current = null;
        break;
      }
    }
    prevNodeKeysRef.current = new Set(props.nodes.keys());
  }, [props.nodes, dispatch]);

  const { onExpandInput, onExpandOutput } = props;

  const handleExpandInput = useCallback((txid: string, inputIndex: number) => {
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      pendingSeedRef.current = { triggerTxid: txid, direction: "backward", x: triggerPos.x - 280, y: triggerPos.y };
    }
    onExpandInput?.(txid, inputIndex);
  }, [onExpandInput, nodePositionsRef]);

  const handleExpandOutput = useCallback((txid: string, outputIndex: number) => {
    const triggerPos = nodePositionsRef.current.get(txid);
    if (triggerPos) {
      pendingSeedRef.current = { triggerTxid: txid, direction: "forward", x: triggerPos.x + triggerPos.w + 100, y: triggerPos.y };
    }
    onExpandOutput?.(txid, outputIndex);
  }, [onExpandOutput, nodePositionsRef]);

  // ─── Boltzmann ─────────────────────────────────────────
  const {
    getBoltzmannResult, triggerBoltzmann,
    computingBoltzmann, boltzmannProgressMap, boltzmannCache,
  } = useGraphBoltzmann({
    nodes: props.nodes,
    rootTxid: props.rootTxid,
    rootBoltzmannResult: props.rootBoltzmannResult,
  });

  const hasLinkability = !!props.rootBoltzmannResult || boltzmannCache.size > 0;
  const cycleEdgeMode = useCallback(() => {
    dispatch({ type: "CYCLE_EDGE_MODE", hasLinkability });
  }, [hasLinkability, dispatch]);

  // Fullscreen toggle
  const { isExpanded, expand: expandFullscreen, collapse: collapseFullscreen } = useFullscreen(handleFullscreenExit);

  // Zoom helper
  const zoomBy = useCallback((factor: number) => {
    if (!viewTransform) return;
    const { cw, ch } = getViewportDims();
    const cx = cw / 2;
    const cy = ch / 2;
    const gx = (cx - viewTransform.x) / viewTransform.scale;
    const gy = (cy - viewTransform.y) / viewTransform.scale;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewTransform.scale * factor));
    dispatch({ type: "SET_VIEW_TRANSFORM", vt: { x: cx - gx * s, y: cy - gy * s, scale: s } });
  }, [viewTransform, dispatch]);

  // ─── Heat map computation ──────────────────────────────
  useGraphHeatMap({ active: heatMapActive, nodes: props.nodes, dispatch });

  // ─── Auto-mark change outputs ──────────────────────────
  useChangeOutputDetection({ nodes: props.nodes, dispatch, userToggledRef });

  // ─── Layout helpers ────────────────────────────────────
  const hiddenCount = props.nodeCount - visibleCount;

  const handleExpandFullscreen = useCallback(() => {
    expandFullscreen();
    const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids, undefined, true);
    dispatch({ type: "SET_VIEW_TRANSFORM", vt: computeRootCenterView(ln.filter((n) => n.isRoot)) });
  }, [expandFullscreen, props.nodes, props.rootTxid, filter, props.rootTxids, dispatch]);

  const handleFitView = useCallback(() => {
    const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids, undefined, true);
    const vt = computeFitView(ln);
    if (vt) dispatch({ type: "SET_VIEW_TRANSFORM", vt });
  }, [props.nodes, props.rootTxid, filter, props.rootTxids, dispatch]);

  // Auto-center on root change in alwaysFullscreen mode
  const prevRootRef = useRef<string>("");
  useEffect(() => {
    if (!props.alwaysFullscreen || !props.rootTxid || props.nodes.size === 0) return;
    if (prevRootRef.current === props.rootTxid) return;
    prevRootRef.current = props.rootTxid;
    requestAnimationFrame(() => {
      const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids, undefined, true);
      const roots = ln.filter((n) => n.isRoot);
      if (roots.length > 0) dispatch({ type: "SET_VIEW_TRANSFORM", vt: computeRootCenterView(roots) });
    });
  }, [props.alwaysFullscreen, props.rootTxid, props.nodes, filter, props.rootTxids, dispatch]);

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
  const { onUndo, onReset } = props;
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
        case "u": onUndo?.(); break;
        case "r": onReset?.(); break;
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
  }, [handleToggleHeatMap, handleToggleFingerprint, cycleEdgeMode, isExpanded, collapseFullscreen, handleExpandFullscreen, onUndo, onReset, zoomBy, handleFitView, dispatch]);

  // Early return for empty graph (but not alwaysFullscreen)
  if (props.nodes.size === 0 && !props.alwaysFullscreen) return null;

  // ─── Shared prop objects ───────────────────────────────

  const toolbarProps = {
    nodeCount: props.nodeCount, maxNodes: props.maxNodes, hiddenCount,
    heatMapActive, heatProgress, fingerprintMode, edgeMode,
    onToggleHeatMap: handleToggleHeatMap, onToggleFingerprint: handleToggleFingerprint,
    canUndo: props.canUndo ?? false, onUndo: props.onUndo ?? (() => {}),
    onCycleEdgeMode: cycleEdgeMode, onReset: props.onReset,
    onSearch: props.onSearch, searchLoading: props.searchLoading, searchError: props.searchError,
    currentTxid: props.rootTxid || null, currentLabel: props.currentLabel ?? null,
    nodes: props.nodes, rootTxid: props.rootTxid, rootTxids: props.rootTxids,
    network: props.network, currentGraphId: props.currentGraphId ?? null,
    onLoadSavedGraph: onLoadSavedGraph ? handleLoadSavedGraph : undefined,
    onRegisterHandlers: (handlers: Record<string, () => void>) => { tbHandlersRef.current = handlers; },
    annotateMode, onToggleAnnotateMode: () => dispatch({ type: "TOGGLE_ANNOTATE_MODE" }),
    nodePositionOverrides, annotations, nodeLabels, edgeLabels,
  };

  const canvasProps = {
    ...props,
    onExpandInput: handleExpandInput,
    onExpandOutput: handleExpandOutput,
    tooltip, scrollRef, filter, hoveredNode,
    setHoveredNode: (txid: string | null) => dispatch({ type: "SET_HOVERED_NODE", txid }),
    selectedNode,
    setSelectedNode: (node: { txid: string; x: number; y: number } | null) => dispatch({ type: "SET_SELECTED_NODE", node }),
    focusedNode,
    setFocusedNode: (txid: string | null) => dispatch({ type: "SET_FOCUSED_NODE", txid }),
    heatMap, heatMapActive, linkabilityEdgeMode, fingerprintMode, entropyGradientMode,
    changeOutputs, onLayoutComplete: handleLayoutComplete, boltzmannCache,
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
    if (!sidebarTx || !props.expandedNodeTxid) return null;
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
          key={`${keyPrefix}${props.expandedNodeTxid}`}
          tx={sidebarTx}
          outspends={props.outspendCache?.get(props.expandedNodeTxid)}
          onClose={() => props.onToggleExpand?.(props.expandedNodeTxid!)}
          onCollapse={() => dispatch({ type: "SET_SIDEBAR_COLLAPSED", collapsed: true })}
          onFullScan={(txid) => props.onTxClick?.(txid)}
          onExpandInput={handleExpandInput}
          onExpandOutput={handleExpandOutput}
          changeOutputs={changeOutputs}
          onToggleChange={toggleChange}
          boltzmannResult={props.expandedNodeTxid ? getBoltzmannResult(props.expandedNodeTxid) : undefined}
          computingBoltzmann={props.expandedNodeTxid ? computingBoltzmann.has(props.expandedNodeTxid) : false}
          boltzmannProgress={props.expandedNodeTxid ? boltzmannProgressMap.get(props.expandedNodeTxid) : undefined}
          onComputeBoltzmann={props.expandedNodeTxid ? () => triggerBoltzmann(props.expandedNodeTxid!) : undefined}
          onAutoTrace={props.onAutoTrace}
          onAutoTraceLinkability={props.onAutoTraceLinkability}
          autoTracing={props.autoTracing}
          autoTraceProgress={props.autoTraceProgress}
          onSetAsRoot={props.onSetAsRoot}
        />
      </AnimatePresence>
    );
  };

  const zoomProps = { onZoomIn: () => zoomBy(1.25), onZoomOut: () => zoomBy(1 / 1.25), onFitView: handleFitView };

  const lastError = props.errors.size > 0 && props.loading.size === 0
    ? [...props.errors.values()].at(-1)
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
        <GraphToolbar {...toolbarProps} onExpandFullscreen={handleExpandFullscreen} />

        {!isExpanded && (
          <div className="relative flex overflow-hidden rounded-lg">
            <GraphViewport
              canvasProps={canvasProps} showSidebar={showSidebar} scrollRef={scrollRef}
              legend={legend} tooltipContent={tooltipContent} sidebar={renderSidebar("")}
              scrollClassName="overflow-auto max-h-[900px] -mx-4 px-4"
            />
          </div>
        )}

        {props.nodeCount >= props.maxNodes && (
          <div className="text-xs text-severity-medium bg-severity-medium/10 border border-severity-medium/20 rounded-lg px-3 py-1.5">
            {t("graphExplorer.maxNodesReached", {
              max: props.maxNodes,
              defaultValue: "Maximum number of nodes reached ({{max}}). Remove some nodes before expanding further.",
            })}
          </div>
        )}
        {props.loading.size > 0 && (
          <div className="text-xs text-muted animate-pulse">{t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}</div>
        )}
        {lastError && <div className="text-xs text-severity-medium/80">{lastError}</div>}
      </motion.div>

      {/* Fullscreen modal overlay */}
      {isExpanded && (
        <div
          role="dialog" aria-modal="true"
          aria-label={t("graphExplorer.fullscreenLabel", { defaultValue: "Transaction graph fullscreen" })}
          className="fixed inset-0 z-50 bg-card-bg/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapseFullscreen(); }}
        >
          <button
            onClick={collapseFullscreen}
            className="fixed top-3 right-3 z-[60] text-muted hover:text-foreground transition-colors p-2 rounded-lg bg-card-bg/80 hover:bg-surface-inset backdrop-blur-sm cursor-pointer"
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
        </div>
      )}
    </>
  );
}
