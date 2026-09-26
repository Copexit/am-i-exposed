"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { MempoolTransaction } from "@/lib/api/types";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";
import { COLORS, hexToRgba } from "@/lib/palette";

/** Rows shown per side before "+N more". */
export const MAX_ROWS = 4;

export interface LiveRow {
  key: string;
  label: string;
  value: number;
  /** Share of the side's total value, 0..1 (drives the link width). */
  share: number;
  more?: number;
}

/**
 * The rows the scan draws for one side: the first MAX_ROWS in tx order, then
 * one "+N more" row carrying the remaining value. Pure, for testing.
 */
export function liveRows(items: { label: string; value: number }[], keyPrefix: string): LiveRow[] {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const shown = items.length > MAX_ROWS + 1 ? items.slice(0, MAX_ROWS) : items;
  const rows: LiveRow[] = shown.map((it, i) => ({ key: `${keyPrefix}${i}`, label: it.label, value: it.value, share: it.value / total }));
  if (shown.length < items.length) {
    const rest = items.slice(shown.length);
    const value = rest.reduce((s, i) => s + i.value, 0);
    rows.push({ key: `${keyPrefix}more`, label: "", value, share: value / total, more: rest.length });
  }
  return rows;
}

const W = 640, ROW_H = 40, GAP = 10, BOX_W = 184, PAD = 20;

/**
 * The real transaction, drawn while the chain trace runs: inputs and outputs
 * fill in with their actual addresses and values (link width = value share).
 * Only data already fetched is shown; nothing is inferred here.
 */
export function ScanTxLive({ tx, focus }: { tx: MempoolTransaction; focus: "in" | "out" | null }) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const ins = liveRows(
    tx.vin.map((v) => ({
      label: v.is_coinbase ? t("graph.coinbase", { defaultValue: "coinbase" }) : truncateId(v.prevout?.scriptpubkey_address ?? "?", 6),
      value: v.prevout?.value ?? 0,
    })),
    "i",
  );
  const outs = liveRows(
    tx.vout.map((o) => ({
      label: isOpReturnOutput(o) ? "OP_RETURN" : truncateId(o.scriptpubkey_address ?? "?", 6),
      value: o.value,
    })),
    "o",
  );
  const rowsMax = Math.max(ins.length, outs.length);
  const H = PAD * 2 + rowsMax * ROW_H + (rowsMax - 1) * GAP;
  const cx = W / 2, cy = H / 2;
  const yOf = (i: number, n: number) => cy - ((n * ROW_H + (n - 1) * GAP) / 2) + i * (ROW_H + GAP);
  const inX = 24, outX = W - 24 - BOX_W;
  const accent = (a: number) => hexToRgba(COLORS.bitcoin, a);
  const dim = hexToRgba(COLORS.foreground, 0.12);
  const fmt = (v: number) => formatSats(v, i18n.language);

  const row = (r: LiveRow, i: number, n: number, side: "in" | "out") => {
    const y = yOf(i, n);
    const x = side === "in" ? inX : outX;
    const lit = focus === side;
    const width = 1.2 + r.share * 10;
    const d = side === "in"
      ? `M${x + BOX_W} ${y + ROW_H / 2} C${cx - 70} ${y + ROW_H / 2}, ${cx - 90} ${cy}, ${cx - 26} ${cy}`
      : `M${cx + 26} ${cy} C${cx + 90} ${cy}, ${cx + 70} ${y + ROW_H / 2}, ${x} ${y + ROW_H / 2}`;
    const delay = reduced ? 0 : 0.08 * i + (side === "out" ? 0.25 : 0);
    return (
      <motion.g
        key={r.key}
        initial={reduced ? false : { opacity: 0, x: side === "in" ? -10 : 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, delay, ease: [0.2, 0, 0, 1] }}
      >
        <path d={d} stroke={lit ? accent(0.45) : dim} strokeWidth={width} strokeLinecap="round" fill="none" style={{ transition: "stroke 300ms" }} />
        {lit && <path d={side === "in" ? `M0 ${y + ROW_H / 2} H${x}` : `M${x + BOX_W} ${y + ROW_H / 2} H${W}`} stroke={accent(0.45)} strokeDasharray="3 5" />}
        <rect x={x} y={y} width={BOX_W} height={ROW_H} rx={7} fill="var(--surface-2)" stroke={lit ? accent(0.55) : "var(--hairline-strong)"} style={{ transition: "stroke 300ms" }} />
        <text x={x + 10} y={y + 16} fontSize={10} fill="var(--muted)" fontFamily="var(--font-geist-mono)">
          {r.more ? t("v2.stage.more", { n: r.more, defaultValue: "+{{n}} more" }) : r.label}
        </text>
        <text x={x + 10} y={y + 31} fontSize={11.5} fill="var(--foreground)" fontFamily="var(--font-geist-mono)">
          {fmt(r.value)}
        </text>
      </motion.g>
    );
  };

  const list = (title: string, rows: LiveRow[], side: "in" | "out") => (
    <div className="min-w-0">
      <p className={`v2-eyebrow mb-2 ${focus === side ? "text-bitcoin" : ""}`}>{title}</p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <motion.li
            key={r.key}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: reduced ? 0 : 0.06 * i }}
            className={`flex items-baseline justify-between gap-3 rounded-md border px-3 py-2 bg-surface-2 ${focus === side ? "border-bitcoin/40" : "border-hairline"}`}
          >
            <span className="v2-num text-xs text-muted truncate">
              {r.more ? t("v2.stage.more", { n: r.more, defaultValue: "+{{n}} more" }) : r.label}
            </span>
            <span className="v2-num text-xs text-foreground shrink-0">{fmt(r.value)}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      {/* Phones: a readable list (a scaled drawing would be too small to read). */}
      <div className="sm:hidden p-4 space-y-4">
        {list(t("v2.stage.inputs", { n: tx.vin.length, defaultValue: "Inputs · {{n}}" }), ins, "in")}
        {list(t("v2.stage.outputs", { n: tx.vout.length, defaultValue: "Outputs · {{n}}" }), outs, "out")}
        <p className="v2-num text-xs text-muted">{t("v2.stage.fee", { amount: fmt(tx.fee), defaultValue: "fee {{amount}}" })}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="hidden sm:block w-full h-auto max-h-[320px]" fill="none" role="img" aria-label={t("v2.scan.liveAria", { ins: tx.vin.length, outs: tx.vout.length, defaultValue: "Transaction with {{ins}} inputs and {{outs}} outputs" })}>
      {ins.map((r, i) => row(r, i, ins.length, "in"))}
      {outs.map((r, i) => row(r, i, outs.length, "out"))}
      <rect x={cx - 26} y={cy - 17} width={52} height={34} rx={9} fill="var(--surface-2)" stroke={accent(0.5)} />
      <text x={cx} y={cy + 4} fontSize={9.5} textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-geist-mono)">
        {t("v2.scan.fee", { defaultValue: "fee" })}
      </text>
      <text x={cx} y={cy + 30} fontSize={10} textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-geist-mono)">
        {fmt(tx.fee)}
      </text>
      </svg>
    </>
  );
}
