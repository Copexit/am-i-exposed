import type { Metadata } from "next";

const TERMS = [
  { term: "Address Reuse", definition: "Using the same Bitcoin address for multiple transactions. Creates deterministic links between all transactions involving that address, severely degrading privacy." },
  { term: "BIP47 (Reusable Payment Codes)", definition: "A protocol that allows two parties to create a shared secret from which unique addresses are derived for each payment. Prevents address reuse without requiring out-of-band address exchange." },
  { term: "Bisq", definition: "A decentralized, non-custodial Bitcoin exchange operating as a peer-to-peer network with no central server. Bisq trades use 2-of-2 multisig escrow transactions on-chain and send trade fees to publicly known DAO addresses, making them identifiable by chain analysis." },
  { term: "Boltzmann Entropy", definition: "A measure of the number of possible interpretations of a Bitcoin transaction's inputs and outputs. Higher entropy means more ambiguity and better privacy." },
  { term: "Chain Analysis", definition: "The practice of tracing Bitcoin fund flows by applying heuristics to the public blockchain. Used by surveillance firms like Chainalysis and Elliptic." },
  { term: "Change Output", definition: "The output in a Bitcoin transaction that returns unspent funds to the sender. Identifying change outputs links the sender to future transactions." },
  { term: "Coin Control", definition: "A wallet feature that allows manual selection of specific UTXOs as inputs for a transaction, rather than relying on automatic selection. Essential for privacy because it prevents accidentally co-spending UTXOs from different sources." },
  { term: "CoinJoin", definition: "A technique where multiple users combine their transactions into one, breaking the common-input-ownership assumption. Implementations include Whirlpool and WabiSabi." },
  { term: "Common Input Ownership Heuristic (CIOH)", definition: "The assumption that all inputs in a transaction belong to the same entity. The foundational clustering heuristic used by chain surveillance firms." },
  { term: "Consolidation (UTXO Consolidation)", definition: "A transaction that combines multiple UTXOs into fewer outputs, typically to reduce future transaction fees. Creates zero entropy and links all input addresses together via CIOH." },
  { term: "Dust Attack", definition: "Sending tiny amounts of Bitcoin (dust) to target addresses. If the recipient spends the dust alongside other UTXOs, the attacker can link those addresses." },
  { term: "HD Wallet", definition: "A Hierarchical Deterministic wallet that generates a new address for each transaction from a single seed, avoiding address reuse." },
  { term: "Heuristic", definition: "A rule-of-thumb used to infer information about a Bitcoin transaction. am-i.exposed applies 30 heuristics to estimate what surveillance firms can deduce." },
  { term: "Hodl Hodl", definition: "A non-custodial, peer-to-peer Bitcoin trading platform that uses 2-of-3 multisig escrow with the platform as a key-holding arbitrator. Trades create P2SH or P2WSH multisig outputs on-chain." },
  { term: "JoinMarket", definition: "A decentralized CoinJoin implementation using a maker-taker model. Makers offer liquidity and earn fees; takers pay for privacy. Creates transactions with varied input/output counts." },
  { term: "Mempool", definition: "The set of unconfirmed Bitcoin transactions waiting to be included in a block. am-i.exposed fetches blockchain data from mempool.space." },
  { term: "Multisig (Multi-Signature)", definition: "A spending condition requiring M of N private keys to authorize a transaction (e.g., 2-of-3). Taproot multisig using MuSig2 is indistinguishable from a single-signature spend on-chain." },
  { term: "OP_RETURN", definition: "A Bitcoin script opcode that embeds arbitrary data in the blockchain. Can leak metadata like timestamps or protocol identifiers." },
  { term: "PayJoin (P2EP)", definition: "A transaction where both sender and recipient contribute inputs, breaking the Common Input Ownership Heuristic. Appears identical to a normal transaction on-chain." },
  { term: "PayNym", definition: "A user-friendly identity layer built on BIP47 reusable payment codes. Allows receiving Bitcoin without revealing addresses publicly." },
  { term: "Peel Chain", definition: "A pattern where a large UTXO is repeatedly spent, peeling off small payments and returning the remainder as change. Creates a traceable chain of decreasing outputs." },
  { term: "Privacy Score", definition: "A 0-100 rating computed by am-i.exposed based on 30 heuristics. Higher scores indicate better privacy. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24)." },
  { term: "Round Amount Detection", definition: "A heuristic that identifies round-number outputs (e.g., 0.1 BTC, 1,000,000 sats) as likely payments, with the non-round output being change." },
  { term: "Script Type", definition: "The address format used in a transaction (P2PKH, P2SH, P2WPKH, P2TR). Mixing script types can fingerprint change outputs since the change usually matches the sender's address type." },
  { term: "Self-send (Self-transfer)", definition: "A transaction where one or more outputs return to an address that was also an input. This trivially identifies the change output, revealing the sender's remaining balance." },
  { term: "Stonewall", definition: "A steganographic transaction format from Samourai Wallet (now Ashigaru) that mimics a CoinJoin. Has 2-4 inputs and exactly 4 outputs: 2 equal-valued outputs and 2 change outputs. STONEWALLx2 involves two wallets, each contributing up to 2 inputs." },
  { term: "Sweep", definition: "A transaction that sends the entire balance of one or more addresses to a single output with no change. A single-input sweep has zero entropy." },
  { term: "Taproot", definition: "A Bitcoin upgrade (activated 2021) that makes complex transactions look like simple ones on-chain, improving privacy and efficiency." },
  { term: "Tor", definition: "An anonymity network that routes internet traffic through multiple relays. am-i.exposed auto-detects Tor Browser and routes API requests through the mempool.space .onion endpoint." },
  { term: "UTXO", definition: "Unspent Transaction Output. The fundamental unit of Bitcoin - each UTXO is a discrete chunk of bitcoin that can be spent as an input in a future transaction." },
  { term: "Wallet Fingerprint", definition: "Distinctive patterns left by wallet software - like transaction version, locktime, or signature encoding - that reveal which wallet created a transaction." },
  { term: "Whirlpool", definition: "A CoinJoin implementation by Samourai Wallet that creates transactions with exactly 5 equal outputs at fixed denominations, achieving high entropy." },
  { term: "WabiSabi", definition: "A CoinJoin protocol used by Wasabi Wallet that allows variable-amount outputs using cryptographic credentials, supporting 20+ participants per round." },
];

export const metadata: Metadata = {
  title: "Bitcoin Privacy Glossary - Key Terms Explained | am-i.exposed",
  description:
    "Bitcoin privacy glossary: CoinJoin, UTXO, chain analysis, dust attacks, Taproot, and more. Essential terms for understanding on-chain privacy.",
  keywords: [
    "bitcoin privacy glossary",
    "bitcoin terms explained",
    "CoinJoin definition",
    "UTXO meaning",
    "bitcoin chain analysis terms",
    "bitcoin dust attack definition",
    "Taproot privacy",
    "common input ownership heuristic",
  ],
  alternates: {
    canonical: "https://am-i.exposed/glossary/",
  },
  openGraph: {
    title: "Bitcoin Privacy Glossary | am-i.exposed",
    description:
      "Essential Bitcoin privacy terms explained: CoinJoin, chain analysis, dust attacks, Taproot, and more.",
    url: "https://am-i.exposed/glossary/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Privacy Glossary | am-i.exposed",
    description:
      "Essential Bitcoin privacy terms explained: CoinJoin, chain analysis, dust attacks, Taproot, and more.",
  },
};

export default function GlossaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: "https://am-i.exposed/",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Glossary",
                item: "https://am-i.exposed/glossary/",
              },
            ],
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "DefinedTermSet",
            name: "Bitcoin Privacy Glossary",
            description: "Essential Bitcoin privacy terms and concepts explained.",
            url: "https://am-i.exposed/glossary/",
            hasDefinedTerm: TERMS.map((t) => ({
              "@type": "DefinedTerm",
              name: t.term,
              description: t.definition,
            })),
          }),
        }}
      />
      {children}
    </>
  );
}
