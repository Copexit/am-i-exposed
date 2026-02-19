"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { MempoolTransaction } from "@/lib/api/types";

interface TxSummaryProps {
  tx: MempoolTransaction;
  changeOutputIndex?: number;
  onAddressClick?: (address: string) => void;
  /** When set, matching addresses render highlighted */
  highlightAddress?: string;
}

/**
 * Visual transaction summary showing inputs -> outputs with
 * anonymity set highlighting (equal outputs get matching colors).
 */
export function TxSummary({ tx, changeOutputIndex, onAddressClick, highlightAddress }: TxSummaryProps) {
  // Lightweight change detection for visual hint (only 2-output txs)
  const likelyChangeIdx = changeOutputIndex ?? detectLikelyChange(tx);
  // Calculate anonymity sets (output value -> count)
  const valueCounts = new Map<number, number>();
  for (const out of tx.vout) {
    valueCounts.set(out.value, (valueCounts.get(out.value) ?? 0) + 1);
  }

  // Assign colors to equal-value groups
  const groupColors = new Map<number, string>();
  const colors = [
    "text-severity-good",
    "text-bitcoin",
    "text-info",
    "text-severity-medium",
    "text-severity-high",
  ];
  let colorIdx = 0;
  for (const [value, count] of valueCounts) {
    if (count >= 2) {
      groupColors.set(value, colors[colorIdx % colors.length]);
      colorIdx++;
    }
  }

  const maxDisplay = 8;
  const inputsToShow = tx.vin.slice(0, maxDisplay);
  const outputsToShow = tx.vout.slice(0, maxDisplay);
  const hiddenInputs = tx.vin.length - maxDisplay;
  const hiddenOutputs = tx.vout.length - maxDisplay;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="w-full bg-card-bg border border-card-border rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between text-xs text-muted uppercase tracking-wider">
        <span>
          {tx.vin.length} input{tx.vin.length !== 1 ? "s" : ""}
        </span>
        <ArrowRight size={12} />
        <span>
          {tx.vout.length} output{tx.vout.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start overflow-hidden">
        {/* Inputs */}
        <div className="space-y-1 min-w-0">
          {inputsToShow.map((vin, i) => {
            const addr = vin.prevout?.scriptpubkey_address;
            const isHighlighted = highlightAddress && addr === highlightAddress;
            return (
              <div
                key={i}
                className={`text-xs font-mono truncate ${isHighlighted ? "text-bitcoin font-semibold" : "text-foreground/80"}`}
                title={addr ?? "coinbase"}
              >
                {vin.is_coinbase ? (
                  "coinbase"
                ) : addr && onAddressClick ? (
                  <button
                    onClick={() => onAddressClick(addr)}
                    className="hover:text-bitcoin transition-colors cursor-pointer py-0.5"
                    title={`Scan ${addr}`}
                  >
                    {truncateAddr(addr)}
                  </button>
                ) : (
                  truncateAddr(addr ?? "?")
                )}
                {vin.prevout && !vin.is_coinbase && (
                  <span className="text-muted ml-1">
                    {formatSats(vin.prevout.value)}
                  </span>
                )}
              </div>
            );
          })}
          {hiddenInputs > 0 && (
            <div className="text-xs text-muted/90">
              +{hiddenInputs} more
            </div>
          )}
        </div>

        {/* Arrow column */}
        <div className="flex items-center justify-center pt-1">
          <ArrowRight size={14} className="text-muted/90" />
        </div>

        {/* Outputs */}
        <div className="space-y-1 min-w-0">
          {outputsToShow.map((vout, i) => {
            const anonSet = valueCounts.get(vout.value) ?? 1;
            const color = groupColors.get(vout.value);
            const outAddr = vout.scriptpubkey_address;
            const isHighlighted = highlightAddress && outAddr === highlightAddress;
            return (
              <div
                key={i}
                className={`text-xs font-mono truncate ${isHighlighted ? "text-bitcoin font-semibold" : (color ?? "text-foreground/80")}`}
                title={outAddr ?? vout.scriptpubkey_type}
              >
                {outAddr && onAddressClick ? (
                  <button
                    onClick={() => onAddressClick(outAddr)}
                    className="hover:text-bitcoin transition-colors cursor-pointer py-0.5"
                    title={`Scan ${outAddr}`}
                  >
                    {truncateAddr(outAddr)}
                  </button>
                ) : (
                  formatOutputAddr(vout)
                )}
                <span className="text-muted ml-1">
                  {formatSats(vout.value)}
                </span>
                {anonSet >= 2 && (
                  <span className={`ml-1 ${color ?? "text-muted"}`}>
                    [{anonSet}x]
                  </span>
                )}
                {i === likelyChangeIdx && (
                  <span className="ml-1 text-severity-medium text-[10px]">
                    change?
                  </span>
                )}
              </div>
            );
          })}
          {hiddenOutputs > 0 && (
            <div className="text-xs text-muted/90">
              +{hiddenOutputs} more
            </div>
          )}
        </div>
      </div>

      {/* Fee + size */}
      <div className="flex items-center justify-between text-xs text-muted border-t border-card-border pt-2">
        <span>
          Fee: {formatSats(tx.fee)} ({feeRate(tx)} sat/vB)
        </span>
        <span>
          {tx.weight} WU / {Math.ceil(tx.weight / 4)} vB
        </span>
      </div>

      {/* Confirmation status */}
      {tx.status.confirmed ? (
        <div className="flex items-center justify-center gap-2 text-xs text-severity-good/70">
          <span className="w-1.5 h-1.5 rounded-full bg-severity-good/50" />
          Confirmed in block {tx.status.block_height?.toLocaleString()}
          {tx.status.block_time && (
            <span className="text-muted/90">
              ({formatTimeAgo(tx.status.block_time)})
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-xs text-severity-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-severity-medium animate-pulse" />
          Unconfirmed (in mempool)
        </div>
      )}
    </motion.div>
  );
}

/**
 * Quick heuristic: for 2-output txs, guess which output is change.
 * Returns the output index (0 or 1) or -1 if uncertain.
 */
function detectLikelyChange(tx: MempoolTransaction): number {
  if (tx.vout.length !== 2) return -1;
  if (!tx.vout[0].scriptpubkey_address || !tx.vout[1].scriptpubkey_address) return -1;
  if (tx.vin.some((v) => v.is_coinbase)) return -1;

  let score0 = 0;
  let score1 = 0;

  // Check input address type match
  const inputTypes = new Set<string>();
  for (const v of tx.vin) {
    if (v.prevout?.scriptpubkey_type) inputTypes.add(v.prevout.scriptpubkey_type);
  }
  if (inputTypes.size === 1) {
    const iType = [...inputTypes][0];
    if (tx.vout[0].scriptpubkey_type === iType && tx.vout[1].scriptpubkey_type !== iType) score0++;
    if (tx.vout[1].scriptpubkey_type === iType && tx.vout[0].scriptpubkey_type !== iType) score1++;
  }

  // Check round amounts (round output = payment, non-round = change)
  const r0 = tx.vout[0].value % 10_000 === 0;
  const r1 = tx.vout[1].value % 10_000 === 0;
  if (r0 && !r1) score1++;
  if (r1 && !r0) score0++;

  if (score0 > score1 && score0 >= 1) return 0;
  if (score1 > score0 && score1 >= 1) return 1;
  return -1;
}

function formatOutputAddr(vout: { scriptpubkey_address?: string; scriptpubkey_type: string }): string {
  if (vout.scriptpubkey_type === "op_return") return "OP_RETURN";
  if (vout.scriptpubkey_address) return truncateAddr(vout.scriptpubkey_address);
  // Non-standard output types without a decoded address
  const typeLabels: Record<string, string> = {
    multisig: "Multisig",
    "p2ms": "Multisig",
    "nonstandard": "Non-standard",
    "nulldata": "OP_RETURN",
    "witness_unknown": "Unknown witness",
  };
  return typeLabels[vout.scriptpubkey_type] ?? vout.scriptpubkey_type;
}

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function formatSats(sats: number): string {
  if (sats >= 1_000_000_000) {
    return `${(sats / 100_000_000).toFixed(2)} BTC`;
  }
  if (sats >= 100_000_000) {
    return `${(sats / 100_000_000).toFixed(4)} BTC`;
  }
  if (sats >= 1_000_000) {
    return `${(sats / 100_000_000).toFixed(4)} BTC`;
  }
  if (sats >= 10_000) {
    return `${(sats / 1000).toFixed(1)}k`;
  }
  return `${sats.toLocaleString()}`;
}

function feeRate(tx: MempoolTransaction): string {
  const vsize = Math.ceil(tx.weight / 4);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}

function formatTimeAgo(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}
