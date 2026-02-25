import type { Metadata } from "next";

const TERMS = [
  { term: "Address Reuse", definition: "Using the same Bitcoin address for multiple transactions. Creates deterministic links between all transactions involving that address, severely degrading privacy." },
  { term: "Boltzmann Entropy", definition: "A measure of the number of possible interpretations of a Bitcoin transaction's inputs and outputs. Higher entropy means more ambiguity and better privacy." },
  { term: "Chain Analysis", definition: "The practice of tracing Bitcoin fund flows by applying heuristics to the public blockchain. Used by surveillance firms like Chainalysis and Elliptic." },
  { term: "Change Output", definition: "The output in a Bitcoin transaction that returns unspent funds to the sender. Identifying change outputs links the sender to future transactions." },
  { term: "CoinJoin", definition: "A technique where multiple users combine their transactions into one, breaking the common-input-ownership assumption. Implementations include Whirlpool and WabiSabi." },
  { term: "Common Input Ownership Heuristic (CIOH)", definition: "The assumption that all inputs in a transaction belong to the same entity. The foundational clustering heuristic used by chain surveillance firms." },
  { term: "Dust Attack", definition: "Sending tiny amounts of Bitcoin (dust) to target addresses. If the recipient spends the dust alongside other UTXOs, the attacker can link those addresses." },
  { term: "HD Wallet", definition: "A Hierarchical Deterministic wallet that generates a new address for each transaction from a single seed, avoiding address reuse." },
  { term: "Heuristic", definition: "A rule-of-thumb used to infer information about a Bitcoin transaction. am-i.exposed applies 16 heuristics to estimate what surveillance firms can deduce." },
  { term: "Mempool", definition: "The set of unconfirmed Bitcoin transactions waiting to be included in a block. am-i.exposed fetches blockchain data from mempool.space." },
  { term: "OP_RETURN", definition: "A Bitcoin script opcode that embeds arbitrary data in the blockchain. Can leak metadata like timestamps or protocol identifiers." },
  { term: "Privacy Score", definition: "A 0-100 rating computed by am-i.exposed based on 16 heuristics. Higher scores indicate better privacy. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24)." },
  { term: "Taproot", definition: "A Bitcoin upgrade (activated 2021) that makes complex transactions look like simple ones on-chain, improving privacy and efficiency." },
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
    languages: {
      en: "https://am-i.exposed/glossary/",
      es: "https://am-i.exposed/glossary/",
      de: "https://am-i.exposed/glossary/",
      fr: "https://am-i.exposed/glossary/",
      pt: "https://am-i.exposed/glossary/",
      "x-default": "https://am-i.exposed/glossary/",
    },
  },
  openGraph: {
    title: "Bitcoin Privacy Glossary | am-i.exposed",
    description:
      "Essential Bitcoin privacy terms explained: CoinJoin, chain analysis, dust attacks, Taproot, and more.",
    url: "https://am-i.exposed/glossary/",
    type: "article",
  },
  twitter: {
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
