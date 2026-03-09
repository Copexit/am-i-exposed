"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Wallet, Building2, AlertTriangle } from "lucide-react";
import type { MempoolAddress } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { formatSats } from "@/lib/format";

interface AddressSummaryProps {
  address: MempoolAddress;
  findings?: Finding[];
}

/** Category labels for display. */
const CATEGORY_LABELS: Record<string, string> = {
  exchange: "Exchange",
  darknet: "Darknet Market",
  scam: "Scam",
  gambling: "Gambling",
  payment: "Payment Processor",
  mining: "Mining Pool",
  mixer: "Mixer",
  p2p: "P2P Platform",
};

/**
 * Visual address summary showing key stats:
 * balance, tx count, funded/spent UTXOs, and entity identification.
 */
export function AddressSummary({ address: addr, findings }: AddressSummaryProps) {
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

  // Check for entity identification finding
  const entityFinding = findings?.find((f) => f.id === "address-entity-identified");
  const entityName = entityFinding?.params?.entityName as string | undefined;
  const entityCategory = entityFinding?.params?.category as string | undefined;
  const entityCountry = entityFinding?.params?.country as string | undefined;
  const entityStatus = entityFinding?.params?.status as string | undefined;
  const isOfac = entityFinding?.params?.ofac === 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="w-full glass rounded-xl p-6 space-y-4"
    >
      {/* Entity identification banner */}
      {entityName && (
        <div
          className={`flex items-center gap-3 rounded-lg px-4 py-3 ${
            isOfac
              ? "bg-severity-critical/10 border border-severity-critical/30"
              : "bg-bitcoin/10 border border-bitcoin/20"
          }`}
        >
          {isOfac ? (
            <AlertTriangle size={20} className="text-severity-critical shrink-0" />
          ) : (
            <Building2 size={20} className="text-bitcoin shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${isOfac ? "text-severity-critical" : "text-foreground"}`}>
                {entityName}
              </span>
              {entityCategory && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-inset text-muted">
                  {CATEGORY_LABELS[entityCategory] ?? entityCategory}
                </span>
              )}
              {isOfac && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-severity-critical/20 text-severity-critical font-semibold">
                  OFAC Sanctioned
                </span>
              )}
              {entityStatus === "closed" && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-inset text-muted">
                  Closed
                </span>
              )}
            </div>
            {entityCountry && entityCountry !== "Unknown" && (
              <span className="text-xs text-muted">{entityCountry}</span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          icon={<Wallet size={14} className="text-bitcoin" aria-hidden="true" />}
          label={t("address.balance", { defaultValue: "Balance" })}
          value={formatSats(balance, i18n.language)}
        />
        <Stat
          icon={<ArrowDownLeft size={14} className="text-severity-good" aria-hidden="true" />}
          label={t("address.received", { defaultValue: "Received" })}
          value={formatSats(totalReceived, i18n.language)}
        />
        <Stat
          icon={<ArrowUpRight size={14} className="text-severity-high" aria-hidden="true" />}
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
