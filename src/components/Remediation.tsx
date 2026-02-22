"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lightbulb, ChevronDown, ExternalLink, AlertCircle, Clock, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Finding, Grade, Remediation as RemediationType } from "@/lib/types";

interface RemediationProps {
  findings: Finding[];
  grade: Grade;
}

interface Action {
  priority: number;
  textKey: string;
  textDefault: string;
  detailKey: string;
  detailDefault: string;
}

const URGENCY_CONFIG = {
  immediate: { labelKey: "remediation.urgencyImmediate", labelDefault: "Act now", color: "text-severity-critical", icon: AlertCircle },
  soon: { labelKey: "remediation.urgencySoon", labelDefault: "Act soon", color: "text-severity-medium", icon: Clock },
  "when-convenient": { labelKey: "remediation.urgencyConvenient", labelDefault: "When convenient", color: "text-muted", icon: Wrench },
} as const;

/**
 * Generates prioritized remediation actions based on findings.
 * Focuses on the most impactful things the user can actually do.
 */
function generateActions(findings: Finding[], grade: Grade): Action[] {
  const actions: Action[] = [];
  const ids = new Set(findings.map((f) => f.id));

  // Address reuse - highest priority
  if (ids.has("h8-address-reuse")) {
    const reuseFinding = findings.find((f) => f.id === "h8-address-reuse");
    if (reuseFinding?.severity === "critical") {
      actions.push({
        priority: 1,
        textKey: "remediation.stopReusingAddress",
        textDefault: "Stop reusing this address immediately",
        detailKey: "remediation.stopReusingAddressDetail",
        detailDefault:
          "Generate a new address for every receive. Most wallets do this automatically. " +
          "Send remaining funds to a fresh wallet using a CoinJoin or intermediate address.",
      });
    } else {
      actions.push({
        priority: 2,
        textKey: "remediation.avoidAddressReuse",
        textDefault: "Avoid further address reuse",
        detailKey: "remediation.avoidAddressReuseDetail",
        detailDefault:
          "Use a new address for each transaction. Enable HD wallet features if available.",
      });
    }
  }

  // Dust attack
  if (ids.has("dust-attack")) {
    actions.push({
      priority: 1,
      textKey: "remediation.doNotSpendDust",
      textDefault: "Do NOT spend the dust output",
      detailKey: "remediation.doNotSpendDustDetail",
      detailDefault:
        "Freeze this UTXO in your wallet's coin control. Spending it will link your addresses. " +
        "If you must clean it up, send it through a CoinJoin first.",
    });
  }

  // Change detection
  if (ids.has("h2-change-detected")) {
    actions.push({
      priority: 3,
      textKey: "remediation.betterChangeHandling",
      textDefault: "Use wallets with better change handling",
      detailKey: "remediation.betterChangeHandlingDetail",
      detailDefault:
        "Switch to a wallet that uses the same address type for change as for payments. " +
        "Taproot (P2TR) wallets like Sparrow or Blue Wallet help with this.",
    });
  }

  // CoinJoin detected - encourage continuing and warn about exchange risks
  const coinJoinFound = findings.some(
    (f) =>
      (f.id === "h4-whirlpool" || f.id === "h4-coinjoin" || f.id === "h4-joinmarket") && f.scoreImpact > 0,
  );
  if (coinJoinFound) {
    if (grade === "A+") {
      actions.push({
        priority: 5,
        textKey: "remediation.continueCoinJoin",
        textDefault: "Excellent! Continue using CoinJoin",
        detailKey: "remediation.continueCoinJoinDetail",
        detailDefault:
          "Your CoinJoin transaction provides strong privacy. Continue using Whirlpool " +
          "or Wasabi for future transactions. Avoid consolidating CoinJoin " +
          "outputs with non-CoinJoin UTXOs.",
      });
    }
    actions.push({
      priority: 4,
      textKey: "remediation.useDecentralizedExchanges",
      textDefault: "Use decentralized exchanges for CoinJoin outputs",
      detailKey: "remediation.useDecentralizedExchangesDetail",
      detailDefault:
        "Centralized exchanges (Binance, Coinbase, Gemini, Bitstamp, Swan, and others) " +
        "have been documented flagging and freezing accounts for CoinJoin-associated deposits. " +
        "This list is not exhaustive. Use decentralized, non-custodial alternatives that do not apply chain surveillance.",
    });
  }

  // Legacy address type
  if (ids.has("h10-p2pkh") || ids.has("h10-p2sh")) {
    actions.push({
      priority: 4,
      textKey: "remediation.upgradeTaproot",
      textDefault: "Upgrade to a Taproot (P2TR) wallet",
      detailKey: "remediation.upgradeTaprootDetail",
      detailDefault:
        "Taproot addresses (bc1p...) provide the best privacy by making all transactions " +
        "look identical on-chain. They also have lower fees. Sparrow, Blue Wallet, and " +
        "Bitcoin Core all support Taproot.",
    });
  }

  // OP_RETURN
  if (findings.some((f) => f.id.startsWith("h7-op-return"))) {
    actions.push({
      priority: 4,
      textKey: "remediation.avoidOpReturn",
      textDefault: "Avoid services that embed OP_RETURN data",
      detailKey: "remediation.avoidOpReturnDetail",
      detailDefault:
        "OP_RETURN data is permanent and public. If a service you use embeds data in transactions, " +
        "consider alternatives that don't leave metadata on-chain.",
    });
  }

  // Bare multisig
  if (ids.has("script-multisig")) {
    actions.push({
      priority: 2,
      textKey: "remediation.switchMultisig",
      textDefault: "Switch from bare multisig to Taproot MuSig2",
      detailKey: "remediation.switchMultisigDetail",
      detailDefault:
        "Bare multisig exposes all public keys on-chain. Use P2WSH-wrapped multisig at minimum, " +
        "or ideally Taproot with MuSig2/FROST which looks identical to single-sig.",
    });
  }

  // Wallet fingerprint
  if (ids.has("h11-wallet-fingerprint")) {
    actions.push({
      priority: 5,
      textKey: "remediation.walletFingerprint",
      textDefault: "Consider wallet software with better fingerprint resistance",
      detailKey: "remediation.walletFingerprintDetail",
      detailDefault:
        "Your wallet software can be identified through transaction patterns. " +
        "Bitcoin Core, Sparrow, and Wasabi have the best fingerprint resistance.",
    });
  }

  // CIOH (not CoinJoin)
  if (
    ids.has("h3-cioh") &&
    !coinJoinFound &&
    findings.find((f) => f.id === "h3-cioh")?.scoreImpact !== 0
  ) {
    actions.push({
      priority: 3,
      textKey: "remediation.minimizeMultiInput",
      textDefault: "Minimize multi-input transactions",
      detailKey: "remediation.minimizeMultiInputDetail",
      detailDefault:
        "Consolidating UTXOs links your addresses together. Use coin control to avoid " +
        "spending from multiple addresses in one transaction. If you must consolidate, " +
        "do it through a CoinJoin.",
    });
  }

  // Low-entropy simple transactions
  if (ids.has("h5-low-entropy") || ids.has("h5-zero-entropy")) {
    actions.push({
      priority: 4,
      textKey: "remediation.usePayJoin",
      textDefault: "Use PayJoin or CoinJoin for better transaction entropy",
      detailKey: "remediation.usePayJoinDetail",
      detailDefault:
        "Simple 1-in/2-out transactions have low entropy, making analysis straightforward. " +
        "PayJoin (BIP78) adds inputs from the receiver to break common analysis heuristics.",
    });
  }

  // General fallback for poor scores
  if (actions.length === 0 && (grade === "D" || grade === "F")) {
    actions.push({
      priority: 1,
      textKey: "remediation.freshStart",
      textDefault: "Consider a fresh start with better privacy practices",
      detailKey: "remediation.freshStartDetail",
      detailDefault:
        "Use a privacy-focused wallet (Sparrow, Wasabi), generate a new seed, and send " +
        "funds through a CoinJoin before depositing to the new wallet. Use Tor for all " +
        "Bitcoin network activity.",
    });
  }

  // Sort by priority (lowest number = highest priority)
  actions.sort((a, b) => a.priority - b.priority);

  return actions.slice(0, 3);
}

function StructuredRemediation({ remediation, findingId, findingTitle }: { remediation: RemediationType; findingId: string; findingTitle: string }) {
  const { t } = useTranslation();
  const urgency = URGENCY_CONFIG[remediation.urgency];
  const UrgencyIcon = urgency.icon;

  return (
    <div className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground/90">{t(`finding.${findingId}.title`, { defaultValue: findingTitle })}</p>
        <span className={`inline-flex items-center gap-1 text-xs ${urgency.color}`}>
          <UrgencyIcon size={14} />
          {t(urgency.labelKey, { defaultValue: urgency.labelDefault })}
        </span>
      </div>

      <ol className="space-y-1.5 pl-4">
        {remediation.steps.map((step, i) => (
          <li key={i} className="text-base text-muted leading-relaxed list-decimal">
            {t(`remediation.${findingId}.step${i + 1}`, { defaultValue: step })}
          </li>
        ))}
      </ol>

      {remediation.tools && remediation.tools.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {remediation.tools.map((tool) => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-base text-bitcoin/70 hover:text-bitcoin transition-colors"
            >
              {t(`remediation.${findingId}.tool_${tool.name.toLowerCase().replace(/\s+/g, "_")}`, { defaultValue: tool.name })}
              <ExternalLink size={14} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Remediation({ findings, grade }: RemediationProps) {
  const { t } = useTranslation();
  // Auto-open for poor grades where remediation is most important
  const [open, setOpen] = useState(grade === "C" || grade === "D" || grade === "F");

  // Collect structured remediations from findings (sorted by urgency)
  const structuredRemediations = findings
    .filter((f) => f.remediation)
    .sort((a, b) => {
      const order = { immediate: 0, soon: 1, "when-convenient": 2 };
      return (order[a.remediation!.urgency] ?? 2) - (order[b.remediation!.urgency] ?? 2);
    });

  // Fallback actions for findings without structured remediation
  const actions = generateActions(findings, grade);

  if (structuredRemediations.length === 0 && actions.length === 0) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm text-bitcoin/70 hover:text-bitcoin transition-colors cursor-pointer bg-bitcoin/10 rounded-lg px-3 py-3"
      >
        <Lightbulb size={16} />
        {t("remediation.whatToDoNext", { defaultValue: "What to do next" })}
        {structuredRemediations.length > 0 && (
          <span className="text-xs text-bitcoin/80">
            ({t("remediation.detailedCount", { count: structuredRemediations.length, defaultValue: "{{count}} detailed" })})
          </span>
        )}
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
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
            <div className="mt-2 space-y-2">
              {/* Structured remediations first */}
              {structuredRemediations.map((f) => (
                <StructuredRemediation
                  key={f.id}
                  remediation={f.remediation!}
                  findingId={f.id}
                  findingTitle={f.title}
                />
              ))}

              {/* Then fallback actions for findings without structured data */}
              {structuredRemediations.length === 0 && actions.map((action, i) => (
                <div
                  key={i}
                  className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-bitcoin/60 text-xs font-bold mt-0.5 shrink-0">
                      {i + 1}.
                    </span>
                    <div>
                      <p className="text-base font-medium text-foreground/90">
                        {t(action.textKey, { defaultValue: action.textDefault })}
                      </p>
                      <p className="text-base text-muted mt-1 leading-relaxed">
                        {t(action.detailKey, { defaultValue: action.detailDefault })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
