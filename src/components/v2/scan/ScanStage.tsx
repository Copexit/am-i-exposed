"use client";

import { motion, useReducedMotion } from "motion/react";
import type { MempoolTransaction } from "@/lib/api/types";
import { ScanTxLive } from "./ScanTxLive";

export interface ScanStageProps {
  kind: "tx" | "address" | "psbt";
  /** Side being traced right now: inputs (backward) or outputs (forward). */
  focus: "in" | "out" | null;
  /** 0..100 trace progress (max of time and depth), drawn on the bottom edge. */
  traceProgress: number | null;
  /** The fetched transaction: once known, the real inputs/outputs replace the skeleton. */
  tx?: MempoolTransaction | null;
}

const IN_Y = [44, 97, 150];
const OUT_Y = [70, 123];
const W = 640, H = 220, BOX_W = 150, BOX_H = 26;

/**
 * What is being scanned, with a slow scanning beam: a data-free skeleton until
 * the transaction is fetched, then its real inputs and outputs (ScanTxLive),
 * highlighting the side the chain trace is walking.
 */
export function ScanStage({ kind, focus, traceProgress, tx }: ScanStageProps) {
  const reduced = useReducedMotion();
  const backward = focus === "in";

  return (
    <div
      aria-hidden={tx ? undefined : true}
      className="relative overflow-hidden rounded-xl border border-hairline bg-surface-1"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 50% 50%, rgba(247,147,26,0.05), transparent 65%)," +
          "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px)," +
          "linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)",
        backgroundSize: "100% 100%, 100% 28px, 28px 100%",
      }}
    >
      {kind === "tx" && tx ? (
        <ScanTxLive tx={tx} focus={focus} />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto max-h-[240px]" fill="none">
          {kind === "address" ? <AddressSkeleton /> : <TxSkeleton focus={focus} unsigned={kind === "psbt"} />}
        </svg>
      )}

      {!reduced && (
        <motion.div
          className="absolute inset-y-0 left-0 w-full pointer-events-none"
          style={{ scaleX: backward ? -1 : 1 }}
        >
          <motion.div
            className="absolute inset-y-0 left-0 w-full"
            initial={{ x: "-100%" }}
            animate={{ x: "0%" }}
            transition={{ duration: 2.6, ease: [0.45, 0, 0.55, 1], repeat: Infinity, repeatDelay: 0.5 }}
          >
            <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-r from-transparent to-bitcoin/[0.07]" />
            <div
              className="absolute inset-y-0 right-0 w-[2px]"
              style={{
                background: "linear-gradient(transparent, rgba(247,147,26,0.85) 22%, rgba(255,255,255,0.9) 50%, rgba(247,147,26,0.85) 78%, transparent)",
                boxShadow: "0 0 16px 2px rgba(247,147,26,0.3)",
              }}
            />
          </motion.div>
        </motion.div>
      )}

      {traceProgress !== null && (
        <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-hairline">
          <div
            className="h-full bg-bitcoin/70 transition-[width] duration-300 ease-out"
            style={{ width: `${traceProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Box({ x, y, lit, dashed }: { x: number; y: number; lit: boolean; dashed?: boolean }) {
  return (
    <g>
      <rect
        x={x} y={y} width={BOX_W} height={BOX_H} rx={7}
        fill="var(--surface-2)"
        stroke={lit ? "rgba(247,147,26,0.55)" : "var(--hairline-strong)"}
        strokeDasharray={dashed ? "4 4" : undefined}
        style={{ transition: "stroke 300ms" }}
      />
      <rect x={x + 12} y={y + 9} width={62} height={8} rx={4} fill="rgba(255,255,255,0.08)" />
      <rect x={x + BOX_W - 48} y={y + 9} width={36} height={8} rx={4} fill="rgba(255,255,255,0.05)" />
    </g>
  );
}

function TxSkeleton({ focus, unsigned }: { focus: "in" | "out" | null; unsigned: boolean }) {
  const cx = W / 2, cy = H / 2;
  const inX = 40, outX = W - 40 - BOX_W;
  const link = (lit: boolean) => (lit ? "rgba(247,147,26,0.4)" : "rgba(255,255,255,0.1)");
  return (
    <g>
      {IN_Y.map((y) => (
        <g key={`i${y}`}>
          {focus === "in" && <path d={`M0 ${y + 13} H${inX}`} stroke="rgba(247,147,26,0.45)" strokeDasharray="3 5" />}
          <path d={`M${inX + BOX_W} ${y + 13} C${cx - 60} ${y + 13}, ${cx - 90} ${cy}, ${cx - 30} ${cy}`} stroke={link(focus === "in")} />
          <Box x={inX} y={y} lit={focus === "in"} dashed={unsigned} />
        </g>
      ))}
      {OUT_Y.map((y) => (
        <g key={`o${y}`}>
          {focus === "out" && <path d={`M${outX + BOX_W} ${y + 13} H${W}`} stroke="rgba(247,147,26,0.45)" strokeDasharray="3 5" />}
          <path d={`M${cx + 30} ${cy} C${cx + 90} ${cy}, ${cx + 60} ${y + 13}, ${outX} ${y + 13}`} stroke={link(focus === "out")} />
          <Box x={outX} y={y} lit={focus === "out"} dashed={unsigned} />
        </g>
      ))}
      <rect
        x={cx - 30} y={cy - 18} width={60} height={36} rx={9}
        fill="var(--surface-2)" stroke="rgba(247,147,26,0.5)" strokeDasharray={unsigned ? "4 4" : undefined}
      />
      <circle cx={cx} cy={cy} r={4} fill="var(--bitcoin)" opacity={0.85} />
    </g>
  );
}

function AddressSkeleton() {
  const ax = 40, ay = H / 2 - 20, rowsX = W - 40 - 260;
  const rows = [30, 70, 110, 150, 190].map((y) => y - 13);
  return (
    <g>
      {rows.map((y) => (
        <g key={y}>
          <path d={`M${ax + 190} ${ay + 20} C${ax + 250} ${ay + 20}, ${rowsX - 60} ${y + 13}, ${rowsX} ${y + 13}`} stroke="rgba(255,255,255,0.1)" />
          <rect x={rowsX} y={y} width={260} height={BOX_H} rx={7} fill="var(--surface-2)" stroke="var(--hairline-strong)" />
          <rect x={rowsX + 12} y={y + 9} width={120} height={8} rx={4} fill="rgba(255,255,255,0.07)" />
          <rect x={rowsX + 260 - 60} y={y + 9} width={48} height={8} rx={4} fill="rgba(255,255,255,0.05)" />
        </g>
      ))}
      <rect x={ax} y={ay} width={190} height={40} rx={10} fill="var(--surface-2)" stroke="rgba(247,147,26,0.5)" />
      <circle cx={ax + 20} cy={ay + 20} r={4} fill="var(--bitcoin)" opacity={0.85} />
      <rect x={ax + 34} y={ay + 16} width={130} height={8} rx={4} fill="rgba(255,255,255,0.1)" />
    </g>
  );
}
