"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Search } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolTransaction } from "@/lib/api/types";

interface WalletTxListProps {
  addressInfos: WalletAddressInfo[];
  onScan: (txid: string) => void;
}

interface DedupedTx {
  tx: MempoolTransaction;
  addresses: string[];
}

export function WalletTxList({ addressInfos, onScan }: WalletTxListProps) {
  const { t } = useTranslation();
  const [expandedTxid, setExpandedTxid] = useState<string | null>(null);

  const dedupedTxs = useMemo(() => {
    const map = new Map<string, DedupedTx>();

    for (const info of addressInfos) {
      for (const tx of info.txs) {
        const existing = map.get(tx.txid);
        if (existing) {
          if (!existing.addresses.includes(info.derived.address)) {
            existing.addresses.push(info.derived.address);
          }
        } else {
          map.set(tx.txid, { tx, addresses: [info.derived.address] });
        }
      }
    }

    // Sort by block time descending (newest first), unconfirmed at top
    const sorted = [...map.values()].sort((a, b) => {
      const timeA = a.tx.status.block_time ?? Infinity;
      const timeB = b.tx.status.block_time ?? Infinity;
      return timeB - timeA;
    });

    return sorted;
  }, [addressInfos]);

  if (dedupedTxs.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-4">
        {t("wallet.noTxs", { defaultValue: "No transactions found." })}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {dedupedTxs.map(({ tx, addresses }) => {
        const isExpanded = expandedTxid === tx.txid;
        const fee = tx.fee ?? 0;
        const date = tx.status.block_time
          ? new Date(tx.status.block_time * 1000).toLocaleDateString()
          : t("wallet.unconfirmed", { defaultValue: "Unconfirmed" });

        return (
          <div key={tx.txid} className="rounded-lg border border-card-border overflow-hidden">
            {/* Row header */}
            <button
              onClick={() => setExpandedTxid(isExpanded ? null : tx.txid)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
            >
              <ChevronDown
                size={14}
                className={`text-muted transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
              />

              {/* Truncated txid */}
              <span className="font-mono text-xs text-foreground/80 flex-shrink-0">
                {tx.txid.slice(0, 10)}...{tx.txid.slice(-4)}
              </span>

              {/* Date */}
              <span className="text-xs text-muted flex-shrink-0 hidden sm:inline">
                {date}
              </span>

              {/* In/out count */}
              <span className="text-xs text-muted flex-shrink-0">
                {t("wallet.tx_inOut", { inputs: tx.vin.length, outputs: tx.vout.length, defaultValue: "{{inputs}}in/{{outputs}}out" })}
              </span>

              {/* Fee */}
              {fee > 0 && (
                <span className="text-xs text-muted flex-shrink-0 hidden sm:inline">
                  {t("wallet.tx_satsFee", { fee: fee.toLocaleString("en-US"), defaultValue: "{{fee}} sats fee" })}
                </span>
              )}

              {/* Address chips */}
              <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
                {addresses.slice(0, 3).map(addr => (
                  <span
                    key={addr}
                    className="text-[10px] font-mono bg-surface-elevated px-1.5 py-0.5 rounded text-muted truncate max-w-[80px]"
                  >
                    {addr.slice(0, 8)}...
                  </span>
                ))}
                {addresses.length > 3 && (
                  <span className="text-[10px] text-muted">
                    +{addresses.length - 3}
                  </span>
                )}
              </div>
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
                    {/* Full txid */}
                    <div className="font-mono text-xs text-foreground/90 break-all">
                      {tx.txid}
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap gap-4 text-xs text-muted">
                      <span>
                        {t("wallet.tx_date", { defaultValue: "Date:" })}{" "}
                        <span className="text-foreground">{date}</span>
                      </span>
                      <span>
                        {t("wallet.tx_inputs", { defaultValue: "Inputs:" })}{" "}
                        <span className="text-foreground">{tx.vin.length}</span>
                      </span>
                      <span>
                        {t("wallet.tx_outputs", { defaultValue: "Outputs:" })}{" "}
                        <span className="text-foreground">{tx.vout.length}</span>
                      </span>
                      {fee > 0 && (
                        <span>
                          {t("wallet.tx_fee", { defaultValue: "Fee:" })}{" "}
                          <span className="text-foreground">{fee.toLocaleString("en-US")} sats</span>
                        </span>
                      )}
                      {tx.status.confirmed && tx.status.block_height && (
                        <span>
                          {t("wallet.tx_block", { defaultValue: "Block:" })}{" "}
                          <span className="text-foreground">#{tx.status.block_height.toLocaleString("en-US")}</span>
                        </span>
                      )}
                    </div>

                    {/* Involved addresses */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted uppercase tracking-wider">
                        {t("wallet.tx_walletAddresses", { defaultValue: "Wallet addresses involved" })}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {addresses.map(addr => (
                          <span
                            key={addr}
                            className="text-[10px] font-mono bg-surface-inset px-2 py-0.5 rounded text-foreground/80"
                          >
                            {addr.slice(0, 12)}...{addr.slice(-6)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Scan button */}
                    <button
                      onClick={() => onScan(tx.txid)}
                      className="flex items-center gap-1.5 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                    >
                      <Search size={12} />
                      {t("wallet.scanTx", { defaultValue: "Scan this transaction" })}
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
