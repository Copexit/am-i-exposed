"use client";

import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { Grid3X3, Clock, Link, Hash, AlertTriangle } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";
import { useBoltzmann } from "@/hooks/useBoltzmann";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { formatSats } from "@/lib/format";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { EFFICIENCY_COLORS, getColorStops, probColor, probLabel } from "./shared/linkabilityColors";
import { truncAddr, truncAddrSuffix } from "./shared/addressFormat";
import { formatElapsed } from "./shared/heatmapHelpers";
import type { HeatmapTooltipData } from "./shared/heatmapHelpers";
import { HeatmapCell } from "./shared/HeatmapCell";
import {
  HeatmapIdleBlock,
  HeatmapProgressBlock,
  HeatmapErrorBlock,
  HeatmapUnsupportedBlock,
} from "./shared/HeatmapStatusBlocks";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import { isCoinbase, getValuedOutputs } from "@/lib/analysis/heuristics/tx-utils";
import type { MempoolTransaction } from "@/lib/api/types";

interface Props {
  tx: MempoolTransaction;
  /** Pre-computed Boltzmann result from the analysis pipeline. */
  boltzmannResult?: BoltzmannWorkerResult | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LinkabilityHeatmap({ tx, boltzmannResult: precomputed }: Props) {
  const { t } = useTranslation();
  useTheme(); // re-render on theme change for SVG_COLORS
  const { state, compute, autoComputed, isSupported } = useBoltzmann(tx, precomputed);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [entered, setEntered] = useState(false);
  const [prevStatus, setPrevStatus] = useState(state.status);
  const gridRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const {
    tooltipOpen, tooltipData, tooltipLeft, tooltipTop,
    showTooltip, hideTooltip,
  } = useChartTooltip<HeatmapTooltipData>();

  const coinbase = isCoinbase(tx);

  const inputs = useMemo(() =>
    tx.vin
      .filter(v => !v.is_coinbase && v.prevout)
      .map((v, i) => ({
        index: i,
        address: v.prevout?.scriptpubkey_address,
        value: v.prevout?.value ?? 0,
      }))
      .sort((a, b) => b.value - a.value),
    [tx]
  );

  const outputs = useMemo(() =>
    getValuedOutputs(tx.vout)
      .map((o, i) => ({
        index: i,
        address: o.scriptpubkey_address,
        value: o.value,
      }))
      .sort((a, b) => b.value - a.value),
    [tx]
  );

  const nIn = inputs.length;
  const nOut = outputs.length;

  // H5 merges UTXOs sharing an address (mergeByAddress), so its entropy can differ from these per-UTXO pills
  const hasSharedAddress = useMemo(() => [inputs, outputs].some((list) => {
    const addrs = list.flatMap((u) => (u.address ? [u.address] : []));
    return new Set(addrs).size < addrs.length;
  }), [inputs, outputs]);

  // Pagination for large matrices to prevent browser crashes
  const PAGE_SIZE = 30;
  const [visibleRows, setVisibleRows] = useState(PAGE_SIZE);
  const [visibleCols, setVisibleCols] = useState(PAGE_SIZE);
  const cappedInputs = inputs.slice(0, visibleRows);
  const cappedOutputs = outputs.slice(0, visibleCols);
  const hasMoreRows = visibleRows < nIn;
  const hasMoreCols = visibleCols < nOut;

  // Derived state: reset entrance flag on status transitions (getDerivedStateFromProps pattern)
  if (prevStatus !== state.status) {
    setPrevStatus(state.status);
    if (state.status === "complete") {
      setEntered(!!prefersReducedMotion);
    } else {
      setEntered(false);
    }
  }

  // Delayed entrance completion so hover transitions become instant after stagger finishes
  useEffect(() => {
    if (state.status !== "complete" || prefersReducedMotion) return;
    const maxDelay = Math.max(0, nIn - 1 + nOut - 1) * 30 + 300;
    const timer = setTimeout(() => setEntered(true), maxDelay);
    return () => clearTimeout(timer);
  }, [state.status, nIn, nOut, prefersReducedMotion]);

  const handleCellHover = useCallback(
    (e: React.MouseEvent, row: number, col: number, prob: number, count: number, total: number) => {
      setHoveredCell({ row, col });
      if (gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        showTooltip({
          tooltipData: {
            inAddr: inputs[row]?.address,
            outAddr: outputs[col]?.address,
            prob,
            count,
            total,
          },
          tooltipLeft: e.clientX - rect.left,
          tooltipTop: e.clientY - rect.top - 8,
        });
      }
    },
    [inputs, outputs, showTooltip],
  );

  const handleCellLeave = useCallback(() => {
    setHoveredCell(null);
    hideTooltip();
  }, [hideTooltip]);

  if (coinbase || !isSupported) return null;

  return (
    <GlowCard className="p-5 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Grid3X3 size={16} className="text-bitcoin shrink-0" />
        <h3 className="text-sm font-semibold text-foreground flex-1">
          {t("boltzmann.title", { defaultValue: "Link Probability Matrix" })}
        </h3>
        <span className="text-xs text-muted" title={
          state.result?.method === "wabisabi"
            ? t("boltzmann.methodTooltip.wabisabi", { defaultValue: "Tier-decomposed upper bound: per-tier Boltzmann partition formulas combined under independence assumption. True entropy may be slightly lower due to cross-tier dependencies." })
            : state.result?.method === "joinmarket"
              ? t("boltzmann.methodTooltip.joinmarket", { defaultValue: "JoinMarket-optimized Boltzmann: exploits maker/taker structure for fast computation. Upper bound due to formula approximations for large transactions." })
              : t("boltzmann.methodTooltip.exact", { defaultValue: "Exact Boltzmann link probability computation via WASM" })
        }>
          {t("boltzmann.subtitle", { defaultValue: "Boltzmann analysis" })}
          {state.result?.method === "wabisabi" && (
            <span className="ml-1 text-[9px] text-muted/50">{t("boltzmann.method.wabisabi", { defaultValue: "(tier-decomposed)" })}</span>
          )}
          {state.result?.method === "joinmarket" && (
            <span className="ml-1 text-[9px] text-muted/50">{t("boltzmann.method.joinmarket", { defaultValue: "(JoinMarket-optimized)" })}</span>
          )}
        </span>
      </div>

      <div className="mt-4 space-y-4">
          {state.status === "idle" && !autoComputed && (
            <HeatmapIdleBlock nIn={nIn} nOut={nOut} compute={compute} />
          )}

          {(state.status === "loading" || state.status === "computing") && (
            <HeatmapProgressBlock progress={state.progress} />
          )}

          {state.status === "error" && (
            <HeatmapErrorBlock error={state.error ?? undefined} compute={compute} />
          )}

          {state.status === "cancelled" && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-muted">
                {t("boltzmann.cancelled", { defaultValue: "Computation was interrupted by another Boltzmann job." })}
              </p>
              <button
                onClick={compute}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted border border-card-border rounded-lg hover:text-foreground transition-colors cursor-pointer"
              >
                {t("boltzmann.retry", { defaultValue: "Retry" })}
              </button>
            </div>
          )}

          {state.status === "unsupported" && <HeatmapUnsupportedBlock />}

          {state.status === "complete" && state.result && (() => {
            const result = state.result;
            const showEfficiency = isCoinJoinTx(tx) && result.efficiency > 0 && !result.timedOut;
            const effPct = Math.min(result.efficiency, 1) * 100;
            const isApprox = result.method === "wabisabi" || result.method === "joinmarket";
            const boundLabel = isApprox ? ` ${t("boltzmann.upperBound", { defaultValue: "(upper bound)" })}` : "";
            const bits = result.entropy.toFixed(2);
            const bitsPerUtxo = (result.entropy / (nIn + nOut)).toFixed(2);

            return (
              <>
                {/* Stats pills */}
                <div className="flex flex-wrap gap-2">
                  <motion.span initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted">
                    <Hash size={11} />
                    {result.timedOut
                      ? t("boltzmann.interpretationsPartial", { num: result.nbCmbn.toLocaleString(), defaultValue: "{{num}}+ interpretations (partial)" })
                      : t("boltzmann.interpretations", { count: result.nbCmbn, num: result.nbCmbn.toLocaleString(), defaultValue: "{{num}} interpretations" })}
                  </motion.span>
                  <motion.span initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }} className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted" title={isApprox ? t("boltzmann.entropyUpperBoundTooltip", { defaultValue: "Upper bound. True entropy may be slightly lower due to structural approximations." }) : undefined}>
                    <Grid3X3 size={11} />
                    {result.timedOut
                      ? t("boltzmann.entropyPartial", { bits, defaultValue: "{{bits}}+ bits entropy (partial)" })
                      : t("boltzmann.entropy", { bits, defaultValue: "{{bits}} bits entropy" }) + boundLabel}
                  </motion.span>
                  <motion.span initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.075 }} className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted" title={isApprox ? t("boltzmann.bitsPerUtxoUpperBoundTooltip", { defaultValue: "Upper bound. Per-UTXO entropy averaged across the transaction." }) : undefined}>
                    <Grid3X3 size={11} />
                    {result.timedOut
                      ? t("boltzmann.bitsPerUtxoPartial", { bits: bitsPerUtxo, defaultValue: "{{bits}}+ bits/UTXO (partial)" })
                      : t("boltzmann.bitsPerUtxo", { bits: bitsPerUtxo, defaultValue: "{{bits}} bits/UTXO" }) + boundLabel}
                  </motion.span>
                  {result.deterministicLinks.length > 0 && (
                    <motion.span initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }} className="inline-flex items-center gap-1.5 bg-severity-critical/10 text-severity-critical border border-severity-critical/20 rounded-full px-2.5 py-1 text-xs">
                      <Link size={11} />
                      {t("boltzmann.deterministicLinks", { count: result.deterministicLinks.length, num: result.deterministicLinks.length, defaultValue: "{{num}} deterministic links" })}
                    </motion.span>
                  )}
                  <motion.span initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }} className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted">
                    <Clock size={11} />
                    {formatElapsed(result.elapsedMs)}
                  </motion.span>
                </div>

                {hasSharedAddress && (
                  <p className="text-xs text-muted">
                    {t("boltzmann.mergedNote", { defaultValue: "The entropy finding merges UTXOs that share an address, so its value can differ from these per-UTXO figures." })}
                  </p>
                )}

                {/* Timed out warning */}
                {result.timedOut && (
                  <div className="flex items-center gap-2 text-xs text-severity-medium bg-severity-medium/10 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} />
                    {t("boltzmann.timedOut", { defaultValue: "Computation timed out. Only deterministic links (100%) and zero-probability cells are reliable. Other cells are shown as N/A." })}
                  </div>
                )}

                {/* Heat map grid */}
                <div className="relative -mx-2">
                  <div ref={gridRef} className="bg-surface-inset/40 rounded-lg border border-card-border/40 overflow-auto p-3" style={{ maxHeight: "70vh" }}>
                    <div className="grid gap-px" style={{ gridTemplateColumns: `minmax(90px, 120px) repeat(${cappedOutputs.length}, minmax(56px, 1fr))`, gridTemplateRows: `auto repeat(${cappedInputs.length}, minmax(44px, auto))` }}>
                      {/* Top-left corner */}
                      <div className="text-[10px] text-muted/70 flex items-end justify-end pr-1 pb-0.5">
                        {t("boltzmann.gridLabel", { defaultValue: "In \\ Out" })}
                      </div>

                      {/* Column headers */}
                      {cappedOutputs.map((out, o) => (
                        <div key={`h-${o}`} className="text-center px-1 pb-1 border-b border-card-border/40">
                          <button onClick={() => out.address && (window.location.hash = `#addr=${out.address}`)} className={`text-[11px] font-mono transition-colors duration-150 block w-full hover:text-bitcoin cursor-pointer whitespace-nowrap ${hoveredCell?.col === o ? "text-foreground" : "text-muted"}`} title={out.address}>
                            {truncAddrSuffix(out.address)}
                          </button>
                          <div className="text-[10px] text-muted/60">{formatSats(out.value)}</div>
                        </div>
                      ))}

                      {/* Rows */}
                      {cappedInputs.map((inp, i) => (
                        <Fragment key={`row-${i}`}>
                          <div className="flex items-center justify-end pr-2 gap-1">
                            <div className="text-right">
                              <button onClick={() => inp.address && (window.location.hash = `#addr=${inp.address}`)} className={`text-[11px] font-mono transition-colors duration-150 block ml-auto hover:text-bitcoin cursor-pointer whitespace-nowrap ${hoveredCell?.row === i ? "text-foreground" : "text-muted"}`} title={inp.address}>
                                {truncAddr(inp.address)}
                              </button>
                              <div className="text-[10px] text-muted/60">{formatSats(inp.value)}</div>
                            </div>
                          </div>
                          {cappedOutputs.map((_out, o) => (
                            <HeatmapCell
                              key={`c-${i}-${o}`}
                              row={i}
                              col={o}
                              prob={result.matLnkProbabilities[o]?.[i] ?? 0}
                              count={result.matLnkCombinations[o]?.[i] ?? 0}
                              timedOut={result.timedOut}
                              hoveredRow={hoveredCell?.row ?? null}
                              hoveredCol={hoveredCell?.col ?? null}
                              entered={entered}
                              totalPorts={nIn + nOut}
                              prefersReducedMotion={prefersReducedMotion}
                              nbCmbn={result.nbCmbn}
                              onHover={handleCellHover}
                              onLeave={handleCellLeave}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </div>

                    {/* Tooltip */}
                    {tooltipOpen && tooltipData && (
                      <ChartTooltip top={tooltipTop} left={tooltipLeft} containerRef={gridRef}>
                        <div className="space-y-1">
                          <div className="text-[11px] font-mono text-muted">
                            {truncAddr(tooltipData.inAddr, 6)} &rarr; {truncAddr(tooltipData.outAddr, 6)}
                          </div>
                          {tooltipData.prob < 0 ? (
                            <div className="text-sm font-semibold text-muted italic">
                              N/A - partial result (timed out)
                            </div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-foreground">
                                {(tooltipData.prob * 100).toFixed(1)}%
                                <span className="text-xs font-normal text-muted ml-1.5">({tooltipData.count}/{tooltipData.total})</span>
                              </div>
                              <div className="text-[10px] font-medium" style={{ color: probColor(tooltipData.prob) }}>
                                {probLabel(tooltipData.prob)}
                              </div>
                            </>
                          )}
                        </div>
                      </ChartTooltip>
                    )}
                  </div>

                  {/* Right fade + expand pill */}
                  {hasMoreCols && (
                    <>
                      <div className="absolute top-0 right-0 bottom-0 w-10 pointer-events-none rounded-r-lg" style={{ background: "linear-gradient(to right, transparent, var(--card-bg))" }} />
                      <button onClick={() => setVisibleCols(Math.min(visibleCols + PAGE_SIZE, nOut))} className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-2 py-1 rounded-full bg-surface-elevated/90 backdrop-blur-sm border border-card-border text-[10px] text-muted hover:text-foreground hover:border-muted transition-all cursor-pointer shadow-sm z-10" title={t("boltzmann.showMoreColumns", { shown: visibleCols, total: nOut, defaultValue: "Show more columns ({{shown}}/{{total}})" })}>
                        +{Math.min(PAGE_SIZE, nOut - visibleCols)}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </>
                  )}

                  {/* Bottom fade + expand pill */}
                  {hasMoreRows && (
                    <>
                      <div className="absolute left-0 right-0 bottom-0 h-10 pointer-events-none rounded-b-lg" style={{ background: "linear-gradient(to bottom, transparent, var(--card-bg))" }} />
                      <button onClick={() => setVisibleRows(Math.min(visibleRows + PAGE_SIZE, nIn))} className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-2 py-1 rounded-full bg-surface-elevated/90 backdrop-blur-sm border border-card-border text-[10px] text-muted hover:text-foreground hover:border-muted transition-all cursor-pointer shadow-sm z-10" title={t("boltzmann.showMoreRows", { shown: visibleRows, total: nIn, defaultValue: "Show more rows ({{shown}}/{{total}})" })}>
                        +{Math.min(PAGE_SIZE, nIn - visibleRows)}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Color legend bar */}
                <div className="mt-2 px-1">
                  <div className="h-1 rounded-full w-full" style={{ background: `linear-gradient(to right, ${getColorStops().map(([stop, rgb]) => `rgb(${rgb.join(",")}) ${stop * 100}%`).join(", ")})` }} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-muted">0%</span>
                    <span className="text-[9px] text-muted">25%</span>
                    <span className="text-[9px] text-muted">50%</span>
                    <span className="text-[9px] text-muted">75%</span>
                    <span className="text-[9px] text-muted">100%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[8px] text-muted/70">{t("boltzmann.legend.noLink", { defaultValue: "No link" })}</span>
                    <span className="text-[8px] text-muted/70">{t("boltzmann.legend.ambiguous", { defaultValue: "Ambiguous" })}</span>
                    <span className="text-[8px] text-muted/70">{t("boltzmann.legend.probable", { defaultValue: "Probable" })}</span>
                    <span className="text-[8px] text-muted/70">{t("boltzmann.legend.likely", { defaultValue: "Likely" })}</span>
                    <span className="text-[8px] text-muted/70">{t("boltzmann.legend.deterministic", { defaultValue: "Deterministic" })}</span>
                  </div>
                </div>

                {/* Efficiency bar - only shown for CoinJoin txs */}
                {showEfficiency && (
                  <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.25 }} className="flex items-center gap-2 text-[10px] text-muted/60">
                    <span className="shrink-0">{t("boltzmann.efficiencyLabel", { defaultValue: "Efficiency:" })}</span>
                    <span className="font-mono">{effPct.toFixed(2)}%</span>
                    <div className="flex-1 h-1 bg-foreground/[0.06] rounded-full overflow-hidden max-w-[120px]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(effPct, 100)}%`, backgroundColor: effPct > 50 ? EFFICIENCY_COLORS.high : effPct > 20 ? EFFICIENCY_COLORS.mid : EFFICIENCY_COLORS.low }} />
                    </div>
                    <span className="text-muted/40">{t("boltzmann.efficiencyVsPerfect", { prfct: result.nbCmbnPrfctCj.toLocaleString(), defaultValue: "(vs. {{prfct}} perfect CJ)" })}</span>
                  </motion.div>
                )}
              </>
            );
          })()}
        </div>
    </GlowCard>
  );
}
