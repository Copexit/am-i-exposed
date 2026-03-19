"use client";

import { useState, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowLeft, Wallet, ShieldCheck, ShieldAlert, ShieldX, AlertCircle, List, Hash, Network } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";
import { FindingCard } from "@/components/FindingCard";
import { FindingsTier } from "@/components/FindingsTier";
import { CoinSelector } from "./CoinSelector";
import { ACTION_BTN_CLASS, P2PKH_DUST_LIMIT } from "@/lib/constants";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { DescriptorParseResult } from "@/lib/bitcoin/descriptor";
import type { UtxoTraceResult } from "@/hooks/useWalletAnalysis";
import { fmtN } from "@/lib/format";
import type { Grade } from "@/lib/types";

const WalletAddressTable = lazy(() => import("./WalletAddressTable").then(m => ({ default: m.WalletAddressTable })));
const WalletTxList = lazy(() => import("./WalletTxList").then(m => ({ default: m.WalletTxList })));
const WalletGraphExplorerPanel = lazy(() => import("./WalletGraphExplorerPanel").then(m => ({ default: m.WalletGraphExplorerPanel })));

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
  utxoTraces: Map<string, UtxoTraceResult> | null;
  onBack: () => void;
  onScan: (input: string) => void;
  durationMs: number | null;
}

/** Find the worst privacy offender address for the highlight card. */
function findWorstOffender(addressInfos: WalletAddressInfo[]): {
  path: string;
  reuseCount: number;
  dustCount: number;
} | null {
  let worst: { path: string; reuseCount: number; dustCount: number } | null = null;
  let worstScore = 0;

  for (const info of addressInfos) {
    if (!info.addressData) continue;
    const funded = info.addressData.chain_stats.funded_txo_count + info.addressData.mempool_stats.funded_txo_count;
    const dustCount = info.utxos.filter(u => u.value < P2PKH_DUST_LIMIT).length;
    const score = (funded > 1 ? funded * 10 : 0) + dustCount * 5;
    if (score > worstScore) {
      worstScore = score;
      worst = { path: info.derived.path, reuseCount: funded > 1 ? funded : 0, dustCount };
    }
  }

  return worst;
}

export function WalletAuditResults({
  descriptor,
  result,
  addressInfos,
  utxoTraces,
  onBack,
  onScan,
  durationMs,
}: WalletAuditResultsProps) {
  const { t } = useTranslation();
  const [showCoinSelector, setShowCoinSelector] = useState(false);
  const [showAddresses, setShowAddresses] = useState(false);
  const [showTxs, setShowTxs] = useState(false);
  const gradeInfo = GRADE_CONFIG[result.grade];
  const GradeIcon = gradeInfo.icon;

  const worstOffender = useMemo(() => findWorstOffender(addressInfos), [addressInfos]);

  // Count active addresses and unique txs for section headers
  const activeCount = result.activeAddresses;
  const totalTxs = result.totalTxs;

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
            value={`${fmtN(result.totalBalance)} sats`}
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

      {/* Worst offender highlight */}
      {worstOffender && (worstOffender.reuseCount > 0 || worstOffender.dustCount > 0) && (
        <button
          onClick={() => setShowAddresses(true)}
          className="w-full rounded-xl border border-severity-high/30 bg-severity-high/5 px-5 py-3 text-left hover:bg-severity-high/10 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlert size={16} className="text-severity-high flex-shrink-0" />
            <span className="text-foreground">
              {t("wallet.worstOffender", { defaultValue: "Worst privacy:" })}{" "}
              <span className="font-mono text-xs">{worstOffender.path}</span>
              {worstOffender.reuseCount > 0 && (
                <span className="text-severity-critical">
                  {" "}- {t("wallet.reusedNTimes", { count: worstOffender.reuseCount, defaultValue: "reused {{count}} times" })}
                </span>
              )}
              {worstOffender.dustCount > 0 && (
                <span className="text-severity-medium">
                  , {t("wallet.nDustUtxos", { count: worstOffender.dustCount, defaultValue: "{{count}} dust UTXOs" })}
                </span>
              )}
            </span>
          </div>
        </button>
      )}

      {/* Findings - 3-tier progressive disclosure */}
      {(() => {
        const issues = result.findings.filter(f => f.severity === "critical" || f.severity === "high");
        const details = result.findings.filter(f => f.severity === "medium" || f.severity === "low");
        const strengths = result.findings.filter(f => f.severity === "good");

        return (
          <>
            {issues.length > 0 && (
              <div className="w-full space-y-3">
                <h2 className="text-base font-medium text-muted uppercase tracking-wider px-1">
                  {t("results.findingsHeading", {
                    count: result.findings.length,
                    defaultValue: "Findings ({{count}})",
                  })}
                </h2>
                <div className="space-y-2">
                  {issues.map((finding, i) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      index={i}
                      defaultExpanded={finding.severity === "critical" || (result.grade === "F" && finding.severity === "high")}
                    />
                  ))}
                </div>
              </div>
            )}
            {details.length > 0 && (
              <FindingsTier
                findings={details}
                label={t("results.additionalFindings", { count: details.length, defaultValue: "Additional findings ({{count}})" })}
                defaultOpen={issues.length === 0}
                delay={0.15}
              />
            )}
            {strengths.length > 0 && (
              <FindingsTier
                findings={strengths}
                label={t("results.privacyStrengths", { count: strengths.length, defaultValue: "Privacy strengths ({{count}})" })}
                defaultOpen={issues.length === 0 && details.length === 0}
                delay={0.2}
              />
            )}
          </>
        );
      })()}

      {/* Transaction Graph */}
      {totalTxs > 0 && (
        <div className="w-full space-y-3">
          <div className="flex items-center gap-2 text-base font-medium text-muted uppercase tracking-wider px-1">
            <Network size={16} />
            {t("wallet.txGraph", {
              defaultValue: "Transaction Graph",
            })}
          </div>
          <Suspense fallback={<div className="text-sm text-muted text-center py-4">Loading...</div>}>
            <WalletGraphExplorerPanel
              addressInfos={addressInfos}
              utxoTraces={utxoTraces}
              onTxClick={onScan}
            />
          </Suspense>
        </div>
      )}

      {/* Address Details */}
      {activeCount > 0 && (
        <div className="w-full space-y-3">
          <button
            onClick={() => setShowAddresses(prev => !prev)}
            className="flex items-center gap-2 text-base font-medium text-muted uppercase tracking-wider px-1 hover:text-foreground transition-colors cursor-pointer"
          >
            <List size={16} />
            {t("wallet.addressDetails", { count: activeCount, defaultValue: "Address Details ({{count}})" })}
          </button>
          {showAddresses && (
            <Suspense fallback={<div className="text-sm text-muted text-center py-4">Loading...</div>}>
              <WalletAddressTable addressInfos={addressInfos} onScan={onScan} />
            </Suspense>
          )}
        </div>
      )}

      {/* Transaction History */}
      {totalTxs > 0 && (
        <div className="w-full space-y-3">
          <button
            onClick={() => setShowTxs(prev => !prev)}
            className="flex items-center gap-2 text-base font-medium text-muted uppercase tracking-wider px-1 hover:text-foreground transition-colors cursor-pointer"
          >
            <Hash size={16} />
            {t("wallet.txHistory", { count: totalTxs, defaultValue: "Transaction History ({{count}})" })}
          </button>
          {showTxs && (
            <Suspense fallback={<div className="text-sm text-muted text-center py-4">Loading...</div>}>
              <WalletTxList addressInfos={addressInfos} onScan={onScan} />
            </Suspense>
          )}
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
