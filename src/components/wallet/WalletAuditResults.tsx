"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowLeft, Wallet, ShieldCheck, ShieldAlert, ShieldX, AlertCircle } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";
import { FindingCard } from "@/components/FindingCard";
import { CoinSelector } from "./CoinSelector";
import { ACTION_BTN_CLASS } from "@/lib/constants";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { DescriptorParseResult } from "@/lib/bitcoin/descriptor";
import type { Grade } from "@/lib/types";

const GRADE_CONFIG: Record<Grade, { icon: typeof ShieldCheck; color: string; bg: string }> = {
  "A+": { icon: ShieldCheck, color: "text-severity-good", bg: "bg-severity-good/10 border-severity-good/30" },
  "B": { icon: ShieldCheck, color: "text-severity-low", bg: "bg-severity-low/10 border-severity-low/30" },
  "C": { icon: ShieldAlert, color: "text-severity-medium", bg: "bg-severity-medium/10 border-severity-medium/30" },
  "D": { icon: ShieldAlert, color: "text-severity-high", bg: "bg-severity-high/10 border-severity-high/30" },
  "F": { icon: ShieldX, color: "text-severity-critical", bg: "bg-severity-critical/10 border-severity-critical/30" },
};

interface WalletAuditResultsProps {
  descriptor: DescriptorParseResult;
  result: WalletAuditResult;
  addressInfos: WalletAddressInfo[];
  onBack: () => void;
  durationMs: number | null;
}

export function WalletAuditResults({
  descriptor,
  result,
  addressInfos,
  onBack,
  durationMs,
}: WalletAuditResultsProps) {
  const { t } = useTranslation();
  const [showCoinSelector, setShowCoinSelector] = useState(false);
  const gradeInfo = GRADE_CONFIG[result.grade];
  const GradeIcon = gradeInfo.icon;

  // Collect all UTXOs for coin selection
  const allUtxos = addressInfos.flatMap(a =>
    a.utxos.map(utxo => ({
      utxo,
      address: a.derived.address,
    })),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-6 w-full max-w-3xl"
    >
      {/* Back button */}
      <div className="w-full flex items-center">
        <button onClick={onBack} className={ACTION_BTN_CLASS}>
          <ArrowLeft size={16} />
          {t("results.newScan", { defaultValue: "New scan" })}
        </button>
      </div>

      {/* Score card */}
      <GlowCard className="w-full p-7 space-y-6">
        <div className="flex items-center gap-3 text-muted">
          <Wallet size={18} />
          <span className="text-sm font-medium uppercase tracking-wider">
            {t("wallet.auditTitle", { defaultValue: "Wallet Privacy Audit" })}
          </span>
          <span className="text-xs bg-surface-elevated px-2 py-0.5 rounded">
            {descriptor.scriptType.toUpperCase()}
          </span>
        </div>

        <div className={`rounded-xl border p-6 ${gradeInfo.bg} flex flex-col items-center gap-3`}>
          <GradeIcon size={40} className={gradeInfo.color} />
          <div className="text-center">
            <span className={`text-4xl font-bold ${gradeInfo.color}`}>{result.grade}</span>
            <span className="text-xl text-muted ml-2">({result.score}/100)</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCell
            label={t("wallet.activeAddresses", { defaultValue: "Active addresses" })}
            value={result.activeAddresses.toString()}
          />
          <StatCell
            label={t("wallet.totalTxs", { defaultValue: "Total transactions" })}
            value={result.totalTxs.toString()}
          />
          <StatCell
            label={t("wallet.totalUtxos", { defaultValue: "Total UTXOs" })}
            value={result.totalUtxos.toString()}
          />
          <StatCell
            label={t("wallet.totalBalance", { defaultValue: "Total balance" })}
            value={`${result.totalBalance.toLocaleString()} sats`}
          />
          <StatCell
            label={t("wallet.reusedAddresses", { defaultValue: "Reused addresses" })}
            value={result.reusedAddresses.toString()}
            warn={result.reusedAddresses > 0}
          />
          <StatCell
            label={t("wallet.dustUtxos", { defaultValue: "Dust UTXOs" })}
            value={result.dustUtxos.toString()}
            warn={result.dustUtxos > 0}
          />
        </div>
      </GlowCard>

      {/* Findings */}
      {result.findings.length > 0 && (
        <div className="w-full space-y-3">
          <h2 className="text-base font-medium text-muted uppercase tracking-wider px-1">
            {t("results.findingsHeading", {
              count: result.findings.length,
              defaultValue: "Findings ({{count}})",
            })}
          </h2>
          <div className="space-y-2">
            {result.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Coin Selection Advisor */}
      {allUtxos.length > 0 && (
        <div className="w-full space-y-3">
          <button
            onClick={() => setShowCoinSelector(prev => !prev)}
            className="flex items-center gap-2 text-base font-medium text-muted uppercase tracking-wider px-1 hover:text-foreground transition-colors cursor-pointer"
          >
            <AlertCircle size={16} />
            {t("wallet.coinSelection", { defaultValue: "Coin Selection Advisor" })}
          </button>
          {showCoinSelector && <CoinSelector utxos={allUtxos} />}
        </div>
      )}

      {/* Duration footer */}
      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed">
        {durationMs
          ? t("wallet.auditFooterWithDuration", {
              duration: (durationMs / 1000).toFixed(1),
              addressCount: descriptor.receiveAddresses.length + descriptor.changeAddresses.length,
              defaultValue: "Wallet audit completed in {{duration}}s. Analyzed {{addressCount}} derived addresses. All analysis ran entirely in the browser.",
            })
          : t("wallet.auditFooter", {
              addressCount: descriptor.receiveAddresses.length + descriptor.changeAddresses.length,
              defaultValue: "Wallet audit completed. Analyzed {{addressCount}} derived addresses. All analysis ran entirely in the browser.",
            })}
      </div>
    </motion.div>
  );
}

function StatCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-surface-elevated/50 rounded-lg px-3 py-2 text-center">
      <div className="text-xs text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-semibold ${warn ? "text-severity-high" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
