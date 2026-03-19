"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Copy, Check, Search } from "lucide-react";
import { P2PKH_DUST_LIMIT, TOXIC_CHANGE_THRESHOLD } from "@/lib/constants";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";

interface WalletAddressTableProps {
  addressInfos: WalletAddressInfo[];
  onScan: (address: string) => void;
}

interface ScoredAddress {
  info: WalletAddressInfo;
  score: number;
  status: "reused" | "dust" | "toxic" | "clean" | "unused";
  txCount: number;
  balance: number;
  fundedCount: number;
}

const STATUS_CLASS: Record<string, string> = {
  reused: "bg-severity-critical/15 text-severity-critical",
  dust: "bg-severity-medium/15 text-severity-medium",
  toxic: "bg-severity-high/15 text-severity-high",
  clean: "bg-severity-good/15 text-severity-good",
  unused: "bg-surface-elevated text-muted",
};

const STATUS_KEY: Record<string, { key: string; defaultValue: string }> = {
  reused: { key: "wallet.status_reused", defaultValue: "Reused" },
  dust: { key: "wallet.status_dust", defaultValue: "Dust" },
  toxic: { key: "wallet.status_toxic", defaultValue: "Toxic change" },
  clean: { key: "wallet.status_clean", defaultValue: "Clean" },
  unused: { key: "wallet.status_unused", defaultValue: "Unused" },
};

function scoreAddress(info: WalletAddressInfo): ScoredAddress {
  const { addressData, utxos } = info;
  let score = 0;
  let txCount = 0;
  let fundedCount = 0;

  if (addressData) {
    txCount = addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count;
    fundedCount = addressData.chain_stats.funded_txo_count + addressData.mempool_stats.funded_txo_count;
  }

  const balance = utxos.reduce((sum, u) => sum + u.value, 0);
  const hasDust = utxos.some(u => u.value < P2PKH_DUST_LIMIT);
  const hasToxic = utxos.some(u => u.value >= P2PKH_DUST_LIMIT && u.value < TOXIC_CHANGE_THRESHOLD);

  if (fundedCount > 1) score -= 10;
  if (hasDust) score -= 5;
  if (hasToxic) score -= 3;

  let status: ScoredAddress["status"] = "unused";
  if (txCount === 0) status = "unused";
  else if (fundedCount > 1) status = "reused";
  else if (hasDust) status = "dust";
  else if (hasToxic) status = "toxic";
  else status = "clean";

  return { info, score, status, txCount, balance, fundedCount };
}

export function WalletAddressTable({ addressInfos, onScan }: WalletAddressTableProps) {
  const { t } = useTranslation();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const scored = useMemo(() => {
    const items = addressInfos.map(scoreAddress);
    // Sort: worst offenders first, unused last
    items.sort((a, b) => {
      if (a.status === "unused" && b.status !== "unused") return 1;
      if (a.status !== "unused" && b.status === "unused") return -1;
      return a.score - b.score;
    });
    return items;
  }, [addressInfos]);

  const handleCopy = useCallback(async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(addr);
      setTimeout(() => setCopiedAddr(null), 1500);
    } catch {
      // clipboard not available
    }
  }, []);

  return (
    <div className="space-y-1">
      {scored.map((item, idx) => {
        const addr = item.info.derived.address;
        const isExpanded = expandedIdx === idx;
        const statusMeta = STATUS_KEY[item.status];
        const statusClass = STATUS_CLASS[item.status];

        return (
          <div key={addr} className="rounded-lg border border-card-border overflow-hidden">
            {/* Row header */}
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
            >
              <ChevronDown
                size={14}
                className={`text-muted transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
              />

              {/* Path + type badge */}
              <span className="text-xs font-mono text-muted flex-shrink-0 w-20">
                {item.info.derived.path}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                item.info.derived.isChange
                  ? "bg-surface-elevated text-muted"
                  : "bg-bitcoin/10 text-bitcoin"
              }`}>
                {item.info.derived.isChange
                  ? t("wallet.change_label", { defaultValue: "change" })
                  : t("wallet.receive_label", { defaultValue: "receive" })}
              </span>

              {/* Truncated address */}
              <span className="font-mono text-xs text-foreground/80 truncate flex-1 min-w-0">
                {addr.slice(0, 12)}...{addr.slice(-6)}
              </span>

              {/* TX count */}
              <span className="text-xs text-muted flex-shrink-0">
                {item.txCount > 0 ? `${item.txCount} tx` : ""}
              </span>

              {/* Balance */}
              {item.balance > 0 && (
                <span className="text-xs text-foreground font-medium flex-shrink-0 hidden sm:inline">
                  {item.balance.toLocaleString("en-US")} sats
                </span>
              )}

              {/* Status badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${statusClass}`}>
                {t(statusMeta.key, { defaultValue: statusMeta.defaultValue })}
              </span>
            </button>

            {/* Expanded details */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-card-border">
                    {/* Full address */}
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground/90 break-all flex-1">
                        {addr}
                      </span>
                      <button
                        onClick={() => handleCopy(addr)}
                        className="text-muted hover:text-foreground transition-colors p-1 cursor-pointer flex-shrink-0"
                        aria-label="Copy address"
                      >
                        {copiedAddr === addr ? <Check size={14} className="text-severity-good" /> : <Copy size={14} />}
                      </button>
                    </div>

                    {/* Stats row */}
                    {item.txCount > 0 && (
                      <div className="flex flex-wrap gap-4 text-xs text-muted">
                        <span>
                          {t("wallet.addr_txCount", { defaultValue: "Transactions:" })}{" "}
                          <span className="text-foreground">{item.txCount}</span>
                        </span>
                        <span>
                          {t("wallet.addr_funded", { defaultValue: "Times funded:" })}{" "}
                          <span className={item.fundedCount > 1 ? "text-severity-critical" : "text-foreground"}>
                            {item.fundedCount}
                          </span>
                        </span>
                        <span>
                          {t("wallet.addr_utxos", { defaultValue: "UTXOs:" })}{" "}
                          <span className="text-foreground">{item.info.utxos.length}</span>
                        </span>
                        <span>
                          {t("wallet.addr_balance", { defaultValue: "Balance:" })}{" "}
                          <span className="text-foreground">{item.balance.toLocaleString("en-US")} sats</span>
                        </span>
                      </div>
                    )}

                    {/* UTXO list */}
                    {item.info.utxos.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted uppercase tracking-wider">
                          {t("wallet.addr_utxoList", { defaultValue: "Unspent outputs" })}
                        </span>
                        <div className="space-y-0.5">
                          {item.info.utxos.map(utxo => (
                            <div
                              key={`${utxo.txid}:${utxo.vout}`}
                              className="flex items-center justify-between text-xs font-mono bg-surface-inset rounded px-2 py-1"
                            >
                              <span className="text-muted truncate max-w-[180px]">
                                {utxo.txid.slice(0, 10)}...:{utxo.vout}
                              </span>
                              <div className="flex items-center gap-3">
                                <span className={`${utxo.value < P2PKH_DUST_LIMIT ? "text-severity-medium" : "text-foreground"}`}>
                                  {utxo.value.toLocaleString("en-US")} sats
                                </span>
                                {utxo.status.confirmed && (
                                  <span className="text-muted text-[10px]">
                                    {utxo.status.block_height ? `#${utxo.status.block_height.toLocaleString("en-US")}` : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Compact tx list */}
                    {item.info.txs.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted uppercase tracking-wider">
                          {t("wallet.addr_txList", { defaultValue: "Transactions" })}
                        </span>
                        <div className="space-y-0.5 max-h-40 overflow-y-auto">
                          {item.info.txs.map(tx => (
                            <div
                              key={tx.txid}
                              className="flex items-center justify-between text-xs font-mono bg-surface-inset rounded px-2 py-1"
                            >
                              <span className="text-muted truncate max-w-[180px]">
                                {tx.txid.slice(0, 12)}...
                              </span>
                              <div className="flex items-center gap-2">
                                {tx.status.block_time && (
                                  <span className="text-muted text-[10px]">
                                    {new Date(tx.status.block_time * 1000).toLocaleDateString()}
                                  </span>
                                )}
                                <span className="text-muted">{t("wallet.tx_inOut", { inputs: tx.vin.length, outputs: tx.vout.length, defaultValue: "{{inputs}}in/{{outputs}}out" })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scan button */}
                    <button
                      onClick={() => onScan(addr)}
                      className="flex items-center gap-1.5 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                    >
                      <Search size={12} />
                      {t("wallet.scanAddress", { defaultValue: "Scan this address" })}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
