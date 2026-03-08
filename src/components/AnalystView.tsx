"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Eye, ShieldCheck, ShieldAlert } from "lucide-react";
import type { Finding, Grade } from "@/lib/types";

interface AnalystViewProps {
  findings: Finding[];
  grade: Grade;
}

interface AnalystInsight {
  text: string;
  textKey: string;
  good: boolean;
}

function deriveInsights(findings: Finding[]): AnalystInsight[] {
  const insights: AnalystInsight[] = [];
  const ids = new Set(findings.map((f) => f.id));

  // Positive signals
  if (findings.some((f) => f.id.startsWith("h4-") && f.scoreImpact > 0)) {
    insights.push({
      text: "Transaction uses CoinJoin - inputs cannot be attributed to a single owner",
      textKey: "analyst.coinjoinAmbiguous",
      good: true,
    });
  }

  if (findings.some((f) => f.id === "h5-entropy" && f.scoreImpact > 0)) {
    insights.push({
      text: "High entropy makes it difficult to determine which output is the payment",
      textKey: "analyst.highEntropy",
      good: true,
    });
  }

  if (findings.some((f) => f.id === "h4-payjoin" && f.scoreImpact > 0)) {
    insights.push({
      text: "PayJoin detected - the real payment amount is hidden",
      textKey: "analyst.payjoinHidden",
      good: true,
    });
  }

  if (findings.some((f) => f.id === "h4-stonewall" && f.scoreImpact > 0)) {
    insights.push({
      text: "STONEWALL creates ambiguity about which outputs belong to which party",
      textKey: "analyst.stonewallAmbiguous",
      good: true,
    });
  }

  if (ids.has("h10-p2tr") && !ids.has("h8-address-reuse")) {
    insights.push({
      text: "Taproot usage makes multi-sig and single-sig indistinguishable",
      textKey: "analyst.taprootGood",
      good: true,
    });
  }

  // Negative signals
  if (ids.has("h8-address-reuse")) {
    const f = findings.find((item) => item.id === "h8-address-reuse");
    insights.push({
      text: `Address reuse deterministically links ${f?.params?.reuseCount ?? "multiple"} transactions to the same entity`,
      textKey: "analyst.addressReuse",
      good: false,
    });
  }

  if (ids.has("h2-change-detected")) {
    insights.push({
      text: "Change output identified - the exact payment amount and recipient are known",
      textKey: "analyst.changeIdentified",
      good: false,
    });
  }

  if (ids.has("h1-round-amount") || ids.has("h1-round-usd-amount") || ids.has("h1-round-eur-amount")) {
    insights.push({
      text: "Round payment amount reveals which output is the payment and which is change",
      textKey: "analyst.roundAmount",
      good: false,
    });
  }

  if (ids.has("h3-cioh") && findings.find((item) => item.id === "h3-cioh")?.scoreImpact !== 0) {
    insights.push({
      text: "Multiple inputs link those addresses to the same owner (common input ownership)",
      textKey: "analyst.cioh",
      good: false,
    });
  }

  if (ids.has("h11-wallet-fingerprint")) {
    const f = findings.find((item) => item.id === "h11-wallet-fingerprint");
    const wallet = f?.params?.walletGuess;
    insights.push({
      text: wallet
        ? `Wallet identified as ${wallet} - narrows the set of possible owners`
        : "Wallet software partially identifiable from transaction metadata",
      textKey: wallet ? "analyst.walletIdentified" : "analyst.walletPartial",
      good: false,
    });
  }

  if (ids.has("h2-self-send")) {
    insights.push({
      text: "Change sent back to input address - full balance and spending pattern exposed",
      textKey: "analyst.selfSend",
      good: false,
    });
  }

  if (ids.has("peel-chain")) {
    insights.push({
      text: "Peel chain pattern reveals a series of payments from the same source",
      textKey: "analyst.peelChain",
      good: false,
    });
  }

  if (ids.has("script-mixed")) {
    insights.push({
      text: "Mixed address types indicate external payments vs internal change",
      textKey: "analyst.scriptMixed",
      good: false,
    });
  }

  if (ids.has("consolidation-fan-in") || ids.has("consolidation-cross-type")) {
    insights.push({
      text: "Consolidation reveals all inputs belong to the same wallet, exposing total balance",
      textKey: "analyst.consolidation",
      good: false,
    });
  }

  if (ids.has("unnecessary-input")) {
    insights.push({
      text: "Extra inputs link additional addresses to this entity without need",
      textKey: "analyst.unnecessaryInput",
      good: false,
    });
  }

  if (ids.has("bip47-notification")) {
    insights.push({
      text: "BIP47 notification reveals a payment channel between two parties",
      textKey: "analyst.bip47",
      good: false,
    });
  }

  if (ids.has("tx0-premix")) {
    insights.push({
      text: "CoinJoin premix (tx0) is identifiable and links pre-mix inputs to the coordinator",
      textKey: "analyst.tx0",
      good: false,
    });
  }

  if (findings.some((item) => item.id.startsWith("h17-") && item.id !== "h17-unknown")) {
    const f = findings.find((item) => item.id.startsWith("h17-") && item.id !== "h17-unknown");
    const escrowType = f?.params?.escrowType;
    insights.push({
      text: escrowType
        ? `Multisig escrow pattern detected (${escrowType}) - narrows transaction purpose`
        : "Multisig pattern detected - reveals the transaction's governance structure",
      textKey: "analyst.multisig",
      good: false,
    });
  }

  return insights;
}

export function AnalystView({ findings, grade }: AnalystViewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const insights = deriveInsights(findings);
  if (insights.length === 0) return null;

  const goodCount = insights.filter((i) => i.good).length;
  const badCount = insights.filter((i) => !i.good).length;
  const overallGood = grade === "A+" || grade === "B";

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="analyst-view-panel"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer bg-surface-inset rounded-lg px-3 py-3"
      >
        <Eye size={16} aria-hidden="true" />
        {t("analyst.title", { defaultValue: "What a chain analyst sees" })}
        <span className="text-xs text-muted">
          ({goodCount > 0 && <span className="text-severity-good">{goodCount} {t("analyst.ambiguous", { defaultValue: "ambiguous" })}</span>}
          {goodCount > 0 && badCount > 0 && ", "}
          {badCount > 0 && <span className="text-severity-critical">{badCount} {t("analyst.leaked", { defaultValue: "leaked" })}</span>})
        </span>
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div id="analyst-view-panel" className="mt-2 space-y-2">
              {/* Overall verdict */}
              <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
                overallGood
                  ? "bg-severity-good/10 border border-severity-good/30 text-severity-good"
                  : "bg-severity-critical/10 border border-severity-critical/30 text-severity-critical"
              }`}>
                <div className="flex items-center gap-2">
                  {overallGood ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                  {overallGood
                    ? t("analyst.verdictGood", { defaultValue: "This transaction appears ambiguous to chain analysis" })
                    : t("analyst.verdictBad", { defaultValue: "This transaction leaks identifiable information" })}
                </div>
              </div>

              {/* Individual insights */}
              {insights.map((insight, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-4 py-2.5 text-sm flex items-start gap-2 ${
                    insight.good
                      ? "bg-severity-good/5 border border-severity-good/15 text-muted"
                      : "bg-severity-critical/5 border border-severity-critical/15 text-muted"
                  }`}
                >
                  <span className={`shrink-0 mt-0.5 text-xs font-bold ${insight.good ? "text-severity-good" : "text-severity-critical"}`}>
                    {insight.good ? "+" : "-"}
                  </span>
                  <span>{t(insight.textKey, { defaultValue: insight.text, ...findParamsForInsight(insight, findings) })}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function findParamsForInsight(insight: AnalystInsight, findings: Finding[]): Record<string, string | number> {
  if (insight.textKey === "analyst.walletIdentified") {
    const f = findings.find((item) => item.id === "h11-wallet-fingerprint");
    return f?.params?.walletGuess ? { wallet: String(f.params.walletGuess) } : {};
  }
  if (insight.textKey === "analyst.addressReuse") {
    const f = findings.find((item) => item.id === "h8-address-reuse");
    return { reuseCount: f?.params?.reuseCount ?? "multiple" };
  }
  return {};
}
