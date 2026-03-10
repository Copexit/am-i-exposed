"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, Shield, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { getWalletIconId } from "@/lib/wallet-icons";

// ── Wallet recommendation data ──────────────────────────────────────────────

interface WalletEntry {
  name: string;
  type: "desktop" | "mobile" | "hardware";
  nSequence: "good" | "bad";
  antiFeeSniping: boolean;
  coinJoin: boolean;
  payJoin: boolean | "v1-only";
  silentPayments: boolean | "send-only";
  ownNode: boolean | "partial" | "is-node";
  tor: boolean | "partial" | "native";
  url: string;
}

const RECOMMENDED_WALLETS: WalletEntry[] = [
  {
    name: "Sparrow",
    type: "desktop",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: true,
    payJoin: "v1-only",
    silentPayments: false,
    ownNode: true,
    tor: true,
    url: "https://sparrowwallet.com",
  },
  {
    name: "Bitcoin Core",
    type: "desktop",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: true,
    ownNode: "is-node",
    tor: true,
    url: "https://bitcoincore.org",
  },
  {
    name: "Electrum",
    type: "desktop",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: false,
    ownNode: true,
    tor: true,
    url: "https://electrum.org",
  },
  {
    name: "Ashigaru",
    type: "mobile",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: true,
    payJoin: false,
    silentPayments: false,
    ownNode: true,
    tor: "native",
    url: "https://ashigaru.rs",
  },
  {
    name: "Trezor Suite",
    type: "hardware",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: false,
    ownNode: true,
    tor: "partial",
    url: "https://trezor.io/trezor-suite",
  },
  {
    name: "Blockstream Jade",
    type: "hardware",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: false,
    ownNode: true,
    tor: true,
    url: "https://blockstream.com/jade",
  },
  {
    name: "Nunchuk",
    type: "desktop",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: true,
    ownNode: true,
    tor: "partial",
    url: "https://nunchuk.io",
  },
  {
    name: "Wasabi",
    type: "desktop",
    nSequence: "bad",
    antiFeeSniping: false,
    coinJoin: true,
    payJoin: false,
    silentPayments: "send-only",
    ownNode: true,
    tor: "native",
    url: "https://wasabiwallet.io",
  },
  {
    name: "Cake Wallet",
    type: "mobile",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: true,
    silentPayments: true,
    ownNode: false,
    tor: true,
    url: "https://cakewallet.com",
  },
  {
    name: "Bull Bitcoin",
    type: "mobile",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: true,
    silentPayments: false,
    ownNode: false,
    tor: false,
    url: "https://bullbitcoin.com",
  },
  {
    name: "Blue Wallet",
    type: "mobile",
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    silentPayments: false,
    ownNode: true,
    tor: false,
    url: "https://bluewallet.io",
  },
];

const WALLETS_TO_AVOID = [
  { name: "Exodus", reason: "walletGuide.avoidExodus" },
  { name: "Trust Wallet", reason: "walletGuide.avoidTrustWallet" },
  { name: "Coinbase Wallet", reason: "walletGuide.avoidCoinbaseWallet" },
  { name: "Exchange wallets", reason: "walletGuide.avoidExchangeWallets" },
];

// ── Good vs Bad wallet criteria ─────────────────────────────────────────────

interface CriteriaRow {
  criteria: string;
  criteriaKey: string;
  good: string;
  goodKey: string;
  bad: string;
  badKey: string;
}

const CRITERIA: CriteriaRow[] = [
  {
    criteria: "nSequence",
    criteriaKey: "walletGuide.criteria.nSequence",
    good: "0xFFFFFFFE (signals locktime support)",
    goodKey: "walletGuide.criteriaGood.nSequence",
    bad: "0xFFFFFFFF (no locktime, no RBF)",
    badKey: "walletGuide.criteriaBad.nSequence",
  },
  {
    criteria: "nLockTime",
    criteriaKey: "walletGuide.criteria.nLockTime",
    good: "Current block height (anti-fee-sniping)",
    goodKey: "walletGuide.criteriaGood.nLockTime",
    bad: "Always 0 (no anti-fee-sniping)",
    badKey: "walletGuide.criteriaBad.nLockTime",
  },
  {
    criteria: "RBF",
    criteriaKey: "walletGuide.criteria.rbf",
    good: "Signaled or configurable",
    goodKey: "walletGuide.criteriaGood.rbf",
    bad: "No support",
    badKey: "walletGuide.criteriaBad.rbf",
  },
  {
    criteria: "Addresses",
    criteriaKey: "walletGuide.criteria.addresses",
    good: "Always new (BIP44/84 HD derivation)",
    goodKey: "walletGuide.criteriaGood.addresses",
    bad: "Reused or manually managed",
    badKey: "walletGuide.criteriaBad.addresses",
  },
  {
    criteria: "Connection",
    criteriaKey: "walletGuide.criteria.connection",
    good: "Own node or Tor",
    goodKey: "walletGuide.criteriaGood.connection",
    bad: "Centralized server only",
    badKey: "walletGuide.criteriaBad.connection",
  },
];

// ── Helper components ───────────────────────────────────────────────────────

function BoolCell({ value }: { value: boolean | "partial" | "native" | "is-node" | "v1-only" | "send-only" }) {
  const { t } = useTranslation();
  if (value === true) return <span className="text-severity-good">&#10003;</span>;
  if (value === false) return <span className="text-muted">&#10007;</span>;
  if (value === "is-node") return <span className="text-severity-good text-xs">{t("walletGuide.isNode", { defaultValue: "Is the node" })}</span>;
  if (value === "native") return <span className="text-severity-good text-xs">{t("walletGuide.native", { defaultValue: "Native" })}</span>;
  if (value === "v1-only") return <span className="text-severity-medium text-xs">{t("walletGuide.v1Only", { defaultValue: "v1 only" })}</span>;
  if (value === "send-only") return <span className="text-severity-medium text-xs">{t("walletGuide.sendOnly", { defaultValue: "Send only" })}</span>;
  return <span className="text-severity-medium text-xs">{t("walletGuide.partial", { defaultValue: "Partial" })}</span>;
}

function TypeBadge({ type }: { type: WalletEntry["type"] }) {
  const { t } = useTranslation();
  const config = {
    desktop: { label: t("walletGuide.typeDesktop", { defaultValue: "Desktop" }), cls: "bg-severity-low/15 text-severity-low" },
    mobile: { label: t("walletGuide.typeMobile", { defaultValue: "Mobile" }), cls: "bg-severity-good/15 text-severity-good" },
    hardware: { label: t("walletGuide.typeHardware", { defaultValue: "Hardware" }), cls: "bg-severity-medium/15 text-severity-medium" },
  };
  const c = config[type];
  return <span className={`text-xs px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
}

// ── Main component ──────────────────────────────────────────────────────────

interface WalletGuideProps {
  /** If provided, highlights the section most relevant to this wallet */
  detectedWallet?: string | null;
  /** If provided, tailors advice to detected wallet capabilities */
  canCoinJoin?: boolean;
}

export function WalletGuide({ detectedWallet, canCoinJoin }: WalletGuideProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Determine if detected wallet is in the recommended or avoid list
  const isRecommended = detectedWallet
    ? RECOMMENDED_WALLETS.some((w) => detectedWallet.toLowerCase().includes(w.name.toLowerCase()))
    : null;
  const isAvoided = detectedWallet
    ? WALLETS_TO_AVOID.some((w) => detectedWallet.toLowerCase().includes(w.name.toLowerCase()))
    : null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="wallet-guide-panel"
        className="inline-flex items-center gap-1.5 text-sm text-bitcoin/80 hover:text-bitcoin transition-colors cursor-pointer bg-bitcoin/10 rounded-lg px-3 py-3"
      >
        <Shield size={16} aria-hidden="true" />
        {t("walletGuide.title", { defaultValue: "Wallet privacy guide" })}
        {detectedWallet && (
          <span className={`text-xs ${isAvoided ? "text-severity-critical" : isRecommended ? "text-severity-good" : "text-muted"}`}>
            ({detectedWallet})
          </span>
        )}
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
            <div id="wallet-guide-panel" className="mt-2 space-y-4">
              {/* Contextual message based on detected wallet */}
              {detectedWallet && (
                <div className={`rounded-lg px-4 py-3 text-sm ${
                  isAvoided
                    ? "bg-severity-critical/10 border border-severity-critical/30 text-severity-critical"
                    : isRecommended
                      ? "bg-severity-good/10 border border-severity-good/30 text-severity-good"
                      : "bg-surface-inset border border-card-border text-muted"
                }`}>
                  {isAvoided ? (
                    <div className="flex items-start gap-2">
                      <WalletIcon walletName={detectedWallet} size="lg" />
                      <ShieldX size={16} className="shrink-0 mt-0.5" />
                      <span>{t("walletGuide.detectedBad", {
                        wallet: detectedWallet,
                        defaultValue: "{{wallet}} detected - this wallet has significant privacy weaknesses. Consider switching to a recommended wallet below.",
                      })}</span>
                    </div>
                  ) : isRecommended ? (
                    <div className="flex items-start gap-2">
                      <WalletIcon walletName={detectedWallet} size="lg" />
                      <ShieldCheck size={16} className="shrink-0 mt-0.5" />
                      <span>{t("walletGuide.detectedGood", {
                        wallet: detectedWallet,
                        defaultValue: "{{wallet}} detected - good choice. This wallet follows recommended privacy practices.",
                      })}</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <WalletIcon walletName={detectedWallet} size="lg" />
                      <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                      <span>{t("walletGuide.detectedUnknown", {
                        wallet: detectedWallet,
                        defaultValue: "{{wallet}} detected. Check the criteria below to evaluate its privacy properties.",
                      })}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Contextual advice based on wallet capabilities */}
              {detectedWallet && canCoinJoin === false && (
                <div className="bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted border-l-2 border-l-severity-medium">
                  <p className="font-medium text-foreground/90 mb-1">
                    {t("walletGuide.noCoinJoinTitle", { defaultValue: "Hardware wallet? Use coin control instead" })}
                  </p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>{t("walletGuide.noCoinJoin1", { defaultValue: "Spend UTXOs individually - never combine inputs from different sources" })}</li>
                    <li>{t("walletGuide.noCoinJoin2", { defaultValue: "Use coin control to select specific UTXOs for each transaction" })}</li>
                    <li>{t("walletGuide.noCoinJoin3", { defaultValue: "Avoid consolidation transactions - they link your addresses together" })}</li>
                    <li>{t("walletGuide.noCoinJoin4", { defaultValue: "For mixing, consider Sparrow Wallet as a companion for CoinJoin before sending to hardware" })}</li>
                  </ul>
                </div>
              )}

              {/* Recommended wallets table */}
              <div className="bg-surface-inset rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-card-border">
                  <h3 className="text-sm font-medium text-foreground/90">
                    {t("walletGuide.recommendedTitle", { defaultValue: "Recommended wallets - low on-chain footprint" })}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border text-xs text-muted">
                        <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colWallet", { defaultValue: "Wallet" })}</th>
                        <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colType", { defaultValue: "Type" })}</th>
                        <th className="text-center px-2 py-2 font-medium whitespace-nowrap">nSeq</th>
                        <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colAntiFeeSniping", { defaultValue: "Anti-snip" })}</th>
                        <th className="text-center px-2 py-2 font-medium">CoinJoin</th>
                        <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colPayJoin", { defaultValue: "PayJoin" })}</th>
                        <th className="text-center px-2 py-2 font-medium whitespace-nowrap" title="Silent Payments (BIP352)">{t("walletGuide.colSilentPay", { defaultValue: "SP" })}</th>
                        <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colOwnNode", { defaultValue: "Own Node" })}</th>
                        <th className="text-center px-2 py-2 font-medium">Tor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RECOMMENDED_WALLETS.map((w) => (
                        <tr
                          key={w.name}
                          className={`border-b border-card-border/50 hover:bg-surface-elevated/50 transition-colors ${
                            detectedWallet?.toLowerCase().includes(w.name.toLowerCase())
                              ? "bg-bitcoin/5"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-2">
                            <a
                              href={w.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors"
                            >
                              <WalletIcon walletName={w.name} size="md" />
                              {w.name}
                              <ExternalLink size={12} />
                            </a>
                          </td>
                          <td className="text-center px-2 py-2"><TypeBadge type={w.type} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.nSequence === "good"} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.antiFeeSniping} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.coinJoin} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.payJoin} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.silentPayments} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.ownNode} /></td>
                          <td className="text-center px-2 py-2"><BoolCell value={w.tor} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Wallets to avoid */}
              <div className="bg-severity-critical/5 border border-severity-critical/20 rounded-lg px-4 py-3">
                <h3 className="text-sm font-medium text-severity-critical mb-2">
                  {t("walletGuide.avoidTitle", { defaultValue: "Wallets to avoid for privacy" })}
                </h3>
                <ul className="space-y-1.5">
                  {WALLETS_TO_AVOID.map((w) => (
                    <li key={w.name} className="flex items-start gap-2 text-sm text-muted">
                      <WalletIcon walletName={w.name} size="sm" className="mt-0.5" />
                      <ShieldX size={14} className="text-severity-critical shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground/90">{w.name}</strong>
                        {" - "}
                        {defaultAvoidReason(t, w.name)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Good vs bad criteria table */}
              <div className="bg-surface-inset rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-card-border">
                  <h3 className="text-sm font-medium text-foreground/90">
                    {t("walletGuide.criteriaTitle", { defaultValue: "What makes a wallet good or bad for privacy" })}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border text-xs text-muted">
                        <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colCriteria", { defaultValue: "Criteria" })}</th>
                        <th className="text-left px-3 py-2 font-medium text-severity-good">{t("walletGuide.colGood", { defaultValue: "Good" })}</th>
                        <th className="text-left px-3 py-2 font-medium text-severity-critical">{t("walletGuide.colBad", { defaultValue: "Bad" })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CRITERIA.map((row) => (
                        <tr key={row.criteria} className="border-b border-card-border/50">
                          <td className="px-4 py-2 font-mono text-xs text-foreground/90">
                            {t(row.criteriaKey, { defaultValue: row.criteria })}
                          </td>
                          <td className="px-3 py-2 text-xs text-severity-good">
                            {t(row.goodKey, { defaultValue: row.good })}
                          </td>
                          <td className="px-3 py-2 text-xs text-severity-critical">
                            {t(row.badKey, { defaultValue: row.bad })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fingerprint contradiction resolution (Item 3) */}
              <div className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50">
                <h3 className="text-sm font-medium text-foreground/90 mb-2">
                  {t("walletGuide.contradictionTitle", { defaultValue: "Why recommend wallets that have fingerprints?" })}
                </h3>
                <div className="text-sm text-muted space-y-2 leading-relaxed">
                  <p>
                    {t("walletGuide.contradictionP1", {
                      defaultValue: "Every wallet leaves a fingerprint - that is unavoidable. The goal is not to be invisible, but to be indistinguishable from millions of other users.",
                    })}
                  </p>
                  <p>
                    {t("walletGuide.contradictionP2", {
                      defaultValue: "A Bitcoin Core fingerprint is shared by millions of transactions. Knowing someone uses Bitcoin Core reveals almost nothing useful. An Exodus fingerprint, on the other hand, reveals poor privacy practices (no coin control, no Tor, centralized servers) and belongs to a much smaller set.",
                    })}
                  </p>
                  <p className="text-foreground/80 font-medium">
                    {t("walletGuide.contradictionP3", {
                      defaultValue: "Choose wallets where the fingerprint says \"one of millions\" rather than \"one of a few with poor habits.\"",
                    })}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function defaultAvoidReason(t: (key: string, opts?: Record<string, unknown>) => string, name: string): string {
  switch (name) {
    case "Exodus": return t("walletGuide.avoidExodus", { defaultValue: "Clear fingerprint (nVersion=1, nLockTime=0), no coin control, no Tor, centralized servers" });
    case "Trust Wallet": return t("walletGuide.avoidTrustWallet", { defaultValue: "No coin control, no Tor support, sends all queries through centralized infrastructure" });
    case "Coinbase Wallet": return t("walletGuide.avoidCoinbaseWallet", { defaultValue: "Integrated with Coinbase exchange, queries go through Coinbase servers, no privacy features" });
    case "Exchange wallets": return t("walletGuide.avoidExchangeWallets", { defaultValue: "Custodial - the exchange controls your keys and sees all your transactions" });
    default: return t("walletGuide.avoidDefault", { defaultValue: "Poor privacy practices" });
  }
}
