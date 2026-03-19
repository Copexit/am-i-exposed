"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { selectCoins, type CoinSelectionInput, type CoinSelectionResult } from "@/lib/analysis/coin-selection";
import { fmtN } from "@/lib/format";
import { FindingCard } from "@/components/FindingCard";
import { GlowCard } from "@/components/ui/GlowCard";

interface CoinSelectorProps {
  utxos: CoinSelectionInput[];
}

export function CoinSelector({ utxos }: CoinSelectorProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("5");
  const [result, setResult] = useState<CoinSelectionResult | null>(null);
  const [noResult, setNoResult] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountSats = parseInt(amount, 10);
    const rate = parseFloat(feeRate);
    if (isNaN(amountSats) || amountSats <= 0 || isNaN(rate) || rate <= 0) return;

    const selection = selectCoins(utxos, amountSats, rate);
    if (selection) {
      setResult(selection);
      setNoResult(false);
    } else {
      setResult(null);
      setNoResult(true);
    }
  }

  const strategyLabels: Record<string, string> = {
    "exact-match": t("wallet.strategy.exact-match", { defaultValue: "Exact match (no change)" }),
    "single-utxo": t("wallet.strategy.single-utxo", { defaultValue: "Single UTXO" }),
    "minimal-change": t("wallet.strategy.minimal-change", { defaultValue: "Minimal change" }),
  };

  return (
    <GlowCard className="w-full p-5 space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="text-xs text-muted uppercase tracking-wider mb-1 block">
            {t("wallet.paymentAmount", { defaultValue: "Payment amount (sats)" })}
          </label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="50000"
            min="1"
            className="w-full bg-surface-elevated border border-card-border rounded-lg px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="w-full sm:w-32">
          <label className="text-xs text-muted uppercase tracking-wider mb-1 block">
            {t("wallet.feeRate", { defaultValue: "Fee rate (sat/vB)" })}
          </label>
          <input
            type="number"
            value={feeRate}
            onChange={e => setFeeRate(e.target.value)}
            placeholder="5"
            min="1"
            step="0.1"
            className="w-full bg-surface-elevated border border-card-border rounded-lg px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="px-4 py-2 bg-bitcoin text-background font-semibold text-sm rounded-lg hover:bg-bitcoin-hover transition-all duration-150 cursor-pointer whitespace-nowrap"
          >
            {t("wallet.suggest", { defaultValue: "Suggest selection" })}
          </button>
        </div>
      </form>

      {noResult && (
        <div className="text-sm text-severity-high">
          {t("wallet.noResult", { defaultValue: "No valid selection found - insufficient funds." })}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-surface-elevated px-2 py-1 rounded text-muted">
              {strategyLabels[result.strategy] ?? result.strategy}
            </span>
            <span className="text-foreground">
              {t("wallet.inputCount", { count: result.selected.length, defaultValue: "{{count}} input", defaultValue_other: "{{count}} inputs" })}
            </span>
            <span className="text-muted">|</span>
            <span className="text-foreground">
              {t("wallet.fee", { defaultValue: "Fee:" })} {fmtN(result.estimatedFee)} {t("common.sats", { defaultValue: "sats" })}
            </span>
            {result.changeAmount > 0 && (
              <>
                <span className="text-muted">|</span>
                <span className="text-foreground">
                  {t("wallet.change", { defaultValue: "Change:" })} {fmtN(result.changeAmount)} {t("common.sats", { defaultValue: "sats" })}
                </span>
              </>
            )}
          </div>

          {/* Selected UTXOs */}
          <div className="space-y-1">
            <span className="text-xs text-muted uppercase tracking-wider">{t("wallet.selectedUtxos", { defaultValue: "Selected UTXOs" })}</span>
            <div className="space-y-1">
              {result.selected.map((sel) => (
                <div
                  key={`${sel.utxo.txid}:${sel.utxo.vout}`}
                  className="flex items-center justify-between bg-surface-elevated/50 rounded px-3 py-1.5 text-xs font-mono"
                >
                  <span className="text-muted truncate max-w-[200px]">
                    {sel.utxo.txid.slice(0, 12)}...:{sel.utxo.vout}
                  </span>
                  <span className="text-foreground">{fmtN(sel.utxo.value)} {t("common.sats", { defaultValue: "sats" })}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Findings */}
          {result.findings.length > 0 && (
            <div className="space-y-2">
              {result.findings.map((finding, i) => (
                <FindingCard key={finding.id} finding={finding} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </GlowCard>
  );
}
