"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import type { MempoolAddress } from "@/lib/api/types";
import { formatSats } from "@/lib/format";

interface AddressSummaryProps {
  address: MempoolAddress;
}

/**
 * Visual address summary showing key stats:
 * balance, tx count, funded/spent UTXOs.
 */
export function AddressSummary({ address: addr }: AddressSummaryProps) {
  const { t, i18n } = useTranslation();
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
      className="w-full glass rounded-xl p-6"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          icon={<Wallet size={14} className="text-bitcoin" />}
          label={t("address.balance", { defaultValue: "Balance" })}
          value={formatSats(balance, i18n.language)}
        />
        <Stat
          icon={<ArrowDownLeft size={14} className="text-severity-good" />}
          label={t("address.received", { defaultValue: "Received" })}
          value={formatSats(totalReceived, i18n.language)}
        />
        <Stat
          icon={<ArrowUpRight size={14} className="text-severity-high" />}
          label={t("address.sent", { defaultValue: "Sent" })}
          value={formatSats(totalSent, i18n.language)}
        />
        <Stat
          label={t("address.transactions", { defaultValue: "Transactions" })}
          value={txCount.toLocaleString(i18n.language)}
          sub={t("address.utxoCount", { count: utxoCount, defaultValue: "{{count}} UTXOs" })}
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
      <div className="flex items-center gap-1.5 text-sm text-muted uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-sm font-mono text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

