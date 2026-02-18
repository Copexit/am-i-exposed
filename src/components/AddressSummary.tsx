"use client";

import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import type { MempoolAddress } from "@/lib/api/types";

interface AddressSummaryProps {
  address: MempoolAddress;
}

/**
 * Visual address summary showing key stats:
 * balance, tx count, funded/spent UTXOs.
 */
export function AddressSummary({ address: addr }: AddressSummaryProps) {
  const { chain_stats, mempool_stats } = addr;

  const totalReceived = chain_stats.funded_txo_sum + mempool_stats.funded_txo_sum;
  const totalSent = chain_stats.spent_txo_sum + mempool_stats.spent_txo_sum;
  const balance = totalReceived - totalSent;
  const txCount = chain_stats.tx_count + mempool_stats.tx_count;
  const utxoCount =
    chain_stats.funded_txo_count +
    mempool_stats.funded_txo_count -
    chain_stats.spent_txo_count -
    mempool_stats.spent_txo_count;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="w-full bg-card-bg border border-card-border rounded-xl p-5"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          icon={<Wallet size={14} className="text-bitcoin" />}
          label="Balance"
          value={formatBtc(balance)}
        />
        <Stat
          icon={<ArrowDownLeft size={14} className="text-severity-good" />}
          label="Received"
          value={formatBtc(totalReceived)}
        />
        <Stat
          icon={<ArrowUpRight size={14} className="text-severity-high" />}
          label="Sent"
          value={formatBtc(totalSent)}
        />
        <Stat
          label="Transactions"
          value={txCount.toLocaleString()}
          sub={`${utxoCount} UTXO${utxoCount !== 1 ? "s" : ""}`}
        />
      </div>
    </motion.div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-sm font-mono text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted/50">{sub}</div>}
    </div>
  );
}

function formatBtc(sats: number): string {
  if (sats === 0) return "0 BTC";
  const btc = sats / 100_000_000;
  if (btc >= 1) return `${btc.toFixed(4)} BTC`;
  if (btc >= 0.001) return `${btc.toFixed(6)} BTC`;
  return `${sats.toLocaleString()} sats`;
}
