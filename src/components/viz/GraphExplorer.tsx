"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "./shared/svgConstants";
import { probColor } from "./shared/linkabilityColors";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { truncateId } from "@/lib/constants";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useGraphBoltzmann } from "@/hooks/useGraphBoltzmann";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { GraphSidebar, SIDEBAR_WIDTH } from "./graph/GraphSidebar";
import { ENTITY_CATEGORY_COLORS, MAX_ZOOM, MIN_ZOOM } from "./graph/constants";
import { layoutGraph } from "./graph/layout";
import { computeFitTransform } from "./graph/edge-utils";
import { GraphCanvas } from "./graph/GraphCanvas";
import { CloseIcon } from "./graph/icons";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphLegend } from "./graph/GraphLegend";
import { entropyColor } from "./graph/privacyGradient";
import type { GraphExplorerProps, TooltipData, NodeFilter, ViewTransform } from "./graph/types";
import type { ScoringResult } from "@/lib/types";

// Re-export types for consumers that import from this file
export type { GraphExplorerProps } from "./graph/types";

/**
 * OXT-style interactive graph explorer.
 *
 * Renders an expandable transaction DAG where each node represents a transaction.
 * Users can click inputs (left side) to expand backward or outputs (right side)
 * to expand forward. Nodes are colored by privacy grade and entity attribution.
 *
 * Features: fullscreen mode, entity category colors, OFAC warnings, hover glow,
 * edge highlighting, click-to-analyze panel, minimap, node filtering, keyboard nav,
 * path tracing, risk heat map, SVG export.
 */
export function GraphExplorer(props: GraphExplorerProps) {
  const { t } = useTranslation();
  const tooltip = useChartTooltip<TooltipData>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // State
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<{ txid: string; x: number; y: number } | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<NodeFilter>({ showCoinJoin: true, showEntity: true, showStandard: true });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // View transform for fullscreen pan/zoom
  const [viewTransform, setViewTransform] = useState<ViewTransform | undefined>(undefined);

  // Fullscreen toggle (onExit clears selection + view transform)
  const handleFullscreenExit = useCallback(() => {
    setSelectedNode(null);
    setViewTransform(undefined);
  }, []);
  const { isExpanded, expand: expandFullscreen, collapse: collapseFullscreen } = useFullscreen(handleFullscreenExit);

  // Edge coloring mode: mutually exclusive. Only one active at a time.
  type EdgeMode = "default" | "linkability" | "entropy";
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("default");
  const hasLinkability = !!props.rootBoltzmannResult;
  const linkabilityEdgeMode = edgeMode === "linkability";
  const entropyGradientMode = edgeMode === "entropy";

  const cycleEdgeMode = useCallback(() => {
    setEdgeMode((prev) => {
      if (prev === "default") return hasLinkability ? "linkability" : "entropy";
      if (prev === "linkability") return "entropy";
      return "default";
    });
  }, [hasLinkability]);

  // Heat map state
  const [heatMapActive, setHeatMapActive] = useState(false);
  const [heatMap, setHeatMap] = useState<Map<string, ScoringResult>>(new Map());
  const [heatProgress, setHeatProgress] = useState(0);

  // Fingerprint mode (mutually exclusive with heat map)
  const [fingerprintMode, setFingerprintMode] = useState(false);

  // Change marking state - auto-populated from heuristics, user can toggle
  const [changeOutputs, setChangeOutputs] = useState<Set<string>>(new Set());
  const userToggledRef = useRef<Set<string>>(new Set()); // tracks manual overrides
  const toggleChange = useCallback((txid: string, outputIndex: number) => {
    const key = `${txid}:${outputIndex}`;
    userToggledRef.current.add(key); // remember user explicitly toggled this
    setChangeOutputs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Incrementally auto-mark change outputs using heuristics for newly added nodes only.
  // Tracks which txids have been analyzed to avoid re-running heuristics on every graph update.
  const analyzedChangeTxidsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newKeys = new Set<string>();
    let hasNew = false;
    for (const [txid, node] of props.nodes) {
      if (analyzedChangeTxidsRef.current.has(txid)) continue;
      analyzedChangeTxidsRef.current.add(txid);
      hasNew = true;
      const result = analyzeChangeDetection(node.tx);
      for (const finding of result.findings) {
        if (finding.id === "h2-change-detected" && finding.params) {
          const idx = finding.params.changeIndex;
          if (typeof idx === "number") newKeys.add(`${txid}:${idx}`);
        }
        if ((finding.id === "h2-same-address-io" || finding.id === "h2-self-send") && finding.params) {
          const indicesStr = finding.params.selfSendIndices;
          if (typeof indicesStr === "string" && indicesStr.length > 0) {
            for (const idx of indicesStr.split(",")) {
              const n = parseInt(idx, 10);
              if (!isNaN(n)) newKeys.add(`${txid}:${n}`);
            }
          }
        }
      }
    }
    // Clean up analyzed set for removed nodes
    for (const txid of analyzedChangeTxidsRef.current) {
      if (!props.nodes.has(txid)) analyzedChangeTxidsRef.current.delete(txid);
    }
    if (!hasNew) return;
    // Merge new auto-marks into existing set (user overrides take precedence)
    setChangeOutputs((prev) => {
      const next = new Set(prev);
      for (const key of newKeys) {
        if (!userToggledRef.current.has(key)) next.add(key);
      }
      return next;
    });
  }, [props.nodes]);

  // Sidebar tx data (available when a node is expanded, regardless of collapsed state)
  const sidebarTx = props.expandedNodeTxid ? props.nodes.get(props.expandedNodeTxid)?.tx : undefined;
  const showSidebar = !!sidebarTx && !sidebarCollapsed;

  // ─── Boltzmann (extracted to custom hook) ──────────────
  const {
    getBoltzmannResult,
    triggerBoltzmann,
    computingBoltzmannRef,
    boltzmannProgressMap,
    boltzmannCache,
  } = useGraphBoltzmann({
    nodes: props.nodes,
    rootTxid: props.rootTxid,
    rootBoltzmannResult: props.rootBoltzmannResult,
  });

  // Zoom toward center helper
  const zoomBy = useCallback((factor: number) => {
    if (!viewTransform) return;
    const cw = window.innerWidth - 32;
    const ch = window.innerHeight - 160;
    const cx = cw / 2;
    const cy = ch / 2;
    const gx = (cx - viewTransform.x) / viewTransform.scale;
    const gy = (cy - viewTransform.y) / viewTransform.scale;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewTransform.scale * factor));
    setViewTransform({ x: cx - gx * s, y: cy - gy * s, scale: s });
  }, [viewTransform]);

  // Heat map computation - uses rAF for chunking, updates state only on completion
  const heatResultsRef = useRef<Map<string, ScoringResult>>(new Map());
  useEffect(() => {
    if (!heatMapActive) return;
    const analyze = analyzeTransactionSync;
    const nodeEntries = Array.from(props.nodes.entries());
    const results = heatResultsRef.current;
    let idx = 0;
    let cancelled = false;

    function processNext() {
      if (cancelled) return;
      const start = performance.now();
      while (idx < nodeEntries.length && performance.now() - start < 16) {
        const [txid, gn] = nodeEntries[idx];
        if (!results.has(txid)) {
          results.set(txid, analyze(gn.tx));
        }
        idx++;
        setHeatProgress(Math.round((idx / nodeEntries.length) * 100));
      }
      if (idx < nodeEntries.length) {
        requestAnimationFrame(processNext);
      } else {
        // Single state update after all nodes processed
        setHeatMap(new Map(results));
      }
    }

    processNext();
    return () => { cancelled = true; };
  }, [heatMapActive, props.nodes]);

  // Count hidden nodes
  const totalNodes = props.nodeCount;
  const [visibleCount, setVisibleCount] = useState(totalNodes);
  const handleLayoutComplete = useCallback((info: { visibleCount: number }) => {
    setVisibleCount(info.visibleCount);
  }, []);
  const hiddenCount = totalNodes - visibleCount;

  // ─── Toolbar helpers (must be before early return for hooks rules) ───

  const handleToggleHeatMap = useCallback(() => {
    setHeatMapActive(!heatMapActive);
    if (!heatMapActive) setFingerprintMode(false);
  }, [heatMapActive]);

  const handleToggleFingerprint = useCallback(() => {
    setFingerprintMode(!fingerprintMode);
    if (!fingerprintMode) setHeatMapActive(false);
  }, [fingerprintMode]);

  const handleExpandFullscreen = useCallback(() => {
    expandFullscreen();
    const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
    const roots = ln.filter((n) => n.isRoot);
    const cw = window.innerWidth - 32;
    const ch = window.innerHeight - 160;
    if (roots.length > 0) {
      const avgX = roots.reduce((s, n) => s + n.x + n.width / 2, 0) / roots.length;
      const avgY = roots.reduce((s, n) => s + n.y + n.height / 2, 0) / roots.length;
      setViewTransform({ x: cw / 2 - avgX, y: ch / 2 - avgY, scale: 1 });
    } else {
      setViewTransform({ x: 0, y: 0, scale: 1 });
    }
  }, [expandFullscreen, props.nodes, props.rootTxid, filter, props.rootTxids]);

  const handleFitView = useCallback(() => {
    const { width: gw, height: gh } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
    const cw = window.innerWidth - 32;
    const ch = window.innerHeight - 160;
    setViewTransform(computeFitTransform(gw, gh, cw, ch));
  }, [props.nodes, props.rootTxid, filter, props.rootTxids]);

  // Auto-center root node on mount in alwaysFullscreen mode
  const didAutoCenter = useRef(false);
  useEffect(() => {
    if (!props.alwaysFullscreen || didAutoCenter.current || props.nodes.size === 0) return;
    didAutoCenter.current = true;
    // Delay to let the layout compute after first render
    const timer = setTimeout(() => {
      const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
      const roots = ln.filter((n) => n.isRoot);
      const cw = window.innerWidth - 32;
      const ch = window.innerHeight - 160;
      if (roots.length > 0) {
        const avgX = roots.reduce((s, n) => s + n.x + n.width / 2, 0) / roots.length;
        const avgY = roots.reduce((s, n) => s + n.y + n.height / 2, 0) / roots.length;
        setViewTransform({ x: cw / 2 - avgX, y: ch / 2 - avgY, scale: 1 });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [props.alwaysFullscreen, props.nodes, props.rootTxid, filter, props.rootTxids]);

  // ─── Global keyboard shortcuts for graph modes ───────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "h": handleToggleHeatMap(); break;
        case "g": handleToggleFingerprint(); break;
        case "l": cycleEdgeMode(); break;
        case "f":
          if (isExpanded) collapseFullscreen();
          else handleExpandFullscreen();
          break;
        case "Escape":
          if (isExpanded) collapseFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleToggleHeatMap, handleToggleFingerprint, cycleEdgeMode, isExpanded, collapseFullscreen, handleExpandFullscreen]);

  if (props.nodes.size === 0) return null;

  // Toggle filter helpers
  const toggleFilter = (key: keyof NodeFilter) => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toolbarProps = {
    nodeCount: props.nodeCount,
    maxNodes: props.maxNodes,
    hiddenCount,
    heatMapActive,
    heatProgress,
    fingerprintMode,
    edgeMode,
    onToggleHeatMap: handleToggleHeatMap,
    onToggleFingerprint: handleToggleFingerprint,
    canUndo: props.canUndo ?? false,
    onUndo: props.onUndo ?? (() => {}),
    onCycleEdgeMode: cycleEdgeMode,
    onReset: props.onReset,
  };

  // ─── Legend (extracted to GraphLegend component) ────────

  const legend = (
    <GraphLegend
      filter={filter}
      onToggleFilter={toggleFilter}
      fingerprintMode={fingerprintMode}
      changeOutputs={changeOutputs}
    />
  );

  // ─── Shared canvas props ───────────────────────────────

  const canvasProps = {
    ...props,
    tooltip,
    scrollRef,
    filter,
    hoveredNode,
    setHoveredNode,
    selectedNode,
    setSelectedNode,
    focusedNode,
    setFocusedNode,
    heatMap,
    heatMapActive,
    linkabilityEdgeMode,
    fingerprintMode,
    entropyGradientMode,
    changeOutputs,
    onLayoutComplete: handleLayoutComplete,
    boltzmannCache,
  };

  const fullscreenCanvasProps = {
    ...canvasProps,
    viewTransform,
    onViewTransformChange: setViewTransform,
  };

  // ─── Sidebar rendering (shared between inline and fullscreen) ────

  const renderSidebar = (keyPrefix: string) => {
    if (!sidebarTx || !props.expandedNodeTxid) return null;

    if (sidebarCollapsed) {
      return (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute right-0 top-2 z-10 w-5 h-8 bg-card-bg/90 border border-card-border border-r-0 rounded-l transition-colors cursor-pointer flex items-center justify-center hover:bg-surface-inset"
          title="Show sidebar"
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
          onCollapse={() => setSidebarCollapsed(true)}
          onFullScan={(txid) => props.onTxClick?.(txid)}
          onExpandInput={props.onExpandInput}
          onExpandOutput={props.onExpandOutput}
          changeOutputs={changeOutputs}
          onToggleChange={toggleChange}
          boltzmannResult={props.expandedNodeTxid ? getBoltzmannResult(props.expandedNodeTxid) : undefined}
          computingBoltzmann={props.expandedNodeTxid ? computingBoltzmannRef.current.has(props.expandedNodeTxid) : false}
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

  // ─── Tooltip content ──────────────────────────────────

  const tooltipContent = tooltip.tooltipOpen && tooltip.tooltipData && (
    <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft} containerRef={scrollRef}>
      {tooltip.tooltipData.linkProb !== undefined || tooltip.tooltipData.entropyNormalized !== undefined ? (
        /* Edge hover: linkability or entropy chip */
        <div className="flex items-center gap-2">
          {tooltip.tooltipData.linkProb !== undefined && (
            <div className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(tooltip.tooltipData.linkProb), display: "inline-block", flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: SVG_COLORS.foreground }}>{Math.round(tooltip.tooltipData.linkProb * 100)}% linkability</span>
            </div>
          )}
          {tooltip.tooltipData.entropyNormalized !== undefined && (
            <div className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: entropyColor(tooltip.tooltipData.entropyNormalized), display: "inline-block", flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: SVG_COLORS.foreground }}>
                {(tooltip.tooltipData.entropyBits ?? 0).toFixed(2)} bits effective entropy
              </span>
            </div>
          )}
        </div>
      ) : (
      /* Node hover: minimal chip - only data NOT already on the canvas label */
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs" style={{ color: SVG_COLORS.muted }}>{truncateId(tooltip.tooltipData.txid, 6)}</span>
        {tooltip.tooltipData.entityLabel ? (
          <span className="text-xs font-medium" style={{ color: ENTITY_CATEGORY_COLORS[tooltip.tooltipData.entityCategory ?? "unknown"] }}>
            {tooltip.tooltipData.entityLabel}
            {tooltip.tooltipData.entityOfac && <span style={{ color: SVG_COLORS.critical }}> OFAC</span>}
          </span>
        ) : tooltip.tooltipData.isCoinJoin ? (
          <span className="text-xs font-medium" style={{ color: SVG_COLORS.good }}>
            {tooltip.tooltipData.coinJoinType ?? "CoinJoin"}
          </span>
        ) : null}
        <span className="text-xs" style={{ color: SVG_COLORS.muted }}>{tooltip.tooltipData.feeRate} sat/vB</span>
        {!tooltip.tooltipData.confirmed && (
          <span className="text-xs font-medium" style={{ color: SVG_COLORS.medium }}>Unconfirmed</span>
        )}
        {(() => {
          const heatEntry = heatMapActive ? heatMap.get(tooltip.tooltipData.txid) : undefined;
          return heatEntry ? (
            <span className="text-xs font-semibold" style={{ color: GRADE_HEX_SVG[heatEntry.grade] }}>
              {heatEntry.grade}
            </span>
          ) : null;
        })()}
      </div>
      )}
    </ChartTooltip>
  );

  // ─── Render ────────────────────────────────────────────

  // Standalone fullscreen mode (e.g. /graph page) - no modal, no inline card
  if (props.alwaysFullscreen) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 pr-14 space-y-2 shrink-0">
          <GraphToolbar
            {...toolbarProps}
            onZoomIn={() => zoomBy(1.25)}
            onZoomOut={() => zoomBy(1 / 1.25)}
            onFitView={handleFitView}
          />
        </div>
        <div className="flex-1 min-h-0 relative px-4 pb-4 flex" style={{ touchAction: "none" }}>
          <div className="flex-1 min-w-0 relative">
            {legend}
            <div ref={scrollRef} className="overflow-hidden h-full" style={{ touchAction: "none" }}>
              <ParentSize debounceTime={100}>
                {({ width, height: parentH }) => {
                  const adjustedWidth = showSidebar ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
                  return adjustedWidth > 0 ? (
                    <GraphCanvas
                      {...fullscreenCanvasProps}
                      containerWidth={adjustedWidth}
                      containerHeight={parentH}
                      isFullscreen
                    />
                  ) : null;
                }}
              </ParentSize>
            </div>
            {tooltipContent}
          </div>
          {renderSidebar("af-")}
        </div>
        {props.errors.size > 0 && props.loading.size === 0 && (
          <div className="text-xs text-severity-medium/80 px-4 pb-2">
            {[...props.errors.values()].at(-1)}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative rounded-xl border border-card-border bg-surface-inset p-4 space-y-3"
      >
        <GraphToolbar {...toolbarProps} onExpandFullscreen={handleExpandFullscreen} />

        {/* Hide inline graph when fullscreen is active to avoid double tooltip */}
        {!isExpanded && (
          <div className="relative flex overflow-hidden rounded-lg">
            {/* Graph area (shrinks when sidebar is open) */}
            <div className="flex-1 min-w-0 relative">
              {legend}
              <div ref={scrollRef} className="overflow-auto max-h-[900px] -mx-4 px-4">
                <ParentSize debounceTime={100}>
                  {({ width }) => {
                    const adjustedWidth = showSidebar ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
                    return adjustedWidth > 0 ? (
                      <GraphCanvas {...canvasProps} containerWidth={adjustedWidth} />
                    ) : null;
                  }}
                </ParentSize>
              </div>
              {tooltipContent}
            </div>
            {/* Sidebar: expanded or collapsed tab */}
            {renderSidebar("")}
          </div>
        )}

        {/* Capacity warning */}
        {props.nodeCount >= props.maxNodes && (
          <div className="text-xs text-severity-medium bg-severity-medium/10 border border-severity-medium/20 rounded-lg px-3 py-1.5">
            {t("graphExplorer.maxNodesReached", {
              max: props.maxNodes,
              defaultValue: "Maximum number of nodes reached ({{max}}). Remove some nodes before expanding further.",
            })}
          </div>
        )}

        {/* Loading indicators */}
        {props.loading.size > 0 && (
          <div className="text-xs text-muted animate-pulse">
            {t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}
          </div>
        )}

        {/* Ephemeral error messages */}
        {props.errors.size > 0 && props.loading.size === 0 && (
          <div className="text-xs text-severity-medium/80">
            {[...props.errors.values()].at(-1)}
          </div>
        )}
      </motion.div>

      {/* Fullscreen modal overlay */}
      {isExpanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("graphExplorer.fullscreenLabel", { defaultValue: "Transaction graph fullscreen" })}
          className="fixed inset-0 z-50 bg-card-bg/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapseFullscreen(); }}
        >
          {/* Close button */}
          <button
            onClick={collapseFullscreen}
            className="fixed top-3 right-3 z-[60] text-muted hover:text-foreground transition-colors p-2 rounded-lg bg-card-bg/80 hover:bg-surface-inset backdrop-blur-sm cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <CloseIcon />
          </button>

          {/* Fullscreen header */}
          <div className="p-4 pr-14 space-y-2 shrink-0">
            <GraphToolbar
              {...toolbarProps}
              onZoomIn={() => zoomBy(1.25)}
              onZoomOut={() => zoomBy(1 / 1.25)}
              onFitView={handleFitView}
            />
          </div>

          {/* Fullscreen graph area */}
          <div className="flex-1 min-h-0 relative px-4 pb-4 flex" style={{ touchAction: "none" }}>
            <div className="flex-1 min-w-0 relative">
              {legend}
              <div ref={scrollRef} className="overflow-hidden h-full" style={{ touchAction: "none" }}>
                <ParentSize debounceTime={100}>
                  {({ width, height: parentH }) => {
                    const adjustedWidth = showSidebar ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
                    return adjustedWidth > 0 ? (
                      <GraphCanvas
                        {...fullscreenCanvasProps}
                        containerWidth={adjustedWidth}
                        containerHeight={parentH}
                        isFullscreen
                      />
                    ) : null;
                  }}
                </ParentSize>
              </div>
              {tooltipContent}
            </div>
            {/* Fullscreen sidebar: expanded or collapsed tab */}
            {renderSidebar("fs-")}
          </div>
        </div>
      )}
    </>
  );
}
