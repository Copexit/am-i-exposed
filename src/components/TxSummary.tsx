"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, Search } from "lucide-react";
import type { MempoolTransaction } from "@/lib/api/types";
import { formatTimeAgo } from "@/lib/i18n/format";
import { formatSats } from "@/lib/format";

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
  const { t, i18n } = useTranslation();
  // Address-reuse change detection: output address matches any input address
  const inputAddresses = new Set(
    tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean) as string[],
  );
  const reuseChangeIndices = new Set<number>();
  for (let idx = 0; idx < tx.vout.length; idx++) {
    const outAddr = tx.vout[idx].scriptpubkey_address;
    if (outAddr && inputAddresses.has(outAddr)) reuseChangeIndices.add(idx);
  }
  // Heuristic change detection for 2-output txs (only when no address-reuse detected)
  const likelyChangeIdx = reuseChangeIndices.size > 0
    ? -1
    : (changeOutputIndex ?? detectLikelyChange(tx));
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
      className="w-full bg-card-bg border border-card-border rounded-xl p-6 space-y-4"
    >
      <div className="flex items-center justify-between text-sm text-muted uppercase tracking-wider">
        <span>
          {t("tx.inputCount", { count: tx.vin.length, defaultValue: "{{count}} inputs" })}
        </span>
        <ArrowRight size={12} />
        <span>
          {t("tx.outputCount", { count: tx.vout.length, defaultValue: "{{count}} outputs" })}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start overflow-hidden">
        {/* Inputs */}
        <div className="space-y-2 min-w-0">
          {inputsToShow.map((vin, i) => {
            const addr = vin.prevout?.scriptpubkey_address;
            const isHighlighted = highlightAddress && addr === highlightAddress;
            return (
              <div
                key={i}
                className={`text-xs font-mono truncate ${isHighlighted ? "text-bitcoin font-semibold" : "text-foreground"}`}
                title={addr ?? "coinbase"}
              >
                {vin.is_coinbase ? (
                  "coinbase"
                ) : addr && onAddressClick ? (
                  <button
                    onClick={() => onAddressClick(addr)}
                    className="inline-flex items-center gap-1 hover:text-bitcoin transition-colors cursor-pointer py-2 group/addr"
                    title={t("tx.scanAddress", { defaultValue: "Scan {{address}}", address: addr })}
                  >
                    {truncateAddr(addr)}
                    <Search size={12} className="shrink-0 opacity-0 group-hover/addr:opacity-100 transition-opacity" />
                  </button>
                ) : (
                  truncateAddr(addr ?? "?")
                )}
                {vin.prevout && !vin.is_coinbase && (
                  <span className="text-muted ml-1">
                    {formatSats(vin.prevout.value, i18n.language)}
                  </span>
                )}
              </div>
            );
          })}
          {hiddenInputs > 0 && (
            <div className="text-xs text-muted">
              {t("tx.moreItems", { count: hiddenInputs, defaultValue: "+{{count}} more" })}
            </div>
          )}
        </div>

        {/* Arrow column */}
        <div className="flex items-center justify-center pt-1">
          <ArrowRight size={14} className="text-muted" />
        </div>

        {/* Outputs */}
        <div className="space-y-2 min-w-0">
          {outputsToShow.map((vout, i) => {
            const anonSet = valueCounts.get(vout.value) ?? 1;
            const color = groupColors.get(vout.value);
            const outAddr = vout.scriptpubkey_address;
            const isHighlighted = highlightAddress && outAddr === highlightAddress;
            return (
              <div
                key={i}
                className={`text-xs font-mono truncate ${isHighlighted ? "text-bitcoin font-semibold" : (color ?? "text-foreground")}`}
                title={outAddr ?? vout.scriptpubkey_type}
              >
                {outAddr && onAddressClick ? (
                  <button
                    onClick={() => onAddressClick(outAddr)}
                    className="inline-flex items-center gap-1 hover:text-bitcoin transition-colors cursor-pointer py-2 group/addr"
                    title={t("tx.scanAddress", { defaultValue: "Scan {{address}}", address: outAddr })}
                  >
                    {truncateAddr(outAddr)}
                    <Search size={12} className="shrink-0 opacity-0 group-hover/addr:opacity-100 transition-opacity" />
                  </button>
                ) : (
                  formatOutputAddr(vout)
                )}
                <span className="text-muted ml-1">
                  {formatSats(vout.value, i18n.language)}
                </span>
                {anonSet >= 2 && (
                  <span className={`ml-1 ${color ?? "text-muted"}`}>
                    [{anonSet}x]
                  </span>
                )}
                {reuseChangeIndices.has(i) && (
                  <span className="ml-1 text-severity-high text-xs font-semibold">
                    {t("tx.changeConfirmed", { defaultValue: "change" })}
                  </span>
                )}
                {i === likelyChangeIdx && (
                  <span className="ml-1 text-severity-medium text-xs">
                    {t("tx.changeHint", { defaultValue: "change?" })}
                  </span>
                )}
              </div>
            );
          })}
          {hiddenOutputs > 0 && (
            <div className="text-xs text-muted">
              {t("tx.moreItems", { count: hiddenOutputs, defaultValue: "+{{count}} more" })}
            </div>
          )}
        </div>
      </div>

      {/* Fee + size */}
      <div className="flex items-center justify-between text-sm text-muted border-t border-card-border pt-2">
        <span>
          {t("tx.fee", { amount: formatSats(tx.fee, i18n.language), rate: feeRate(tx), defaultValue: "Fee: {{amount}} ({{rate}} sat/vB)" })}
        </span>
        <span>
          {tx.weight.toLocaleString(i18n.language)} WU / {Math.ceil(tx.weight / 4).toLocaleString(i18n.language)} vB
        </span>
      </div>

      {/* Confirmation status */}
      {tx.status.confirmed ? (
        <div className="flex items-center justify-center gap-2 text-sm text-severity-good/70">
          <span className="w-1.5 h-1.5 rounded-full bg-severity-good/50" />
          {t("tx.confirmedInBlock", { block: tx.status.block_height?.toLocaleString(i18n.language), defaultValue: "Confirmed in block {{block}}" })}
          {tx.status.block_time && (
            <span className="text-muted">
              ({formatTimeAgo(tx.status.block_time, i18n.language)})
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-severity-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-severity-medium animate-pulse" />
          {t("tx.unconfirmed", { defaultValue: "Unconfirmed (in mempool)" })}
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


function feeRate(tx: MempoolTransaction): string {
  const vsize = Math.ceil(tx.weight / 4);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}

