"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
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
import { ExpandIcon, CloseIcon, HeatIcon, FingerprintIcon, GraphIcon } from "./graph/icons";
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

  // Linkability edge mode
  const [linkabilityEdgeMode, setLinkabilityEdgeMode] = useState(false);
  const hasLinkability = !!props.rootBoltzmannResult;

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

  // Eagerly auto-mark change outputs using heuristics for all graph nodes
  useEffect(() => {
    const autoMarked = new Set<string>();
    for (const [txid, node] of props.nodes) {
      const result = analyzeChangeDetection(node.tx);
      for (const finding of result.findings) {
        // h2-change-detected: sub-heuristic consensus (round amount, script match, etc.)
        if (finding.id === "h2-change-detected" && finding.params) {
          const idx = (finding.params as Record<string, unknown>).changeIndex;
          if (typeof idx === "number") {
            autoMarked.add(`${txid}:${idx}`);
          }
        }
        // h2-same-address-io: output address matches an input address (deterministic change)
        // h2-self-send: ALL outputs go back to input addresses
        if ((finding.id === "h2-same-address-io" || finding.id === "h2-self-send") && finding.params) {
          const indicesStr = (finding.params as Record<string, unknown>).selfSendIndices;
          if (typeof indicesStr === "string" && indicesStr.length > 0) {
            for (const idx of indicesStr.split(",")) {
              const n = parseInt(idx, 10);
              if (!isNaN(n)) autoMarked.add(`${txid}:${n}`);
            }
          }
        }
      }
    }
    // Merge: auto-marked + user-toggled (user overrides take precedence)
    setChangeOutputs((prev) => {
      const next = new Set(autoMarked);
      for (const key of userToggledRef.current) {
        // If user explicitly toggled it off, remove; if toggled on, add
        if (prev.has(key) && !autoMarked.has(key)) next.add(key);
        if (!prev.has(key) && autoMarked.has(key)) next.delete(key);
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

  // Heat map computation
  useEffect(() => {
    if (!heatMapActive) return;
    const analyze = analyzeTransactionSync;
    const nodeEntries = Array.from(props.nodes.entries());
    const results = new Map<string, ScoringResult>();
    let idx = 0;

    function processNext() {
      const start = performance.now();
      while (idx < nodeEntries.length && performance.now() - start < 16) {
        const [txid, gn] = nodeEntries[idx];
        if (!results.has(txid)) {
          results.set(txid, analyze(gn.tx));
        }
        idx++;
        setHeatProgress(Math.round((idx / nodeEntries.length) * 100));
      }
      setHeatMap(new Map(results));
      if (idx < nodeEntries.length) {
        requestAnimationFrame(processNext);
      }
    }

    processNext();
  }, [heatMapActive, props.nodes]);

  // Count hidden nodes
  const totalNodes = props.nodeCount;
  const atCapacity = props.nodeCount >= props.maxNodes;
  const [visibleCount, setVisibleCount] = useState(totalNodes);
  const handleLayoutComplete = useCallback((info: { visibleCount: number }) => {
    setVisibleCount(info.visibleCount);
  }, []);
  const hiddenCount = totalNodes - visibleCount;

  if (props.nodes.size === 0) return null;

  // Toggle filter helpers
  const toggleFilter = (key: keyof NodeFilter) => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ─── Toolbar ───────────────────────────────────────────

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-white/70 min-w-0">
        <GraphIcon />
        <span className="truncate">{t("graphExplorer.title", { defaultValue: "Transaction Graph" })}</span>
        <span className={`text-xs font-normal hidden sm:inline ${atCapacity ? "text-amber-400" : "text-white/40"}`}>
          {t("graphExplorer.nodeCount", { count: props.nodeCount, max: props.maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
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
          onClick={() => { setHeatMapActive(!heatMapActive); if (!heatMapActive) setFingerprintMode(false); }}
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
          onClick={() => { setFingerprintMode(!fingerprintMode); if (!fingerprintMode) setHeatMapActive(false); }}
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

        {/* Linkability edge mode toggle */}
        {hasLinkability && (
          <button
            onClick={() => setLinkabilityEdgeMode(!linkabilityEdgeMode)}
            className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
              linkabilityEdgeMode
                ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
                : "text-white/50 hover:text-white/80 border-white/10"
            }`}
            title={t("graphExplorer.linkability", { defaultValue: "Color edges by linkability" })}
          >
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <span className="hidden sm:inline">{t("graphExplorer.linkability", { defaultValue: "Linkability" })}</span>
            </span>
          </button>
        )}

        {/* Undo */}
        <button
          onClick={props.onUndo}
          disabled={!props.canUndo}
          className={`text-xs transition-colors px-2 py-1 rounded border border-white/10 ${
            props.canUndo
              ? "text-white/50 hover:text-white/80 cursor-pointer"
              : "text-white/20 cursor-not-allowed"
          }`}
        >
          {t("common.undo", { defaultValue: "Undo" })}
        </button>

        {/* Reset */}
        {props.nodeCount > 1 && (
          <button
            onClick={props.onReset}
            className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
          >
            {t("common.reset", { defaultValue: "Reset" })}
          </button>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={() => {
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
          }}
          className="text-white/50 hover:text-white/80 transition-colors p-1 rounded border border-white/10 cursor-pointer"
          title={t("graphExplorer.fullscreen", { defaultValue: "Fullscreen" })}
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );

  // ─── Instructions ──────────────────────────────────────

  const instructions = (
    <div className="text-xs text-white/40">
      {t("graphExplorer.instructions", { defaultValue: "Click + buttons on nodes to expand the graph. Click node to analyze." })}
    </div>
  );

  // ─── Legend (clickable filters) ────────────────────────

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
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
      {props.walletUtxos && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.bitcoin, opacity: 0.3 }} />
          {t("graphExplorer.legendWalletOutput", { defaultValue: "Wallet output" })}
        </span>
      )}
      <span className="text-white/20">|</span>
      {([
        ["exchange", "Exchange"],
        ["darknet", "Darknet"],
        ["mixer", "Mixer"],
        ["gambling", "Gambling"],
        ["mining", "Mining"],
      ] as const).map(([cat, label]) => (
        <button
          key={cat}
          onClick={() => toggleFilter("showEntity")}
          className={`flex items-center gap-1 cursor-pointer transition-opacity ${filter.showEntity ? "opacity-100" : "opacity-40 line-through"}`}
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: ENTITY_CATEGORY_COLORS[cat] }} />
          <span className="text-white/40">{label}</span>
        </button>
      ))}
      <span className="text-white/20">|</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded" style={{ background: SVG_COLORS.critical, opacity: 0.7 }} />
        <span className="text-white/40">{t("graphExplorer.legendConsolidation", { defaultValue: "Consolidation" })}</span>
      </span>
      {/* Script type edge colors (always shown - they're always active) */}
      <span className="text-white/20">|</span>
      {SCRIPT_TYPE_LEGEND.map((s) => (
        <span key={s.type} className="flex items-center gap-1">
          <span className="inline-block w-4 h-0.5 rounded" style={{
            background: s.color,
            opacity: 0.8,
            ...(s.dash ? { borderBottom: `1.5px dashed ${s.color}`, background: "transparent" } : {}),
          }} />
          <span className="text-white/30">{s.label}</span>
        </span>
      ))}
      {/* Fingerprint mode legend */}
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
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5" style={{ background: "#4a4a52", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 0 }} />
            <span className="text-white/30">block-ht lock</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5" style={{ background: "#4a4a52", border: "1px solid rgba(255,255,255,0.2)", clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" }} />
            <span className="text-white/30">timestamp lock</span>
          </span>
        </>
      )}
      {/* Change marking legend (shown when there are marked outputs) */}
      {changeOutputs.size > 0 && (
        <>
          <span className="text-white/20">|</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: "#f97316", opacity: 0.8 }} />
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
        {toolbar}
        {instructions}
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
            <div className="flex flex-wrap items-center justify-between gap-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-white/70 min-w-0">
                <GraphIcon />
                <span className="truncate">{t("graphExplorer.title", { defaultValue: "Transaction Graph" })}</span>
                <span className={`text-xs font-normal hidden sm:inline ${atCapacity ? "text-amber-400" : "text-white/40"}`}>
                  {t("graphExplorer.nodeCount", { count: props.nodeCount, max: props.maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setHeatMapActive(!heatMapActive)}
                  className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
                    heatMapActive ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10" : "text-white/50 hover:text-white/80 border-white/10"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <HeatIcon />
                    <span className="hidden sm:inline">
                      {heatMapActive && heatProgress < 100 ? `${heatProgress}%` : t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
                    </span>
                  </span>
                </button>
                {/* Fingerprint mode (fullscreen) */}
                <button
                  onClick={() => { setFingerprintMode(!fingerprintMode); if (!fingerprintMode) setHeatMapActive(false); }}
                  className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
                    fingerprintMode ? "text-purple-400 border-purple-400/30 bg-purple-400/10" : "text-white/50 hover:text-white/80 border-white/10"
                  }`}
                  title="Fingerprint mode"
                >
                  <span className="flex items-center gap-1">
                    <FingerprintIcon />
                    <span className="hidden sm:inline">Fingerprint</span>
                  </span>
                </button>
                {/* Linkability edges (fullscreen) */}
                {hasLinkability && (
                  <button
                    onClick={() => setLinkabilityEdgeMode(!linkabilityEdgeMode)}
                    className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
                      linkabilityEdgeMode ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10" : "text-white/50 hover:text-white/80 border-white/10"
                    }`}
                    title="Color edges by linkability"
                  >
                    <span className="flex items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                      <span className="hidden sm:inline">Linkability</span>
                    </span>
                  </button>
                )}
                <button
                  onClick={props.onUndo}
                  disabled={!props.canUndo}
                  className={`text-xs transition-colors px-2 py-1 rounded border border-white/10 ${
                    props.canUndo
                      ? "text-white/50 hover:text-white/80 cursor-pointer"
                      : "text-white/20 cursor-not-allowed"
                  }`}
                >
                  {t("common.undo", { defaultValue: "Undo" })}
                </button>
                {props.nodeCount > 1 && (
                  <button onClick={props.onReset} className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer">
                    {t("common.reset", { defaultValue: "Reset" })}
                  </button>
                )}
                <span className="text-white/20 hidden sm:inline">|</span>
                <button
                  onClick={() => zoomBy(1.25)}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
                  title="Zoom in"
                >+</button>
                <button
                  onClick={() => zoomBy(1 / 1.25)}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
                  title="Zoom out"
                >-</button>
                <button
                  onClick={() => {
                    const { width: gw, height: gh } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
                    const cw = window.innerWidth - 32;
                    const ch = window.innerHeight - 160;
                    setViewTransform(computeFitTransform(gw, gh, cw, ch));
                  }}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
                  title="Fit to view"
                >{t("graphExplorer.fit", { defaultValue: "Fit" })}</button>
              </div>
            </div>
            {instructions}
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
