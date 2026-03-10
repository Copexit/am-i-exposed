"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Shield,
  Zap,
  ArrowRightLeft,
  Layers,
  Route,
  CheckCircle2,
  AlertTriangle,
  Info,
  Target,
  Coins,
  Lock,
} from "lucide-react";
import type { Finding } from "@/lib/types";
import { matchPathways } from "@/lib/recommendations/pathway-matcher";

interface Pathway {
  id: string;
  titleKey: string;
  titleDefault: string;
  icon: React.ReactNode;
  descKey: string;
  descDefault: string;
  pros: { key: string; default: string }[];
  cons: { key: string; default: string }[];
  tools: string[];
  warnings?: { key: string; default: string }[];
}

const PATHWAYS: Pathway[] = [
  {
    id: "lightning",
    titleKey: "pathways.ln.title",
    titleDefault: "Lightning Network",
    icon: <Zap size={14} />,
    descKey: "pathways.ln.desc",
    descDefault:
      "Lightning payments happen off-chain, so they do not appear on the blockchain (except channel open/close transactions).",
    pros: [
      { key: "pathways.ln.pro1", default: "Payments are off-chain and invisible to chain analysis" },
      { key: "pathways.ln.pro2", default: "Fast and low-fee transactions" },
      { key: "pathways.ln.pro3", default: "Onion-routed for sender privacy" },
    ],
    cons: [
      { key: "pathways.ln.con1", default: "Channel opens and closes are visible on-chain" },
      { key: "pathways.ln.con2", default: "Channel capacity reveals approximate balance range" },
      { key: "pathways.ln.con3", default: "Routing privacy depends on network path and node connectivity" },
      { key: "pathways.ln.con4", default: "Single-channel LSP dependency: if your wallet has only one channel, the LSP sees all payment amounts and destinations" },
      { key: "pathways.ln.con5", default: "Public channels advertise capacity and peers to the routing gossip. Use private (unannounced) channels when not routing for others." },
      { key: "pathways.ln.con6", default: "Path selection favors short, cheap routes with small anonymity sets. Timing analysis and amount correlation can deanonymize payments across hops." },
    ],
    tools: ["Phoenix", "Breez", "Zeus"],
    warnings: [
      {
        key: "pathways.ln.warn1",
        default: "Open channels with CoinJoin outputs for maximum privacy. Avoid opening from exchange withdrawal addresses.",
      },
      {
        key: "pathways.ln.warn2",
        default: "For maximum privacy, use Zeus connected to your own Lightning node. Phoenix and Breez route through single LSPs that can observe your payment activity.",
      },
    ],
  },
  {
    id: "monero",
    titleKey: "pathways.xmr.title",
    titleDefault: "Monero Atomic Swaps",
    icon: <ArrowRightLeft size={14} />,
    descKey: "pathways.xmr.desc",
    descDefault:
      "Atomic swaps allow exchanging BTC for XMR and back, completely breaking all on-chain links between the two Bitcoin transactions.",
    pros: [
      { key: "pathways.xmr.pro1", default: "Breaks all on-chain links completely" },
      { key: "pathways.xmr.pro2", default: "Monero has built-in privacy (ring signatures, stealth addresses)" },
      { key: "pathways.xmr.pro3", default: "No trusted intermediary needed with atomic swaps" },
    ],
    cons: [
      { key: "pathways.xmr.con1", default: "Requires cross-chain infrastructure" },
      { key: "pathways.xmr.con2", default: "Liquidity limitations on DEX platforms" },
      { key: "pathways.xmr.con3", default: "Slower than Lightning (on-chain settlement on both chains)" },
    ],
    tools: ["Haveno (DEX)", "UnstoppableSwap"],
    warnings: [
      {
        key: "pathways.xmr.warn1",
        default: "Regulatory risk: some jurisdictions restrict Monero. Research local regulations before using.",
      },
    ],
  },
  {
    id: "liquid",
    titleKey: "pathways.liquid.title",
    titleDefault: "Liquid Network",
    icon: <Layers size={14} />,
    descKey: "pathways.liquid.desc",
    descDefault:
      "Liquid is a Bitcoin sidechain with confidential transactions that hide amounts. Transaction amounts are encrypted and only visible to the sender and receiver.",
    pros: [
      { key: "pathways.liquid.pro1", default: "Confidential transactions hide amounts from observers" },
      { key: "pathways.liquid.pro2", default: "Faster block times (1 minute) than mainchain" },
      { key: "pathways.liquid.pro3", default: "L-BTC is 1:1 pegged to BTC" },
    ],
    cons: [
      { key: "pathways.liquid.con1", default: "Federated sidechain - requires trusting the Liquid federation members" },
      { key: "pathways.liquid.con2", default: "Peg-in and peg-out transactions are visible on Bitcoin's chain - privacy applies only between these bridge points" },
      { key: "pathways.liquid.con3", default: "Smaller user base limits anonymity set" },
      { key: "pathways.liquid.con4", default: "Federated consensus (11-of-15 functionaries) introduces trust assumptions different from Bitcoin's trustless model" },
    ],
    tools: ["Blockstream Green", "Boltz Exchange", "SideSwap"],
  },
  {
    id: "payjoin-v2",
    titleKey: "pathways.pj2.title",
    titleDefault: "PayJoin v2 (BIP77)",
    icon: <ArrowRightLeft size={14} />,
    descKey: "pathways.pj2.desc",
    descDefault:
      "Async, serverless PayJoin that breaks CIOH fundamentally. Both sender and receiver contribute inputs, making the transaction look like a normal payment on-chain.",
    pros: [
      { key: "pathways.pj2.pro1", default: "Breaks Common Input Ownership Heuristic by design" },
      { key: "pathways.pj2.pro2", default: "Looks like a normal transaction - no CoinJoin fingerprint" },
      { key: "pathways.pj2.pro3", default: "Async protocol - receiver does not need to be online simultaneously" },
    ],
    cons: [
      { key: "pathways.pj2.con1", default: "Both parties need PayJoin-compatible wallets" },
      { key: "pathways.pj2.con2", default: "Adoption is still growing - limited counterparties" },
    ],
    tools: ["Cake Wallet", "Bull Bitcoin", "BTCPay Server"],
  },
  {
    id: "silent-payments",
    titleKey: "pathways.sp.title",
    titleDefault: "Silent Payments (BIP352)",
    icon: <Lock size={14} />,
    descKey: "pathways.sp.desc",
    descDefault:
      "Publish one static address, receive unique on-chain Taproot outputs for each payment. No notification transaction needed, outputs are standard P2TR.",
    pros: [
      { key: "pathways.sp.pro1", default: "Eliminates address reuse without out-of-band coordination" },
      { key: "pathways.sp.pro2", default: "Each payment creates a unique, unlinkable Taproot output" },
      { key: "pathways.sp.pro3", default: "No notification transaction (unlike BIP47)" },
    ],
    cons: [
      { key: "pathways.sp.con1", default: "Sender wallet must support BIP352" },
      { key: "pathways.sp.con2", default: "Scanning for received payments requires checking every transaction" },
    ],
    tools: ["Bitcoin Core 28+", "Cake Wallet", "Silentium"],
  },
  {
    id: "coin-control",
    titleKey: "pathways.cc.title",
    titleDefault: "Coin Control & UTXO Hygiene",
    icon: <Coins size={14} />,
    descKey: "pathways.cc.desc",
    descDefault:
      "Manually select which UTXOs to spend. Never merge KYC with non-KYC coins. Label everything by source and privacy context.",
    pros: [
      { key: "pathways.cc.pro1", default: "Prevents accidental cross-context contamination via CIOH" },
      { key: "pathways.cc.pro2", default: "No additional tools or counterparties needed" },
      { key: "pathways.cc.pro3", default: "Works with any wallet that supports manual UTXO selection" },
    ],
    cons: [
      { key: "pathways.cc.con1", default: "Requires manual effort and discipline for every transaction" },
      { key: "pathways.cc.con2", default: "Not all wallets support coin control" },
    ],
    tools: ["Sparrow Wallet", "Bitcoin Core", "Electrum"],
  },
  {
    id: "stonewall",
    titleKey: "pathways.stonewall.title",
    titleDefault: "Stonewall / Spending Privately",
    icon: <Shield size={14} />,
    descKey: "pathways.stonewall.desc",
    descDefault:
      "Single-user transaction that mimics a 2-person CoinJoin. Creates 4 outputs: payment, same-value decoy (back to sender), and two change outputs. Breaks CIOH and increases Boltzmann entropy without requiring coordination.",
    pros: [
      { key: "pathways.stonewall.pro1", default: "Breaks CIOH assumption (looks like 2 participants)" },
      { key: "pathways.stonewall.pro2", default: "Increases tx entropy measured by Boltzmann" },
      { key: "pathways.stonewall.pro3", default: "Available in Sparrow without external coordination" },
    ],
    cons: [
      { key: "pathways.stonewall.con1", default: "Requires multiple UTXOs of appropriate sizes" },
      { key: "pathways.stonewall.con2", default: "Uses more block space (4 outputs vs 2)" },
      { key: "pathways.stonewall.con3", default: "Analyst with enough context may distinguish from a real CoinJoin" },
    ],
    tools: ["Sparrow Wallet"],
  },
  {
    id: "batch-spending",
    titleKey: "pathways.batch.title",
    titleDefault: "Batch Spending",
    icon: <Layers size={14} />,
    descKey: "pathways.batch.desc",
    descDefault:
      "Combine multiple payments into a single transaction. Multiple outputs increase ambiguity for change detection since observers cannot determine which outputs are payments vs change.",
    pros: [
      { key: "pathways.batch.pro1", default: "Makes change detection harder (more candidate outputs)" },
      { key: "pathways.batch.pro2", default: "Reduces on-chain footprint and total fees" },
      { key: "pathways.batch.pro3", default: "Each additional output increases the Boltzmann entropy" },
    ],
    cons: [
      { key: "pathways.batch.con1", default: "All recipients can see each other's output amounts" },
      { key: "pathways.batch.con2", default: "Primarily useful when making multiple simultaneous payments" },
    ],
    tools: ["Sparrow Wallet", "Bitcoin Core", "Electrum"],
  },
  {
    id: "bnb-coin-selection",
    titleKey: "pathways.bnb.title",
    titleDefault: "Exact Amount Spending (BnB)",
    icon: <Target size={14} />,
    descKey: "pathways.bnb.desc",
    descDefault:
      "Use Branch-and-Bound coin selection to find UTXO combinations that exactly match the payment plus fee, eliminating the change output entirely.",
    pros: [
      { key: "pathways.bnb.pro1", default: "No change output means change detection heuristic cannot fire" },
      { key: "pathways.bnb.pro2", default: "Bitcoin Core uses BnB by default" },
      { key: "pathways.bnb.pro3", default: "Reduces transaction size (one fewer output)" },
    ],
    cons: [
      { key: "pathways.bnb.con1", default: "Only works when a UTXO combination matches the exact amount needed" },
      { key: "pathways.bnb.con2", default: "May require multiple UTXOs as inputs, triggering CIOH" },
    ],
    tools: ["Bitcoin Core (default)", "Sparrow Wallet"],
  },
];

interface CombinedPathway {
  id: string;
  titleKey: string;
  titleDefault: string;
  stepsKey: string;
  stepsDefault: string;
  strengthKey: string;
  strengthDefault: string;
}

const COMBINED_PATHWAYS: CombinedPathway[] = [
  {
    id: "coinjoin-ln",
    titleKey: "pathways.combo.cjln.title",
    titleDefault: "CoinJoin -> Lightning",
    stepsKey: "pathways.combo.cjln.steps",
    stepsDefault: "Mix UTXOs with CoinJoin, then open Lightning channels with mixed outputs. Payments through LN are off-chain.",
    strengthKey: "pathways.combo.cjln.strength",
    strengthDefault: "On-chain mixing + off-chain spending. Channel opens are linked to CoinJoin outputs (which have high anonymity sets), not to your original funds.",
  },
  {
    id: "coinjoin-liquid",
    titleKey: "pathways.combo.cjliq.title",
    titleDefault: "CoinJoin -> Liquid",
    stepsKey: "pathways.combo.cjliq.steps",
    stepsDefault: "Mix first with CoinJoin, then peg into Liquid for confidential transactions.",
    strengthKey: "pathways.combo.cjliq.strength",
    strengthDefault: "Combines CoinJoin anonymity set with Liquid's amount privacy. The peg-in links to a CoinJoin output, not your original identity.",
  },
  {
    id: "btc-xmr-btc",
    titleKey: "pathways.combo.xmr.title",
    titleDefault: "BTC -> Monero -> BTC",
    stepsKey: "pathways.combo.xmr.steps",
    stepsDefault: "Swap BTC to XMR via atomic swap, hold in Monero, then swap back to BTC when needed.",
    strengthKey: "pathways.combo.xmr.strength",
    strengthDefault: "Complete chain break. The receiving BTC has zero on-chain link to the original BTC. Strongest privacy option available.",
  },
  {
    id: "exchange-coinjoin-ln",
    titleKey: "pathways.combo.excjln.title",
    titleDefault: "Exchange -> CoinJoin -> Lightning/Liquid",
    stepsKey: "pathways.combo.excjln.steps",
    stepsDefault: "Withdraw from exchange, CoinJoin the KYC-tainted UTXOs, then move to Lightning or Liquid for spending.",
    strengthKey: "pathways.combo.excjln.strength",
    strengthDefault: "For KYC-sourced funds. CoinJoin breaks the link from exchange, then LN/Liquid adds another layer before final use.",
  },
  {
    id: "ln-liquid-btc",
    titleKey: "pathways.combo.lnliq.title",
    titleDefault: "Lightning -> Liquid -> BTC",
    stepsKey: "pathways.combo.lnliq.steps",
    stepsDefault: "Send via Lightning to Boltz Exchange, receive L-BTC on Liquid, then peg out to Bitcoin mainchain.",
    strengthKey: "pathways.combo.lnliq.strength",
    strengthDefault: "Breaks the on-chain trail with two intermediate steps. The final BTC appears to come from the Liquid federation, not your original channel.",
  },
  {
    id: "coinjoin-p2p",
    titleKey: "pathways.combo.cjp2p.title",
    titleDefault: "CoinJoin -> Intermediate Hop -> P2P",
    stepsKey: "pathways.combo.cjp2p.steps",
    stepsDefault: "Mix with CoinJoin, send through an intermediate address, then use for P2P purchase on Bisq, Peach Bitcoin, HodlHodl, or RoboSats.",
    strengthKey: "pathways.combo.cjp2p.strength",
    strengthDefault: "The intermediate hop prevents the P2P counterparty from seeing the CoinJoin directly. Multiple hops make tracing prohibitively difficult.",
  },
  {
    id: "atm-coinjoin-ln",
    titleKey: "pathways.combo.atmcjln.title",
    titleDefault: "No-KYC ATM -> CoinJoin -> Lightning",
    stepsKey: "pathways.combo.atmcjln.steps",
    stepsDefault: "Buy BTC at a no-KYC ATM (sub-$1000 in most jurisdictions), CoinJoin the output, then open a Lightning channel with the mixed UTXO.",
    strengthKey: "pathways.combo.atmcjln.strength",
    strengthDefault: "Breaks the link between physical purchase and spending identity. The ATM sees your face but not your spending, Lightning peers see your channel but not the ATM.",
  },
  {
    id: "p2p-monero-btc",
    titleKey: "pathways.combo.p2pxmr.title",
    titleDefault: "P2P -> Monero -> BTC",
    stepsKey: "pathways.combo.p2pxmr.steps",
    stepsDefault: "Buy Monero via P2P (Haveno, cash trade), then atomic swap XMR back to BTC.",
    strengthKey: "pathways.combo.p2pxmr.strength",
    strengthDefault: "Complete chain break - no on-chain link between the P2P purchase and the resulting BTC.",
  },
];

interface PrivacyPathwaysProps {
  grade: string;
  findings?: Finding[];
}

export function PrivacyPathways({ grade, findings = [] }: PrivacyPathwaysProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expandedPathway, setExpandedPathway] = useState<string | null>(null);
  const [showCombined, setShowCombined] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { matched } = matchPathways(findings, grade);
  const matchedIds = new Set(matched.map((m) => m.id));

  // Sort pathways: matched first (by relevance), then unmatched
  const sortedPathways = [...PATHWAYS].sort((a, b) => {
    const aMatch = matched.find((m) => m.id === a.id);
    const bMatch = matched.find((m) => m.id === b.id);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    if (aMatch && bMatch) return aMatch.relevanceScore - bMatch.relevanceScore;
    return 0;
  });

  // When findings are present, show matched pathways by default, rest in expandable section
  const hasMatches = matched.length > 0;
  const primaryPathways = hasMatches && !showAll
    ? sortedPathways.filter((p) => matchedIds.has(p.id))
    : sortedPathways;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="privacy-pathways-panel"
        className="inline-flex items-center gap-1.5 text-sm text-bitcoin/80 hover:text-bitcoin transition-colors cursor-pointer bg-bitcoin/10 rounded-lg px-3 py-3"
      >
        <Shield size={16} aria-hidden="true" />
        {t("pathways.title", { defaultValue: "Privacy pathways beyond on-chain" })}
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
            <div id="privacy-pathways-panel" className="mt-2 space-y-3">
              <p className="text-sm text-muted leading-relaxed">
                {t("pathways.intro", {
                  defaultValue:
                    "On-chain privacy tools like CoinJoin are just one layer. The strongest privacy comes from combining multiple techniques across different networks.",
                })}
              </p>

              {/* Individual pathways */}
              {primaryPathways.map((pathway) => (
                <div
                  key={pathway.id}
                  className="bg-surface-inset border border-card-border rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedPathway(
                        expandedPathway === pathway.id ? null : pathway.id,
                      )
                    }
                    aria-expanded={expandedPathway === pathway.id}
                    className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-surface-elevated/50 transition-colors"
                  >
                    <span className="text-bitcoin">{pathway.icon}</span>
                    <span className="text-sm font-medium text-foreground/90 flex-1">
                      {t(pathway.titleKey, { defaultValue: pathway.titleDefault })}
                      {matchedIds.has(pathway.id) && (
                        <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-bitcoin/15 text-bitcoin border border-bitcoin/20">
                          {t("pathways.matchBadge", { defaultValue: "Recommended for your findings" })}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-muted transition-transform ${expandedPathway === pathway.id ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {expandedPathway === pathway.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-3 space-y-2.5">
                          <p className="text-sm text-muted leading-relaxed">
                            {t(pathway.descKey, {
                              defaultValue: pathway.descDefault,
                            })}
                          </p>
                          {/* Pros */}
                          <div className="space-y-1">
                            {pathway.pros.map((pro, i) => (
                              <div key={i} className="flex items-start gap-1.5">
                                <CheckCircle2
                                  size={12}
                                  className="text-severity-good shrink-0 mt-0.5"
                                />
                                <span className="text-xs text-foreground/80">
                                  {t(pro.key, { defaultValue: pro.default })}
                                </span>
                              </div>
                            ))}
                          </div>
                          {/* Cons */}
                          <div className="space-y-1">
                            {pathway.cons.map((con, i) => (
                              <div key={i} className="flex items-start gap-1.5">
                                <AlertTriangle
                                  size={12}
                                  className="text-severity-medium shrink-0 mt-0.5"
                                />
                                <span className="text-xs text-foreground/80">
                                  {t(con.key, { defaultValue: con.default })}
                                </span>
                              </div>
                            ))}
                          </div>
                          {/* Tools */}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {pathway.tools.map((tool) => (
                              <span
                                key={tool}
                                className="text-[11px] font-mono px-2 py-0.5 rounded bg-card-bg border border-card-border text-muted"
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                          {/* Warnings */}
                          {pathway.warnings?.map((warn, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2"
                            >
                              <Info
                                size={12}
                                className="text-severity-medium shrink-0 mt-0.5"
                              />
                              <span className="text-xs text-foreground/80">
                                {t(warn.key, { defaultValue: warn.default })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}

              {/* Show all pathways toggle */}
              {hasMatches && !showAll && (
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-bitcoin/80 hover:text-bitcoin transition-colors cursor-pointer"
                >
                  {t("pathways.showAll", {
                    count: sortedPathways.length - primaryPathways.length,
                    defaultValue: "Show all pathways (+{{count}} more)",
                  })}
                </button>
              )}

              {/* Combined pathways */}
              <div className="border-t border-card-border pt-3">
                <button
                  onClick={() => setShowCombined(!showCombined)}
                  aria-expanded={showCombined}
                  className="flex items-center gap-1.5 text-sm font-medium text-foreground/90 cursor-pointer hover:text-foreground transition-colors w-full text-left"
                >
                  <Route size={14} className="text-bitcoin" />
                  {t("pathways.combined.title", {
                    defaultValue: "Combined pathways (strongest privacy)",
                  })}
                  <ChevronDown
                    size={14}
                    className={`text-muted transition-transform ml-auto ${showCombined ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence>
                  {showCombined && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-muted leading-relaxed">
                          {t("pathways.combined.intro", {
                            defaultValue:
                              "Think beyond single-tool solutions. The most effective privacy strategies combine multiple techniques across different layers.",
                          })}
                        </p>
                        {COMBINED_PATHWAYS.map((combo) => (
                          <div
                            key={combo.id}
                            className="bg-surface-elevated/50 border border-card-border rounded-lg px-3 py-2.5 space-y-1"
                          >
                            <p className="text-xs font-medium text-bitcoin">
                              {t(combo.titleKey, {
                                defaultValue: combo.titleDefault,
                              })}
                            </p>
                            <p className="text-xs text-foreground/80 leading-relaxed">
                              {t(combo.stepsKey, {
                                defaultValue: combo.stepsDefault,
                              })}
                            </p>
                            <p className="text-[11px] text-muted leading-relaxed">
                              {t(combo.strengthKey, {
                                defaultValue: combo.strengthDefault,
                              })}
                            </p>
                          </div>
                        ))}

                        {/* Jurisdiction note */}
                        <div className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2 mt-1">
                          <AlertTriangle
                            size={12}
                            className="text-severity-medium shrink-0 mt-0.5"
                          />
                          <p className="text-[11px] text-foreground/80 leading-relaxed">
                            {t("pathways.jurisdictionNote", {
                              defaultValue:
                                "Privacy tool availability and legality vary by jurisdiction. Research your local regulations regarding CoinJoin, atomic swaps, and privacy coins before using these techniques. Some exchanges may flag or restrict accounts that interact with known privacy tools.",
                            })}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
