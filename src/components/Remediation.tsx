"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lightbulb, ChevronDown } from "lucide-react";
import type { Finding, Grade } from "@/lib/types";

interface RemediationProps {
  findings: Finding[];
  grade: Grade;
}

interface Action {
  priority: number;
  text: string;
  detail: string;
}

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
        text: "Stop reusing this address immediately",
        detail:
          "Generate a new address for every receive. Most wallets do this automatically. " +
          "Send remaining funds to a fresh wallet using a CoinJoin or intermediate address.",
      });
    } else {
      actions.push({
        priority: 2,
        text: "Avoid further address reuse",
        detail:
          "Use a new address for each transaction. Enable HD wallet features if available.",
      });
    }
  }

  // Dust attack
  if (ids.has("dust-attack")) {
    actions.push({
      priority: 1,
      text: "Do NOT spend the dust output",
      detail:
        "Freeze this UTXO in your wallet's coin control. Spending it will link your addresses. " +
        "If you must clean it up, send it through a CoinJoin first.",
    });
  }

  // Change detection
  if (ids.has("h2-change-detected")) {
    actions.push({
      priority: 3,
      text: "Use wallets with better change handling",
      detail:
        "Switch to a wallet that uses the same address type for change as for payments. " +
        "Taproot (P2TR) wallets like Sparrow or Blue Wallet help with this.",
    });
  }

  // CoinJoin detected (positive - encourage more)
  const coinJoinFound = findings.some(
    (f) =>
      (f.id === "h4-whirlpool" || f.id === "h4-coinjoin") && f.scoreImpact > 0,
  );
  if (coinJoinFound && grade === "A+") {
    actions.push({
      priority: 5,
      text: "Excellent! Continue using CoinJoin",
      detail:
        "Your CoinJoin transaction provides strong privacy. Continue using Whirlpool, " +
        "Wasabi, or JoinMarket for future transactions. Avoid consolidating CoinJoin " +
        "outputs with non-CoinJoin UTXOs.",
    });
  }

  // Legacy address type
  if (ids.has("h10-legacy-type")) {
    actions.push({
      priority: 4,
      text: "Upgrade to a Taproot (P2TR) wallet",
      detail:
        "Taproot addresses (bc1p...) provide the best privacy by making all transactions " +
        "look identical on-chain. They also have lower fees. Sparrow, Blue Wallet, and " +
        "Bitcoin Core all support Taproot.",
    });
  }

  // OP_RETURN
  if (findings.some((f) => f.id.startsWith("h7-op-return"))) {
    actions.push({
      priority: 4,
      text: "Avoid services that embed OP_RETURN data",
      detail:
        "OP_RETURN data is permanent and public. If a service you use embeds data in transactions, " +
        "consider alternatives that don't leave metadata on-chain.",
    });
  }

  // Bare multisig
  if (ids.has("script-multisig")) {
    actions.push({
      priority: 2,
      text: "Switch from bare multisig to Taproot MuSig2",
      detail:
        "Bare multisig exposes all public keys on-chain. Use P2WSH-wrapped multisig at minimum, " +
        "or ideally Taproot with MuSig2/FROST which looks identical to single-sig.",
    });
  }

  // Wallet fingerprint
  if (ids.has("h11-wallet-fingerprint")) {
    actions.push({
      priority: 5,
      text: "Consider wallet software with better fingerprint resistance",
      detail:
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
      text: "Minimize multi-input transactions",
      detail:
        "Consolidating UTXOs links your addresses together. Use coin control to avoid " +
        "spending from multiple addresses in one transaction. If you must consolidate, " +
        "do it through a CoinJoin.",
    });
  }

  // Low-entropy simple transactions
  if (ids.has("h5-low-entropy")) {
    actions.push({
      priority: 4,
      text: "Use PayJoin or CoinJoin for better transaction entropy",
      detail:
        "Simple 1-in/2-out transactions have low entropy, making analysis straightforward. " +
        "PayJoin (BIP78) adds inputs from the receiver to break common analysis heuristics.",
    });
  }

  // General fallback for poor scores
  if (actions.length === 0 && (grade === "D" || grade === "F")) {
    actions.push({
      priority: 1,
      text: "Consider a fresh start with better privacy practices",
      detail:
        "Use a privacy-focused wallet (Sparrow, Wasabi), generate a new seed, and send " +
        "funds through a CoinJoin before depositing to the new wallet. Use Tor for all " +
        "Bitcoin network activity.",
    });
  }

  // Sort by priority (lowest number = highest priority)
  actions.sort((a, b) => a.priority - b.priority);

  return actions.slice(0, 3);
}

export function Remediation({ findings, grade }: RemediationProps) {
  // Auto-open for poor grades where remediation is most important
  const [open, setOpen] = useState(grade === "D" || grade === "F");
  const actions = generateActions(findings, grade);

  if (actions.length === 0) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-bitcoin/70 hover:text-bitcoin transition-colors cursor-pointer px-1"
      >
        <Lightbulb size={12} />
        What to do next
        <ChevronDown
          size={12}
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
              {actions.map((action, i) => (
                <div
                  key={i}
                  className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-bitcoin/60 text-xs font-bold mt-0.5 shrink-0">
                      {i + 1}.
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground/80">
                        {action.text}
                      </p>
                      <p className="text-xs text-muted/60 mt-1 leading-relaxed">
                        {action.detail}
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
