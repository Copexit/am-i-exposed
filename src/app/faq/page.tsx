"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";

const FAQ_ITEMS = [
  {
    id: "traceable",
    qKey: "faq.q_traceable",
    aKey: "faq.a_traceable",
  },
  {
    id: "traced-to-me",
    qKey: "faq.q_traced_to_me",
    aKey: "faq.a_traced_to_me",
  },
  {
    id: "check-privacy",
    qKey: "faq.q_check_privacy",
    aKey: "faq.a_check_privacy",
  },
  {
    id: "safe",
    qKey: "faq.q_safe",
    aKey: "faq.a_safe",
  },
  {
    id: "oxt-kycp",
    qKey: "faq.q_oxt_kycp",
    aKey: "faq.a_oxt_kycp",
  },
  {
    id: "coinjoin",
    qKey: "faq.q_coinjoin",
    aKey: "faq.a_coinjoin",
  },
  {
    id: "dust-attack",
    qKey: "faq.q_dust_attack",
    aKey: "faq.a_dust_attack",
  },
  {
    id: "address-reuse",
    qKey: "faq.q_address_reuse",
    aKey: "faq.a_address_reuse",
  },
  {
    id: "change-detection",
    qKey: "faq.q_change_detection",
    aKey: "faq.a_change_detection",
  },
  {
    id: "scoring",
    qKey: "faq.q_scoring",
    aKey: "faq.a_scoring",
  },
  {
    id: "tor",
    qKey: "faq.q_tor",
    aKey: "faq.a_tor",
  },
  {
    id: "cioh",
    qKey: "faq.q_cioh",
    aKey: "faq.a_cioh",
  },
  {
    id: "data",
    qKey: "faq.q_data",
    aKey: "faq.a_data",
  },
];

const DEFAULTS: Record<string, string> = {
  "faq.q_traceable": "Is my Bitcoin transaction traceable?",
  "faq.a_traceable": "Most Bitcoin transactions are partially traceable. Chain analysis firms use heuristics like common-input-ownership, change detection, and address reuse to trace fund flows. am-i.exposed runs 16 of these heuristics client-side to show you exactly what surveillance firms can infer about your transactions.",
  "faq.q_traced_to_me": "Can Bitcoin be traced back to me?",
  "faq.a_traced_to_me": "Bitcoin is pseudonymous, not anonymous. If any address you control has ever been linked to your identity - through an exchange, a merchant, or public posting - chain analysis can follow the trail to your other addresses. The more you reuse addresses and make round-amount payments, the easier it is.",
  "faq.q_check_privacy": "How can I check my Bitcoin privacy?",
  "faq.a_check_privacy": "Paste your Bitcoin address or transaction ID into am-i.exposed. The tool analyzes it using 16 heuristics - the same techniques chain analysis firms use - and gives you a privacy score from 0 to 100 with a letter grade (A+ to F) and specific actionable findings. Everything runs in your browser with no tracking.",
  "faq.q_safe": "Is am-i.exposed safe to use?",
  "faq.a_safe": "All analysis runs client-side in your browser. There is no server, no accounts, no cookies, and no tracking. However, your browser makes API requests to mempool.space to fetch blockchain data, which means their servers can see your IP and queries. For maximum privacy, use Tor Browser or connect your own node.",
  "faq.q_oxt_kycp": "What happened to OXT.me and KYCP.org?",
  "faq.a_oxt_kycp": "OXT.me and KYCP.org went offline in April 2024 following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. am-i.exposed was created to fill the gap left by these tools.",
  "faq.q_coinjoin": "Does CoinJoin improve Bitcoin privacy?",
  "faq.a_coinjoin": "Yes. CoinJoin is the most effective technique for improving on-chain privacy. It breaks the common-input-ownership heuristic by combining inputs from multiple independent participants. Whirlpool and WabiSabi CoinJoin transactions regularly score A+ on am-i.exposed.",
  "faq.q_dust_attack": "What is a Bitcoin dust attack?",
  "faq.a_dust_attack": "A dust attack sends tiny amounts of Bitcoin (dust) to your addresses. If you later spend that dust alongside your other UTXOs, you link those addresses together - giving the attacker a map of your wallet. am-i.exposed detects dust outputs and warns you not to spend them.",
  "faq.q_address_reuse": "Why is address reuse bad for Bitcoin privacy?",
  "faq.a_address_reuse": "Address reuse creates deterministic, irrefutable links between all transactions using that address. It carries the harshest penalty in privacy scoring. Most modern wallets generate a new address for each receive to avoid this. If you are reusing addresses, switch to a wallet that supports HD key derivation.",
  "faq.q_change_detection": "What is the change detection heuristic?",
  "faq.a_change_detection": "When you send Bitcoin, the leftover amount (change) is sent back to your own wallet. Chain analysis firms use several techniques to identify which output is the change: (1) Address type mismatch - if inputs are all bc1q but one output is a different type, the matching output is likely change. (2) Round amounts - a round payment (e.g. 0.01 BTC) next to a non-round output reveals which is the payment and which is change. (3) Unnecessary inputs - spending more inputs than needed can expose your wallet's total balance. (4) Peel chains - repeated small payments from a single source create a traceable chain of decreasing outputs. (5) nLockTime and nVersion fingerprinting - different wallets sign with different version values, so if the change output was created by a different wallet than the payment output, the mismatch reveals which is change. (6) Output ordering (BIP 69) - some wallets used to place change in a fixed position, making it trivially identifiable. (7) Script type mismatch - paying from native SegWit to a multisig address makes the type difference obvious. Change detection combined with address reuse are the two most devastating heuristics for privacy - together they allow an observer to trace the full flow of funds. To protect yourself: use a wallet that sends change to the same address type (Sparrow, Ashigaru), avoid round payment amounts, use coin control to select specific UTXOs, and consider Stonewall or PayJoin transactions which break the change heuristic entirely.",
  "faq.q_scoring": "How does Bitcoin privacy scoring work?",
  "faq.a_scoring": "Every analysis starts from a base score of 70. Each of the 16 heuristics applies a positive or negative modifier based on what it detects. The sum is clamped to 0-100. Only CoinJoin participation, Taproot usage, and high entropy can raise the score. Everything else can only lower it. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24).",
  "faq.q_tor": "Can I use am-i.exposed with Tor?",
  "faq.a_tor": "Yes. When you use Tor Browser, am-i.exposed auto-detects it and routes API requests through the mempool.space .onion endpoint. This hides which addresses you are querying from mempool.space. For even stronger privacy, connect your own mempool instance via the Setup Guide.",
  "faq.q_cioh": "What is the Common Input Ownership Heuristic?",
  "faq.a_cioh": "If a Bitcoin transaction spends multiple inputs, all inputs are assumed to belong to the same entity. This is the foundational clustering heuristic used by chain surveillance firms like Chainalysis and Elliptic to link addresses together. CoinJoin is the primary way to break this assumption.",
  "faq.q_data": "Does am-i.exposed store my data?",
  "faq.a_data": "No. There is no server, no database, and no analytics. The static site is served from GitHub Pages. Your addresses and transactions are never logged, stored, or transmitted to anyone. The only external requests go to mempool.space for blockchain data (or your own instance if configured).",
};

export default function FaqPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (id: string) => setOpen((prev) => (prev === id ? null : id));

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {t("faq.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("faq.title", { defaultValue: "Frequently Asked Questions" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("faq.subtitle", { defaultValue: "Common questions about Bitcoin privacy and how am-i.exposed works." })}
          </p>
        </div>

        {/* FAQ accordion */}
        <div className="space-y-3">
          {FAQ_ITEMS.map((item) => (
            <div
              key={item.id}
              id={item.id}
              className="rounded-xl border border-card-border bg-surface-elevated/50 overflow-hidden"
            >
              <button
                onClick={() => toggle(item.id)}
                aria-expanded={open === item.id}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer min-h-[44px]"
              >
                <span className="text-sm font-medium text-foreground leading-relaxed">
                  {t(item.qKey, { defaultValue: DEFAULTS[item.qKey] })}
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-muted transition-transform duration-200 ${open === item.id ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {open === item.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 text-sm text-muted leading-relaxed">
                      {t(item.aKey, { defaultValue: DEFAULTS[item.aKey] })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted">
            {t("faq.cta", { defaultValue: "Still have questions? Check the methodology or scan a transaction to see for yourself." })}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/methodology"
              className="text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
            >
              {t("common.methodology", { defaultValue: "Methodology" })}
            </Link>
            <Link
              href="/"
              className="text-sm px-4 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 text-bitcoin hover:border-bitcoin/40 transition-all"
            >
              {t("faq.scanNow", { defaultValue: "Scan now" })}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
