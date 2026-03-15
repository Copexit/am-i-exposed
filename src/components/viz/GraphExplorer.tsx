"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "./shared/svgConstants";
import { probColor } from "./shared/linkabilityColors";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { useFullscreen } from "@/hooks/useFullscreen";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { computeBoltzmann, extractTxValues } from "@/lib/analysis/boltzmann-compute";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { detectJoinMarketForTurbo } from "@/lib/analysis/boltzmann-pool";
import type { BoltzmannWorkerResult, BoltzmannProgress } from "@/lib/analysis/boltzmann-pool";
import { GraphSidebar, SIDEBAR_WIDTH } from "./graph/GraphSidebar";
import { ENTITY_CATEGORY_COLORS, MAX_ZOOM, MIN_ZOOM } from "./graph/constants";
import { layoutGraph } from "./graph/layout";
import { computeFitTransform } from "./graph/edge-utils";
import { GraphCanvas } from "./graph/GraphCanvas";
import { CloseIcon } from "./graph/icons";
import { GraphToolbar } from "./graph/GraphToolbar";
import { SCRIPT_TYPE_LEGEND } from "./graph/scriptStyles";
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
          const idx = (finding.params as Record<string, unknown>).changeIndex;
          if (typeof idx === "number") newKeys.add(`${txid}:${idx}`);
        }
        if ((finding.id === "h2-same-address-io" || finding.id === "h2-self-send") && finding.params) {
          const indicesStr = (finding.params as Record<string, unknown>).selfSendIndices;
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

  // Sidebar visible when a node is expanded
  const sidebarTx = props.expandedNodeTxid ? props.nodes.get(props.expandedNodeTxid)?.tx : undefined;

  // ─── Boltzmann cache (on-demand computation for any node) ──────
  const boltzmannCacheRef = useRef<Map<string, BoltzmannWorkerResult>>(new Map());
  const [boltzmannVersion, setBoltzmannVersion] = useState(0);
  const computingBoltzmannRef = useRef<Set<string>>(new Set());
  const [computingBoltzmannVersion, setComputingBoltzmannVersion] = useState(0);
  const [boltzmannProgressMap, setBoltzmannProgressMap] = useState<Map<string, number>>(new Map());

  // Seed cache with root Boltzmann result if available
  useEffect(() => {
    if (props.rootBoltzmannResult && props.rootTxid) {
      boltzmannCacheRef.current.set(props.rootTxid, props.rootBoltzmannResult);
      setBoltzmannVersion((v) => v + 1);
    }
  }, [props.rootBoltzmannResult, props.rootTxid]);

  /** Build a synthetic Boltzmann result for 1-input txs (trivially 100% deterministic). */
  const buildSyntheticResult = useCallback((tx: import("@/lib/api/types").MempoolTransaction): BoltzmannWorkerResult => {
    const { inputValues, outputValues } = extractTxValues(tx);
    const nIn = inputValues.length;
    const nOut = outputValues.length;
    // 1 input -> every output is 100% linked to it
    const matProb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
    const matComb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
    const detLinks: [number, number][] = Array.from({ length: nOut }, (_, oi) => [oi, 0] as [number, number]);
    return {
      type: "result", id: tx.txid,
      matLnkCombinations: matComb, matLnkProbabilities: matProb,
      nbCmbn: 1, entropy: 0, efficiency: 0, nbCmbnPrfctCj: 1,
      deterministicLinks: detLinks, timedOut: false, elapsedMs: 0,
      nInputs: nIn, nOutputs: nOut,
      fees: tx.fee, intraFeesMaker: 0, intraFeesTaker: 0,
    };
  }, []);

  // Abort controller for the current computation cycle
  const boltzmannAbortRef = useRef<AbortController | null>(null);

  /** Compute Boltzmann for a specific txid (or generate synthetic for 1-input). */
  const computeSingleBoltzmann = useCallback(async (txid: string, signal?: AbortSignal): Promise<void> => {
    if (boltzmannCacheRef.current.has(txid)) return;
    const node = props.nodes.get(txid);
    if (!node) return;

    const tx = node.tx;
    const isCoinbase = tx.vin.some((v) => v.is_coinbase);
    if (isCoinbase) return;

    const { inputValues, outputValues } = extractTxValues(tx);
    if (inputValues.length === 0 || outputValues.length === 0) return;

    // 1-input txs: trivially 100% deterministic, no WASM needed
    if (inputValues.length === 1) {
      boltzmannCacheRef.current.set(txid, buildSyntheticResult(tx));
      setBoltzmannVersion((v) => v + 1);
      return;
    }

    // Too large for WASM
    if (inputValues.length + outputValues.length > 80) return;

    if (signal?.aborted) return;

    computingBoltzmannRef.current.add(txid);
    setComputingBoltzmannVersion((v) => v + 1);
    try {
      const result = await computeBoltzmann(tx, {
        signal,
        onProgress: (p: BoltzmannProgress) => {
          if (!signal?.aborted) {
            setBoltzmannProgressMap((prev) => new Map(prev).set(txid, p.fraction));
          }
        },
      });
      if (result && !signal?.aborted) {
        boltzmannCacheRef.current.set(txid, result);
        setBoltzmannVersion((v) => v + 1);
      }
    } catch { /* computation failed or aborted - not critical */ }
    computingBoltzmannRef.current.delete(txid);
    setComputingBoltzmannVersion((v) => v + 1);
    setBoltzmannProgressMap((prev) => { const next = new Map(prev); next.delete(txid); return next; });
  }, [props.nodes, buildSyntheticResult]);

  /** Manual trigger (sidebar button). Uses a fresh AbortController. */
  const triggerBoltzmann = useCallback(async (txid: string) => {
    // Abort any in-flight computation to free the worker pool
    boltzmannAbortRef.current?.abort();
    const ac = new AbortController();
    boltzmannAbortRef.current = ac;
    await computeSingleBoltzmann(txid, ac.signal);
  }, [computeSingleBoltzmann]);

  // Eagerly compute Boltzmann for ALL nodes in the graph whenever the graph changes
  useEffect(() => {
    // First pass: instantly fill synthetic results for all 1-input txs
    let anyNew = false;
    for (const [txid, node] of props.nodes) {
      if (boltzmannCacheRef.current.has(txid)) continue;
      const tx = node.tx;
      if (tx.vin.some((v) => v.is_coinbase)) continue;
      const { inputValues, outputValues } = extractTxValues(tx);
      if (inputValues.length === 1 && outputValues.length > 0) {
        boltzmannCacheRef.current.set(txid, buildSyntheticResult(tx));
        anyNew = true;
      }
    }
    if (anyNew) setBoltzmannVersion((v) => v + 1);

    // Second pass: async compute for auto-computable multi-input txs (sequential)
    // Abort previous computation cycle before starting a new one
    boltzmannAbortRef.current?.abort();
    const ac = new AbortController();
    boltzmannAbortRef.current = ac;

    // Build queue of eligible txids (snapshot - stable across the async loop)
    const queue: Array<{ txid: string; tx: import("@/lib/api/types").MempoolTransaction }> = [];
    for (const [txid, node] of props.nodes) {
      if (boltzmannCacheRef.current.has(txid)) continue;
      if (computingBoltzmannRef.current.has(txid)) continue;

      const tx = node.tx;
      if (tx.vin.some((v) => v.is_coinbase)) continue;

      const { inputValues, outputValues } = extractTxValues(tx);
      if (inputValues.length < 2) continue;
      const total = inputValues.length + outputValues.length;
      if (total >= 18) {
        if (total >= 24) continue;
        if (!detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket) continue;
      }

      queue.push({ txid, tx });
    }

    // Process queue sequentially with abort signal
    if (queue.length > 0) {
      (async () => {
        for (const { txid } of queue) {
          if (ac.signal.aborted) break;
          await computeSingleBoltzmann(txid, ac.signal);
        }
      })();
    }

    return () => { ac.abort(); };
  }, [props.nodes, buildSyntheticResult, computeSingleBoltzmann]);

  /** Get Boltzmann result for a txid (from cache or root result). */
  const getBoltzmannResult = useCallback((txid: string): BoltzmannWorkerResult | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    boltzmannVersion; // depend on version to re-read cache after updates
    return boltzmannCacheRef.current.get(txid);
  }, [boltzmannVersion]);

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

  const [showEdgeLegend, setShowEdgeLegend] = useState(false);

  if (props.nodes.size === 0) return null;

  // Toggle filter helpers
  const toggleFilter = (key: keyof NodeFilter) => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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

  const toolbarProps = {
    nodeCount: props.nodeCount,
    maxNodes: props.maxNodes,
    hiddenCount,
    canUndo: props.canUndo,
    heatMapActive,
    heatProgress,
    fingerprintMode,
    edgeMode,
    onToggleHeatMap: handleToggleHeatMap,
    onToggleFingerprint: handleToggleFingerprint,
    onCycleEdgeMode: cycleEdgeMode,
    onUndo: props.onUndo,
    onReset: props.onReset,
  };

  // ─── Legend (clickable filters) ────────────────────────

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
      {/* Node types - always shown */}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: SVG_COLORS.bitcoin, background: "transparent" }} />
        {t("graphExplorer.legendRoot", { defaultValue: "Analyzed tx" })}
      </span>
      <button
        onClick={() => toggleFilter("showCoinJoin")}
        className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showCoinJoin ? "opacity-100" : "opacity-40 line-through"}`}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.good }} />
        {t("graphExplorer.legendCoinJoin", { defaultValue: "CoinJoin" })}
      </button>
      <button
        onClick={() => toggleFilter("showStandard")}
        className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showStandard ? "opacity-100" : "opacity-40 line-through"}`}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.low }} />
        {t("graphExplorer.legendDefault", { defaultValue: "Standard tx" })}
      </button>
      {/* Single "Entity" item (collapsed from 5 categories) */}
      <button
        onClick={() => toggleFilter("showEntity")}
        className={`flex items-center gap-1 cursor-pointer transition-opacity ${filter.showEntity ? "opacity-100" : "opacity-40 line-through"}`}
      >
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: ENTITY_CATEGORY_COLORS.exchange }} />
        <span className="text-white/40">Entity</span>
      </button>
      {props.walletUtxos && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.bitcoin, opacity: 0.3 }} />
          {t("graphExplorer.legendWalletOutput", { defaultValue: "Wallet output" })}
        </span>
      )}
      <span className="text-white/20">|</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded" style={{ background: SVG_COLORS.critical, opacity: 0.7 }} />
        <span className="text-white/40">{t("graphExplorer.legendConsolidation", { defaultValue: "Consolidation" })}</span>
      </span>
      {/* Collapsible edge color legend */}
      <button
        onClick={() => setShowEdgeLegend(!showEdgeLegend)}
        className="text-white/30 hover:text-white/50 cursor-pointer transition-colors"
      >
        Edge colors {showEdgeLegend ? "\u25B4" : "\u25BE"}
      </button>
      {showEdgeLegend && SCRIPT_TYPE_LEGEND.map((s) => (
        <span key={s.type} className="flex items-center gap-1">
          <span className="inline-block w-4 h-0.5 rounded" style={{
            background: s.color,
            opacity: 0.8,
            ...(s.dash ? { borderBottom: `1.5px dashed ${s.color}`, background: "transparent" } : {}),
          }} />
          <span className="text-white/30">{s.label}</span>
        </span>
      ))}
      {/* Conditional: fingerprint mode legend */}
      {fingerprintMode && (
        <>
          <span className="text-white/20">|</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#2a2a2e", border: "1px solid rgba(255,255,255,0.2)" }} />
            <span className="text-white/30">v1</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#4a4a52", border: "1px solid rgba(255,255,255,0.2)" }} />
            <span className="text-white/30">v2</span>
          </span>
        </>
      )}
      {/* Conditional: change marking legend */}
      {changeOutputs.size > 0 && (
        <>
          <span className="text-white/20">|</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: "#d97706", opacity: 0.8 }} />
            <span className="text-white/40">Change</span>
          </span>
        </>
      )}
    </div>
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
    boltzmannCache: boltzmannCacheRef.current,
  };

  const fullscreenCanvasProps = {
    ...canvasProps,
    viewTransform,
    onViewTransformChange: setViewTransform,
  };

  // ─── Tooltip content ──────────────────────────────────

  const tooltipContent = tooltip.tooltipOpen && tooltip.tooltipData && (
    <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft} containerRef={scrollRef}>
      {tooltip.tooltipData.linkProb !== undefined ? (
        <div className="space-y-0.5">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(tooltip.tooltipData.linkProb), display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: SVG_COLORS.foreground }}>{Math.round(tooltip.tooltipData.linkProb * 100)}% linkability</span>
          </div>
          <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
            {t("graphExplorer.linkability", { defaultValue: "Max output linkability" })}
          </div>
        </div>
      ) : (
      <div className="space-y-1">
        <div className="font-mono text-xs">{truncateId(tooltip.tooltipData.txid, 8)}</div>
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {tooltip.tooltipData.inputCount} {t("graphExplorer.inputs", { defaultValue: "inputs" })}, {tooltip.tooltipData.outputCount} {t("graphExplorer.outputs", { defaultValue: "outputs" })}
        </div>
        <div className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
          {formatSats(tooltip.tooltipData.totalValue)}
        </div>
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {t("graphExplorer.fee", {
            fee: formatSats(tooltip.tooltipData.fee),
            rate: tooltip.tooltipData.feeRate,
            defaultValue: "Fee: {{fee}} ({{rate}} sat/vB)",
          })}
        </div>
        <div className="text-xs" style={{ color: tooltip.tooltipData.confirmed ? SVG_COLORS.good : SVG_COLORS.medium }}>
          {tooltip.tooltipData.confirmed
            ? t("graphExplorer.confirmed", { defaultValue: "Confirmed" })
            : t("graphExplorer.unconfirmed", { defaultValue: "Unconfirmed" })}
        </div>
        {tooltip.tooltipData.isCoinJoin && (
          <div className="text-xs flex items-center gap-1" style={{ color: SVG_COLORS.good }}>
            <span>&#9670;</span>
            {tooltip.tooltipData.coinJoinType ?? "CoinJoin"}
          </div>
        )}
        {tooltip.tooltipData.entityLabel && (
          <div className="text-xs space-y-0.5">
            <div className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: ENTITY_CATEGORY_COLORS[tooltip.tooltipData.entityCategory ?? "unknown"] }}
              />
              <span style={{ color: ENTITY_CATEGORY_COLORS[tooltip.tooltipData.entityCategory ?? "unknown"] }}>
                {tooltip.tooltipData.entityLabel}
              </span>
            </div>
            <div style={{ color: SVG_COLORS.muted }}>
              {tooltip.tooltipData.entityCategory}
              {tooltip.tooltipData.entityConfidence && ` (${tooltip.tooltipData.entityConfidence})`}
            </div>
            {tooltip.tooltipData.entityOfac && (
              <div style={{ color: SVG_COLORS.critical }} className="font-semibold">
                OFAC Sanctioned
              </div>
            )}
          </div>
        )}
        {heatMapActive && heatMap.has(tooltip.tooltipData.txid) && (
          <div className="text-xs font-semibold" style={{ color: GRADE_HEX_SVG[heatMap.get(tooltip.tooltipData.txid)!.grade] }}>
            {t("graphExplorer.analysis.score", {
              score: heatMap.get(tooltip.tooltipData.txid)!.score,
              defaultValue: "Score: {{score}}/100",
            })} ({heatMap.get(tooltip.tooltipData.txid)!.grade})
          </div>
        )}
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {t("graphExplorer.depth", { depth: tooltip.tooltipData.depth > 0 ? `+${tooltip.tooltipData.depth}` : tooltip.tooltipData.depth, defaultValue: "Depth: {{depth}}" })}
        </div>
      </div>
      )}
    </ChartTooltip>
  );

  // ─── Render ────────────────────────────────────────────

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative rounded-xl border border-white/5 bg-surface-inset p-4 space-y-3"
      >
        <GraphToolbar {...toolbarProps} onExpandFullscreen={handleExpandFullscreen} />
        {legend}

        {/* Hide inline graph when fullscreen is active to avoid double tooltip */}
        {!isExpanded && (
          <div className="relative flex">
            {/* Graph area (shrinks when sidebar is open) */}
            <div className="flex-1 min-w-0 relative">
              <div ref={scrollRef} className="overflow-auto max-h-[600px] -mx-4 px-4">
                <ParentSize debounceTime={100}>
                  {({ width }) => {
                    const adjustedWidth = sidebarTx ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
                    return adjustedWidth > 0 ? (
                      <GraphCanvas {...canvasProps} containerWidth={adjustedWidth} />
                    ) : null;
                  }}
                </ParentSize>
              </div>
              {tooltipContent}
              {/* Floating analysis panel (fallback when no expansion support) */}
            </div>
            {/* Transaction detail sidebar (when a node is expanded) */}
            <AnimatePresence>
              {sidebarTx && props.expandedNodeTxid && (
                <GraphSidebar
                  key={props.expandedNodeTxid}
                  tx={sidebarTx}
                  outspends={props.outspendCache?.get(props.expandedNodeTxid)}
                  onClose={() => props.onToggleExpand?.(props.expandedNodeTxid!)}
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
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Capacity warning */}
        {props.nodeCount >= props.maxNodes && (
          <div className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
            {t("graphExplorer.maxNodesReached", {
              max: props.maxNodes,
              defaultValue: "Maximum number of nodes reached ({{max}}). Remove some nodes before expanding further.",
            })}
          </div>
        )}

        {/* Loading indicators */}
        {props.loading.size > 0 && (
          <div className="text-xs text-white/40 animate-pulse">
            {t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}
          </div>
        )}

        {/* Ephemeral error messages */}
        {props.errors.size > 0 && props.loading.size === 0 && (
          <div className="text-xs text-amber-400/70">
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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapseFullscreen(); }}
        >
          {/* Close button */}
          <button
            onClick={collapseFullscreen}
            className="fixed top-3 right-3 z-[60] text-white/60 hover:text-white transition-colors p-2 rounded-lg bg-black/60 hover:bg-surface-inset backdrop-blur-sm cursor-pointer"
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
            {legend}
          </div>

          {/* Fullscreen graph area */}
          <div className="flex-1 min-h-0 relative px-4 pb-4 flex" style={{ touchAction: "none" }}>
            <div className="flex-1 min-w-0 relative">
              <div ref={scrollRef} className="overflow-hidden h-full" style={{ touchAction: "none" }}>
                <ParentSize debounceTime={100}>
                  {({ width, height: parentH }) => {
                    const adjustedWidth = sidebarTx ? Math.max(width - SIDEBAR_WIDTH, 200) : width;
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
            {/* Fullscreen sidebar */}
            <AnimatePresence>
              {sidebarTx && props.expandedNodeTxid && (
                <GraphSidebar
                  key={`fs-${props.expandedNodeTxid}`}
                  tx={sidebarTx}
                  outspends={props.outspendCache?.get(props.expandedNodeTxid)}
                  onClose={() => props.onToggleExpand?.(props.expandedNodeTxid!)}
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
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </>
  );
}
