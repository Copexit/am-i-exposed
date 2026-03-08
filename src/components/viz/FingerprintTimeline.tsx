"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  analyzeFingerprintEvolution,
  type FingerprintSnapshot,
} from "@/lib/analysis/chain/prospective";
import type { MempoolTransaction } from "@/lib/api/types";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { truncateId } from "@/lib/constants";

interface FingerprintTimelineProps {
  address: string;
  txs: MempoolTransaction[];
  onScan?: (txid: string) => void;
}

/** Map locktime type to a color for the timeline dot. */
function snapshotColor(s: FingerprintSnapshot): string {
  if (s.locktimeType === "block-randomized") return SVG_COLORS.good;
  if (s.locktimeType === "block-exact") return SVG_COLORS.low;
  if (s.locktimeType === "zero" && s.nVersion === 1) return SVG_COLORS.high;
  if (s.locktimeType === "zero") return SVG_COLORS.medium;
  return SVG_COLORS.muted;
}

/** Short label for locktime behavior */
function locktimeLabel(lt: FingerprintSnapshot["locktimeType"]): string {
  switch (lt) {
    case "zero": return "LT=0";
    case "block-exact": return "LT=tip";
    case "block-randomized": return "LT~rand";
    case "block-general": return "LT=block";
    case "timestamp": return "LT=time";
  }
}

export function FingerprintTimeline({ address, txs, onScan }: FingerprintTimelineProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const evolution = useMemo(
    () => analyzeFingerprintEvolution(address, txs),
    [address, txs],
  );

  if (evolution.snapshots.length < 2) return null;

  const { snapshots, transitions } = evolution;

  // Build a set of txids where transitions occur
  const transitionTxids = new Set(
    transitions.flatMap((tr) => [tr.fromTxid, tr.toTxid]),
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
        {t("viz.fingerprintTimeline", { defaultValue: "Wallet fingerprint timeline" })}
      </h3>

      {/* Timeline track */}
      <div className="relative overflow-x-auto">
        <div className="flex items-start gap-0 min-w-max py-2 px-1">
          {snapshots.map((snap, i) => {
            const color = snapshotColor(snap);
            const isTransition = transitionTxids.has(snap.txid);
            const transition = transitions.find(
              (tr) => tr.toTxid === snap.txid,
            );

            return (
              <div key={snap.txid} className="flex items-start">
                {/* Connector line (except first) */}
                {i > 0 && (
                  <div
                    className="h-0.5 mt-3 flex-shrink-0"
                    style={{
                      width: 32,
                      backgroundColor: isTransition
                        ? SVG_COLORS.high
                        : SVG_COLORS.cardBorder,
                    }}
                  />
                )}

                {/* Snapshot dot + label */}
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: i * ANIMATION_DEFAULTS.stagger,
                    duration: ANIMATION_DEFAULTS.duration,
                  }}
                  className="flex flex-col items-center flex-shrink-0"
                  style={{ width: 80 }}
                >
                  {/* Dot */}
                  <button
                    onClick={() => onScan?.(snap.txid)}
                    className="relative cursor-pointer group"
                    title={snap.txid}
                    aria-label={t("viz.fpScanTx", { txid: truncateId(snap.txid, 6), defaultValue: "Scan transaction {{txid}}" })}
                  >
                    <div
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform group-hover:scale-125"
                      style={{
                        borderColor: color,
                        backgroundColor: isTransition
                          ? color
                          : "transparent",
                      }}
                    >
                      {isTransition && (
                        <span className="text-[8px] font-bold text-black">!</span>
                      )}
                    </div>
                  </button>

                  {/* Labels */}
                  <span className="text-[10px] text-muted mt-1 font-mono">
                    {truncateId(snap.txid, 6)}
                  </span>
                  <span className="text-[9px] text-muted/70">
                    v{snap.nVersion} {locktimeLabel(snap.locktimeType)}
                  </span>
                  <span className="text-[9px] text-muted/70">
                    {snap.scriptTypes.join("+")}
                  </span>
                  {snap.hasRbf && (
                    <span className="text-[9px] text-severity-low">RBF</span>
                  )}

                  {/* Transition annotation */}
                  {transition && (
                    <div className="mt-1 text-[9px] text-severity-high text-center max-w-[76px] leading-tight">
                      {transition.changes.map((c, ci) => (
                        <div key={ci}>{c}</div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVG_COLORS.good }} />
          {t("viz.fpLegendRandomized", { defaultValue: "Randomized LT" })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVG_COLORS.low }} />
          {t("viz.fpLegendExact", { defaultValue: "Exact block LT" })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVG_COLORS.medium }} />
          {t("viz.fpLegendZero", { defaultValue: "Zero LT" })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="w-2 h-2 rounded-full border"
            style={{ borderColor: SVG_COLORS.high, backgroundColor: SVG_COLORS.high }}
          />
          {t("viz.fpLegendTransition", { defaultValue: "Fingerprint change" })}
        </span>
      </div>
    </div>
  );
}
