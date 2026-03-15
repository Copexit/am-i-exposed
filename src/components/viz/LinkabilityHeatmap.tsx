"use client";

import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Grid3X3, Clock, Link, Hash, AlertTriangle } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";
import { useBoltzmann } from "@/hooks/useBoltzmann";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { formatSats } from "@/lib/format";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { COLOR_STOPS, probColor, cellGlow, probTextColor, probLabel } from "./shared/linkabilityColors";
import type { MempoolTransaction } from "@/lib/api/types";

interface Props {
  tx: MempoolTransaction;
  /** Pre-computed Boltzmann result from the analysis pipeline. */
  boltzmannResult?: BoltzmannWorkerResult | null;
}

/** Truncate address to first/last N chars. */
function truncAddr(addr: string | undefined, n = 4): string {
  if (!addr) return "?";
  if (addr.length <= n * 2 + 2) return addr;
  return `${addr.slice(0, n)}...${addr.slice(-n)}`;
}

/* ------------------------------------------------------------------ */
/*  Tooltip data                                                       */
/* ------------------------------------------------------------------ */

interface TooltipData {
  outAddr: string | undefined;
  inAddr: string | undefined;
  prob: number;
  count: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LinkabilityHeatmap({ tx, boltzmannResult: precomputed }: Props) {
  const { t } = useTranslation();
  const { state, compute, autoComputed, isSupported } = useBoltzmann(tx, precomputed);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [entered, setEntered] = useState(false);
  const [prevStatus, setPrevStatus] = useState(state.status);
  const gridRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const {
    tooltipOpen, tooltipData, tooltipLeft, tooltipTop,
    showTooltip, hideTooltip,
  } = useChartTooltip<TooltipData>();

  const isCoinbase = tx.vin.some(v => v.is_coinbase);

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
    tx.vout
      .filter(o => o.scriptpubkey_type !== "op_return" && o.value > 0)
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

  if (isCoinbase || !isSupported) return null;

  return (
    <GlowCard className="p-5 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Grid3X3 size={16} className="text-bitcoin shrink-0" />
        <h3 className="text-sm font-semibold text-foreground flex-1">
          {t("boltzmann.title", { defaultValue: "Link Probability Matrix" })}
        </h3>
        <span className="text-xs text-muted">
          {t("boltzmann.subtitle", { defaultValue: "Boltzmann analysis" })}
        </span>
      </div>

      <div className="mt-4 space-y-4">
          {/* Idle - manual compute button */}
          {state.status === "idle" && !autoComputed && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-muted">
                {t("boltzmann.largeTxInfo", {
                  defaultValue: "This transaction has {{nIn}} inputs and {{nOut}} outputs. Computation may take a long time.",
                  nIn,
                  nOut,
                })}
              </p>
              <button
                onClick={compute}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-bitcoin border border-bitcoin/30 rounded-lg hover:bg-bitcoin/10 transition-colors cursor-pointer"
              >
                <Grid3X3 size={14} />
                {t("boltzmann.compute", { defaultValue: "Compute Boltzmann LPM" })}
              </button>
            </div>
          )}

          {/* Loading / Computing with progress */}
          {(state.status === "loading" || state.status === "computing") && (
            <div className="text-center py-8 space-y-3">
              {/* Progress bar */}
              <div className="mx-auto max-w-xs">
                <div className="h-1.5 bg-surface-inset rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-bitcoin rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${Math.round((state.progress?.fraction ?? 0) * 100)}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
              </div>

              {/* Percentage + time estimate */}
              <p className="text-xs text-muted">
                {state.progress && state.progress.fraction > 0
                  ? `${Math.round(state.progress.fraction * 100)}%`
                  : t("boltzmann.computing", { defaultValue: "Computing link probabilities..." })}
                {state.progress?.estimatedRemainingMs != null && state.progress.estimatedRemainingMs > 0 && (() => {
                  const secs = Math.ceil(state.progress.estimatedRemainingMs / 1000);
                  const mins = Math.floor(secs / 60);
                  const s = secs % 60;
                  const timeStr = mins > 0 ? `${mins}m ${s}s` : `${secs}s`;
                  return <span className="ml-2 text-muted/60">~{timeStr}</span>;
                })()}
              </p>
            </div>
          )}

          {/* Error */}
          {state.status === "error" && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-red-400">{state.error}</p>
              <button
                onClick={compute}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted border border-card-border rounded-lg hover:text-foreground transition-colors cursor-pointer"
              >
                {t("boltzmann.retry", { defaultValue: "Retry" })}
              </button>
            </div>
          )}

          {/* Unsupported */}
          {state.status === "unsupported" && (
            <p className="text-xs text-muted text-center py-4">
              {t("boltzmann.unsupported", { defaultValue: "Web Workers are required for Boltzmann analysis." })}
            </p>
          )}

          {/* Complete - results */}
          {state.status === "complete" && state.result && (() => {
            const result = state.result;
            const effPct = Math.min(result.efficiency, 1) * 100;

            return (
              <>
                {/* Stats pills */}
                <div className="flex flex-wrap gap-2">
                  <motion.span
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted"
                  >
                    <Hash size={11} />
                    {result.timedOut ? `${result.nbCmbn.toLocaleString()}+ interpretations (partial)` : t("boltzmann.interpretations", {
                      defaultValue: "{{num}} interpretations",
                      num: result.nbCmbn.toLocaleString(),
                    })}
                  </motion.span>
                  <motion.span
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 }}
                    className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted"
                  >
                    <Grid3X3 size={11} />
                    {result.timedOut
                      ? `${result.entropy.toFixed(2)}+ bits entropy (partial)`
                      : t("boltzmann.entropy", {
                          defaultValue: "{{bits}} bits entropy",
                          bits: result.entropy.toFixed(2),
                        })}
                  </motion.span>
                  <motion.span
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.075 }}
                    className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted"
                  >
                    <Grid3X3 size={11} />
                    {result.timedOut
                      ? `${(result.entropy / (nIn + nOut)).toFixed(2)}+ bits/UTXO (partial)`
                      : t("boltzmann.entropyPerUtxo", {
                          defaultValue: "{{bits}} bits/UTXO",
                          bits: (result.entropy / (nIn + nOut)).toFixed(2),
                        })}
                  </motion.span>
                  {result.deterministicLinks.length > 0 && (
                    <motion.span
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 }}
                      className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-2.5 py-1 text-xs"
                    >
                      <Link size={11} />
                      {t("boltzmann.deterministicLinks", {
                        defaultValue: "{{num}} deterministic links",
                        num: result.deterministicLinks.length,
                      })}
                    </motion.span>
                  )}
                  <motion.span
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                    className="inline-flex items-center gap-1.5 bg-surface-inset rounded-full px-2.5 py-1 text-xs text-muted"
                  >
                    <Clock size={11} />
                    {result.elapsedMs >= 1000
                      ? `${(result.elapsedMs / 1000).toFixed(1)}s`
                      : `${result.elapsedMs}ms`}
                  </motion.span>
                </div>

                {/* Timed out warning */}
                {result.timedOut && (
                  <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} />
                    {t("boltzmann.timedOut", {
                      defaultValue: "Computation timed out. Only deterministic links (100%) and zero-probability cells are reliable. Other cells are shown as N/A.",
                    })}
                  </div>
                )}

                {/* Heat map grid */}
                <div className="overflow-x-auto -mx-2 px-2">
                  <div
                    ref={gridRef}
                    className="relative bg-surface-inset/40 rounded-lg p-3 border border-white/[0.04]"
                  >
                    <div
                      className="grid gap-px w-full"
                      style={{
                        gridTemplateColumns: `minmax(90px, 120px) repeat(${nOut}, minmax(56px, 1fr))`,
                        gridTemplateRows: `auto repeat(${nIn}, minmax(44px, auto))`,
                      }}
                    >
                      {/* Top-left corner */}
                      <div className="text-[10px] text-muted/50 flex items-end justify-end pr-1 pb-0.5">
                        {t("boltzmann.gridLabel", { defaultValue: "In \\ Out" })}
                      </div>

                      {/* Column headers - outputs */}
                      {outputs.map((out, o) => {
                        const isColHovered = hoveredCell?.col === o;
                        return (
                          <div
                            key={`h-${o}`}
                            className="text-center px-1 pb-1 border-b border-white/[0.04]"
                          >
                            <button
                              onClick={() => out.address && (window.location.hash = `#addr=${out.address}`)}
                              className={`text-[11px] font-mono truncate transition-colors duration-150 block w-full hover:text-bitcoin cursor-pointer ${
                                isColHovered ? "text-foreground" : "text-muted"
                              }`}
                              title={out.address}
                            >
                              {truncAddr(out.address)}
                            </button>
                            <div className="text-[10px] text-muted/60">
                              {formatSats(out.value)}
                            </div>
                          </div>
                        );
                      })}

                      {/* Rows - one per input */}
                      {inputs.map((inp, i) => (
                        <Fragment key={`row-${i}`}>
                          {/* Row label */}
                          <div className="flex items-center justify-end pr-2 gap-1">
                            <div className="text-right">
                              <button
                                onClick={() => inp.address && (window.location.hash = `#addr=${inp.address}`)}
                                className={`text-[11px] font-mono truncate max-w-[100px] transition-colors duration-150 block ml-auto hover:text-bitcoin cursor-pointer ${
                                  hoveredCell?.row === i ? "text-foreground" : "text-muted"
                                }`}
                                title={inp.address}
                              >
                                {truncAddr(inp.address)}
                              </button>
                              <div className="text-[10px] text-muted/60">
                                {formatSats(inp.value)}
                              </div>
                            </div>
                          </div>

                          {/* Cells - matrix is [out][in], so access as [col][row] */}
                          {outputs.map((_out, o) => {
                            const prob = result.matLnkProbabilities[o]?.[i] ?? 0;
                            const count = result.matLnkCombinations[o]?.[i] ?? 0;
                            const isDeterministic = prob >= 1.0;
                            // When timed out, only deterministic (100%) and zero (0%) cells are reliable
                            const isUnreliable = result.timedOut && prob > 0 && prob < 1.0;
                            const displayProb = isUnreliable ? 0 : prob;
                            const isHovered = hoveredCell?.row === i && hoveredCell?.col === o;
                            const inCrosshair = hoveredCell !== null
                              && (hoveredCell.row === i || hoveredCell.col === o);
                            const dimmed = hoveredCell !== null && !inCrosshair;
                            const color = isUnreliable ? "rgb(30, 30, 40)" : probColor(displayProb);

                            return (
                              <motion.div
                                key={`c-${i}-${o}`}
                                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8 }}
                                animate={{
                                  opacity: dimmed ? 0.5 : 1,
                                  scale: isHovered ? 1.06 : 1,
                                }}
                                transition={
                                  entered
                                    ? { duration: 0.15 }
                                    : { duration: 0.25, delay: (i + o) * 0.03 }
                                }
                                className={`relative flex items-center justify-center rounded-sm cursor-default ${
                                  isDeterministic ? "ring-2 ring-red-500/70" : ""
                                } ${isHovered ? "z-10" : ""}`}
                                style={{
                                  backgroundColor: color,
                                  boxShadow: isUnreliable ? "none" : cellGlow(displayProb),
                                }}
                                onMouseEnter={(e) =>
                                  handleCellHover(e, i, o, isUnreliable ? -1 : prob, count, result.nbCmbn)
                                }
                                onMouseLeave={handleCellLeave}
                              >
                                <span
                                  className={`text-xs font-mono tabular-nums ${
                                    isUnreliable ? "text-white/20 italic" : probTextColor(displayProb)
                                  }`}
                                >
                                  {isUnreliable ? "N/A" : prob === 0 ? "-" : `${(prob * 100).toFixed(0)}%`}
                                </span>
                              </motion.div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>

                    {/* Legend bar */}
                    <div className="mt-3 pt-2 border-t border-white/[0.04]">
                      <div
                        className="h-1 rounded-full w-full"
                        style={{
                          background: `linear-gradient(to right, ${COLOR_STOPS.map(
                            ([stop, rgb]) => `rgb(${rgb.join(",")}) ${stop * 100}%`,
                          ).join(", ")})`,
                        }}
                      />
                      <div className="flex justify-between mt-1">
                        <span className="text-[9px] text-muted/50">0%</span>
                        <span className="text-[9px] text-muted/50">25%</span>
                        <span className="text-[9px] text-muted/50">50%</span>
                        <span className="text-[9px] text-muted/50">75%</span>
                        <span className="text-[9px] text-muted/50">100%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[8px] text-muted/40">No link</span>
                        <span className="text-[8px] text-muted/40">Ambiguous</span>
                        <span className="text-[8px] text-muted/40">Probable</span>
                        <span className="text-[8px] text-muted/40">Likely</span>
                        <span className="text-[8px] text-muted/40">Deterministic</span>
                      </div>
                    </div>

                    {/* Tooltip */}
                    {tooltipOpen && tooltipData && (
                      <ChartTooltip top={tooltipTop} left={tooltipLeft} containerRef={gridRef}>
                        <div className="space-y-1">
                          <div className="text-[11px] font-mono text-muted">
                            {truncAddr(tooltipData.inAddr, 6)} &rarr; {truncAddr(tooltipData.outAddr, 6)}
                          </div>
                          {tooltipData.prob < 0 ? (
                            <div className="text-sm font-semibold text-muted/50 italic">
                              N/A - partial result (timed out)
                            </div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-foreground">
                                {(tooltipData.prob * 100).toFixed(1)}%
                                <span className="text-xs font-normal text-muted ml-1.5">
                                  ({tooltipData.count}/{tooltipData.total})
                                </span>
                              </div>
                              <div
                                className="text-[10px] font-medium"
                                style={{ color: probColor(tooltipData.prob) }}
                              >
                                {probLabel(tooltipData.prob)}
                              </div>
                            </>
                          )}
                        </div>
                      </ChartTooltip>
                    )}
                  </div>
                </div>

                {/* Efficiency bar - hidden when timed out since partial data is meaningless */}
                {result.efficiency > 0 && !result.timedOut && (
                  <motion.div
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.25 }}
                    className="flex items-center gap-2 text-[10px] text-muted/60"
                  >
                    <span className="shrink-0">
                      {t("boltzmann.efficiencyLabel", { defaultValue: "Efficiency:" })}
                    </span>
                    <span className="font-mono">{effPct.toFixed(2)}%</span>
                    <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden max-w-[120px]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(effPct, 100)}%`,
                          backgroundColor:
                            effPct > 50 ? "#28a065" : effPct > 20 ? "#b59215" : "#d97706",
                        }}
                      />
                    </div>
                    <span className="text-muted/40">
                      (vs. {result.nbCmbnPrfctCj.toLocaleString()} perfect CJ)
                    </span>
                  </motion.div>
                )}
              </>
            );
          })()}
        </div>
    </GlowCard>
  );
}
