"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const GLOSSARY_ITEMS = [
  {
    id: "address-reuse",
    termKey: "glossary.term_address_reuse",
    defKey: "glossary.def_address_reuse",
  },
  {
    id: "bip47",
    termKey: "glossary.term_bip47",
    defKey: "glossary.def_bip47",
  },
  {
    id: "bisq",
    termKey: "glossary.term_bisq",
    defKey: "glossary.def_bisq",
  },
  {
    id: "boltzmann-entropy",
    termKey: "glossary.term_boltzmann",
    defKey: "glossary.def_boltzmann",
  },
  {
    id: "chain-analysis",
    termKey: "glossary.term_chain_analysis",
    defKey: "glossary.def_chain_analysis",
  },
  {
    id: "change-output",
    termKey: "glossary.term_change_output",
    defKey: "glossary.def_change_output",
  },
  {
    id: "cioh",
    termKey: "glossary.term_cioh",
    defKey: "glossary.def_cioh",
  },
  {
    id: "coin-control",
    termKey: "glossary.term_coin_control",
    defKey: "glossary.def_coin_control",
  },
  {
    id: "coinjoin",
    termKey: "glossary.term_coinjoin",
    defKey: "glossary.def_coinjoin",
  },
  {
    id: "consolidation",
    termKey: "glossary.term_consolidation",
    defKey: "glossary.def_consolidation",
  },
  {
    id: "dust-attack",
    termKey: "glossary.term_dust_attack",
    defKey: "glossary.def_dust_attack",
  },
  {
    id: "hd-wallet",
    termKey: "glossary.term_hd_wallet",
    defKey: "glossary.def_hd_wallet",
  },
  {
    id: "heuristic",
    termKey: "glossary.term_heuristic",
    defKey: "glossary.def_heuristic",
  },
  {
    id: "hodlhodl",
    termKey: "glossary.term_hodlhodl",
    defKey: "glossary.def_hodlhodl",
  },
  {
    id: "joinmarket",
    termKey: "glossary.term_joinmarket",
    defKey: "glossary.def_joinmarket",
  },
  {
    id: "mempool",
    termKey: "glossary.term_mempool",
    defKey: "glossary.def_mempool",
  },
  {
    id: "multisig",
    termKey: "glossary.term_multisig",
    defKey: "glossary.def_multisig",
  },
  {
    id: "op-return",
    termKey: "glossary.term_op_return",
    defKey: "glossary.def_op_return",
  },
  {
    id: "payjoin",
    termKey: "glossary.term_payjoin",
    defKey: "glossary.def_payjoin",
  },
  {
    id: "paynym",
    termKey: "glossary.term_paynym",
    defKey: "glossary.def_paynym",
  },
  {
    id: "peel-chain",
    termKey: "glossary.term_peel_chain",
    defKey: "glossary.def_peel_chain",
  },
  {
    id: "privacy-score",
    termKey: "glossary.term_privacy_score",
    defKey: "glossary.def_privacy_score",
  },
  {
    id: "round-amount",
    termKey: "glossary.term_round_amount",
    defKey: "glossary.def_round_amount",
  },
  {
    id: "script-type",
    termKey: "glossary.term_script_type",
    defKey: "glossary.def_script_type",
  },
  {
    id: "self-send",
    termKey: "glossary.term_self_send",
    defKey: "glossary.def_self_send",
  },
  {
    id: "stonewall",
    termKey: "glossary.term_stonewall",
    defKey: "glossary.def_stonewall",
  },
  {
    id: "sweep",
    termKey: "glossary.term_sweep",
    defKey: "glossary.def_sweep",
  },
  {
    id: "taproot",
    termKey: "glossary.term_taproot",
    defKey: "glossary.def_taproot",
  },
  {
    id: "tor",
    termKey: "glossary.term_tor",
    defKey: "glossary.def_tor",
  },
  {
    id: "utxo",
    termKey: "glossary.term_utxo",
    defKey: "glossary.def_utxo",
  },
  {
    id: "wallet-fingerprint",
    termKey: "glossary.term_wallet_fingerprint",
    defKey: "glossary.def_wallet_fingerprint",
  },
  {
    id: "whirlpool",
    termKey: "glossary.term_whirlpool",
    defKey: "glossary.def_whirlpool",
  },
  {
    id: "wabisabi",
    termKey: "glossary.term_wabisabi",
    defKey: "glossary.def_wabisabi",
  },
];

const DEFAULTS: Record<string, string> = {
  "glossary.term_address_reuse": "Address Reuse",
  "glossary.def_address_reuse": "Using the same Bitcoin address for multiple transactions. Creates deterministic links between all transactions involving that address, severely degrading privacy.",
  "glossary.term_bip47": "BIP47 (Reusable Payment Codes)",
  "glossary.def_bip47": "A protocol that allows two parties to create a shared secret from which unique addresses are derived for each payment. Prevents address reuse without requiring out-of-band address exchange.",
  "glossary.term_bisq": "Bisq",
  "glossary.def_bisq": "A decentralized, non-custodial Bitcoin exchange operating as a peer-to-peer network with no central server. Bisq trades use 2-of-2 multisig escrow transactions on-chain and send trade fees to publicly known DAO addresses, making them identifiable by chain analysis. Unlike centralized exchanges, Bisq does not require identity verification.",
  "glossary.term_boltzmann": "Boltzmann Entropy",
  "glossary.def_boltzmann": "A measure of the number of possible interpretations of a Bitcoin transaction's inputs and outputs. Higher entropy means more ambiguity and better privacy. Named after physicist Ludwig Boltzmann.",
  "glossary.term_chain_analysis": "Chain Analysis",
  "glossary.def_chain_analysis": "The practice of tracing Bitcoin fund flows by applying heuristics to the public blockchain. Used by surveillance firms like Chainalysis and Elliptic to cluster addresses and deanonymize users.",
  "glossary.term_change_output": "Change Output",
  "glossary.def_change_output": "The output in a Bitcoin transaction that returns unspent funds to the sender. Identifying change outputs links the sender to future transactions. Change detection is a core chain analysis technique.",
  "glossary.term_coin_control": "Coin Control",
  "glossary.def_coin_control": "A wallet feature that allows manual selection of specific UTXOs as inputs for a transaction, rather than relying on the wallet's automatic selection algorithm. Essential for privacy because it prevents accidentally co-spending UTXOs from different sources, which would link them via the Common Input Ownership Heuristic.",
  "glossary.term_cioh": "Common Input Ownership Heuristic (CIOH)",
  "glossary.def_cioh": "The assumption that all inputs in a transaction belong to the same entity. The foundational clustering heuristic used by chain surveillance firms. CoinJoin is the primary way to break this assumption.",
  "glossary.term_consolidation": "Consolidation (UTXO Consolidation)",
  "glossary.def_consolidation": "A transaction that combines multiple UTXOs into fewer outputs (usually one), typically to reduce future transaction fees. Creates zero entropy and links all input addresses together via the Common Input Ownership Heuristic. For privacy, only consolidate UTXOs that are already linked, or run them through a CoinJoin first.",
  "glossary.term_coinjoin": "CoinJoin",
  "glossary.def_coinjoin": "A technique where multiple users combine their transactions into one, breaking the common-input-ownership assumption. Implementations include Whirlpool (5 equal outputs) and WabiSabi (variable amounts, 20+ participants).",
  "glossary.term_dust_attack": "Dust Attack",
  "glossary.def_dust_attack": "Sending tiny amounts of Bitcoin (dust) to target addresses. If the recipient spends the dust alongside other UTXOs, the attacker can link those addresses together, mapping the victim's wallet.",
  "glossary.term_hd_wallet": "HD Wallet",
  "glossary.def_hd_wallet": "A Hierarchical Deterministic wallet that generates a new address for each transaction from a single seed phrase. Avoids address reuse by default. Defined in BIP32/BIP44.",
  "glossary.term_hodlhodl": "Hodl Hodl",
  "glossary.def_hodlhodl": "A non-custodial, peer-to-peer Bitcoin trading platform that uses 2-of-3 multisig escrow with the platform as a key-holding arbitrator. The platform never takes custody of funds. Trades create P2SH or P2WSH multisig outputs on-chain, with the multisig structure revealed when the escrow is spent.",
  "glossary.term_heuristic": "Heuristic",
  "glossary.def_heuristic": "A rule-of-thumb used to infer information about a Bitcoin transaction. am-i.exposed applies 17 heuristics to estimate what surveillance firms can deduce about any transaction or address.",
  "glossary.term_joinmarket": "JoinMarket",
  "glossary.def_joinmarket": "A decentralized CoinJoin implementation using a maker-taker model. Makers offer liquidity and earn fees; takers pay for privacy. Creates transactions with varied input/output counts.",
  "glossary.term_multisig": "Multisig (Multi-Signature)",
  "glossary.def_multisig": "A spending condition requiring M of N private keys to authorize a transaction (e.g., 2-of-3). Used for shared custody, escrow, and enhanced security. Legacy bare multisig is visible on-chain before spending. P2SH/P2WSH multisig reveals the structure only when spent. Taproot multisig using MuSig2 is indistinguishable from a single-signature spend on-chain.",
  "glossary.term_mempool": "Mempool",
  "glossary.def_mempool": "The set of unconfirmed Bitcoin transactions waiting to be included in a block. am-i.exposed fetches blockchain data from the mempool.space API (or a self-hosted instance).",
  "glossary.term_op_return": "OP_RETURN",
  "glossary.def_op_return": "A Bitcoin script opcode that embeds arbitrary data in the blockchain. Can leak metadata like timestamps, protocol identifiers, or messages that fingerprint the transaction.",
  "glossary.term_payjoin": "PayJoin (P2EP)",
  "glossary.def_payjoin": "A transaction where both sender and recipient contribute inputs, breaking the Common Input Ownership Heuristic. Appears identical to a normal transaction on-chain - an observer cannot determine that two parties participated. Also called Pay-to-Endpoint (P2EP) or Stowaway (in Ashigaru). PayJoin V2 (BIP-77) operates asynchronously without requiring the recipient to run a server.",
  "glossary.term_paynym": "PayNym",
  "glossary.def_paynym": "A user-friendly identity layer built on BIP47 reusable payment codes. Allows receiving Bitcoin without revealing addresses publicly. Used by Samourai and Sparrow wallets.",
  "glossary.term_peel_chain": "Peel Chain",
  "glossary.def_peel_chain": "A pattern where a large UTXO is repeatedly spent, peeling off small payments and returning the remainder as change. Creates a traceable chain of decreasing outputs (e.g. 2.0 BTC -> pay 0.1, change 1.9 -> pay 0.2, change 1.7). Chain analysts use this to track funds across many transactions.",
  "glossary.term_privacy_score": "Privacy Score",
  "glossary.def_privacy_score": "A 0-100 rating computed by am-i.exposed based on 17 heuristics. Starts at 70, adjusted by findings. Only CoinJoin, Taproot, and high entropy can raise it. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24).",
  "glossary.term_round_amount": "Round Amount Detection",
  "glossary.def_round_amount": "A heuristic that identifies round-number outputs (e.g., 0.1 BTC, 1,000,000 sats) as likely payments, with the non-round output being change. Reveals spending patterns.",
  "glossary.term_self_send": "Self-send (Self-transfer)",
  "glossary.def_self_send": "A transaction where one or more outputs return to an address that was also an input. This trivially identifies the change output, revealing the sender's remaining balance and the exact payment amount. HD wallets avoid this by generating a fresh change address for every transaction.",
  "glossary.term_stonewall": "Stonewall",
  "glossary.def_stonewall": "A steganographic transaction format from Samourai Wallet (now Ashigaru) that mimics a CoinJoin. Has 2-4 inputs and exactly 4 outputs: 2 equal-valued outputs (one real payment, one decoy) and 2 change outputs. Solo Stonewall uses only the sender's UTXOs. STONEWALLx2 involves a collaborator contributing inputs, making it indistinguishable from a genuine 2-party CoinJoin.",
  "glossary.term_sweep": "Sweep",
  "glossary.def_sweep": "A transaction that sends the entire balance of one or more addresses to a single output with no change. Common when migrating wallets or claiming funds. A single-input sweep (1-in-1-out) has zero entropy. A multi-input sweep additionally links all input addresses via the Common Input Ownership Heuristic. Provides zero unlinkability.",
  "glossary.term_script_type": "Script Type",
  "glossary.def_script_type": "The address format used in a transaction (P2PKH, P2SH, P2WPKH, P2TR). Mixing script types in inputs or outputs can fingerprint change outputs since the change usually matches the sender's address type.",
  "glossary.term_taproot": "Taproot",
  "glossary.def_taproot": "A Bitcoin upgrade (activated November 2021) that makes complex spending conditions look like simple ones on-chain. Improves privacy by making multisig, timelocks, and scripts indistinguishable from regular payments.",
  "glossary.term_tor": "Tor",
  "glossary.def_tor": "An anonymity network that routes internet traffic through multiple relays. am-i.exposed auto-detects Tor Browser and routes API requests through the mempool.space .onion endpoint to hide which addresses are being queried.",
  "glossary.term_utxo": "UTXO",
  "glossary.def_utxo": "Unspent Transaction Output - the fundamental unit of Bitcoin. Each UTXO is a discrete chunk of bitcoin that can be spent as an input in a future transaction. Managing UTXOs carefully is key to maintaining privacy.",
  "glossary.term_wallet_fingerprint": "Wallet Fingerprint",
  "glossary.def_wallet_fingerprint": "Distinctive patterns left by wallet software - transaction version, locktime, sequence numbers, signature encoding - that reveal which wallet created a transaction.",
  "glossary.term_whirlpool": "Whirlpool",
  "glossary.def_whirlpool": "A CoinJoin implementation by Samourai Wallet that creates transactions with exactly 5 equal outputs at fixed denominations (0.5, 0.05, 0.01, 0.001 BTC), achieving high entropy and strong privacy.",
  "glossary.term_wabisabi": "WabiSabi",
  "glossary.def_wabisabi": "A CoinJoin protocol used by Wasabi Wallet that allows variable-amount outputs using cryptographic credentials. Supports 20+ participants per round with flexible denomination selection.",
};

export default function GlossaryPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const items = filter.trim()
      ? GLOSSARY_ITEMS.filter((item) => {
          const q = filter.toLowerCase();
          const term = t(item.termKey, { defaultValue: DEFAULTS[item.termKey] }).toLowerCase();
          const def = t(item.defKey, { defaultValue: DEFAULTS[item.defKey] }).toLowerCase();
          return term.includes(q) || def.includes(q);
        })
      : GLOSSARY_ITEMS;

    const groups: { letter: string; items: typeof GLOSSARY_ITEMS }[] = [];
    let currentLetter = "";
    for (const item of items) {
      const term = t(item.termKey, { defaultValue: DEFAULTS[item.termKey] });
      const letter = term.charAt(0).toUpperCase();
      if (letter !== currentLetter) {
        currentLetter = letter;
        groups.push({ letter, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [filter, t]);

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-8">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {t("glossary.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title + search */}
        <div className="space-y-4">
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t("glossary.title", { defaultValue: "Bitcoin Privacy Glossary" })}
            </h1>
            <p className="text-muted text-lg leading-relaxed max-w-2xl">
              {t("glossary.subtitle", { defaultValue: "Key terms and concepts for understanding Bitcoin on-chain privacy." })}
            </p>
          </div>

          {/* Search filter */}
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("glossary.search", { defaultValue: "Filter terms..." })}
              aria-label={t("glossary.search", { defaultValue: "Filter terms..." })}
              className={`w-full pl-9 ${filter ? "pr-8" : "pr-4"} py-2.5 text-sm bg-surface-elevated/50 border border-card-border rounded-lg text-foreground placeholder:text-muted/70 focus:border-bitcoin/30 focus-visible:outline-2 focus-visible:outline-bitcoin/50 transition-colors`}
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors cursor-pointer"
                aria-label={t("glossary.clearFilter", { defaultValue: "Clear filter" })}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Terms */}
        <div className="space-y-8">
          {grouped.length === 0 && (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm text-muted">
                {t("glossary.noResults", { defaultValue: "No matching terms found." })}
              </p>
              <button
                onClick={() => setFilter("")}
                className="text-sm text-bitcoin hover:text-bitcoin/80 transition-colors cursor-pointer"
              >
                {t("glossary.clearFilter", { defaultValue: "Clear filter" })}
              </button>
            </div>
          )}
          {grouped.map(({ letter, items }) => (
            <section key={letter} aria-label={`Terms starting with ${letter}`}>
              <h2 className="text-sm font-bold text-muted uppercase tracking-widest mb-3 ml-1 flex items-center gap-3">
                {letter}
                <span className="flex-1 h-px bg-card-border" />
              </h2>
              <dl className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    id={item.id}
                    className="rounded-xl border border-card-border bg-surface-elevated/50 px-5 py-4 space-y-1.5 hover:border-card-border/80 hover:bg-surface-elevated/70 transition-colors"
                  >
                    <dt className="text-sm font-semibold text-foreground">
                      {t(item.termKey, { defaultValue: DEFAULTS[item.termKey] })}
                    </dt>
                    <dd className="text-sm text-muted leading-relaxed">
                      {t(item.defKey, { defaultValue: DEFAULTS[item.defKey] })}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted">
            {t("glossary.cta", { defaultValue: "Ready to analyze a transaction? See these concepts in action." })}
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
              className="text-sm px-4 py-2.5 rounded-lg bg-bitcoin text-bg hover:bg-bitcoin/90 transition-all"
            >
              {t("glossary.scanNow", { defaultValue: "Scan now" })}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
