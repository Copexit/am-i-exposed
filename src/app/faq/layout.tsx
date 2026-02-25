import type { Metadata } from "next";

const FAQ_ITEMS = [
  {
    q: "Is my Bitcoin transaction traceable?",
    a: "Most Bitcoin transactions are partially traceable. Chain analysis firms use heuristics like common-input-ownership, change detection, and address reuse to trace fund flows. am-i.exposed runs 16 of these heuristics client-side to show you exactly what surveillance firms can infer about your transactions.",
  },
  {
    q: "Can Bitcoin be traced back to me?",
    a: "Bitcoin is pseudonymous, not anonymous. If any address you control has ever been linked to your identity - through an exchange, a merchant, or public posting - chain analysis can follow the trail to your other addresses. The more you reuse addresses and make round-amount payments, the easier it is.",
  },
  {
    q: "How can I check my Bitcoin privacy?",
    a: "Paste your Bitcoin address or transaction ID into am-i.exposed. The tool analyzes it using 16 heuristics - the same techniques chain analysis firms use - and gives you a privacy score from 0 to 100 with a letter grade (A+ to F) and specific actionable findings. Everything runs in your browser with no tracking.",
  },
  {
    q: "Is am-i.exposed safe to use?",
    a: "All analysis runs client-side in your browser. There is no server, no accounts, no cookies, and no tracking. However, your browser makes API requests to mempool.space to fetch blockchain data, which means their servers can see your IP and queries. For maximum privacy, use Tor Browser or connect your own node.",
  },
  {
    q: "What happened to OXT.me and KYCP.org?",
    a: "OXT.me and KYCP.org went offline in April 2024 following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. am-i.exposed was created to fill the gap left by these tools.",
  },
  {
    q: "Does CoinJoin improve Bitcoin privacy?",
    a: "Yes. CoinJoin is the most effective technique for improving on-chain privacy. It breaks the common-input-ownership heuristic by combining inputs from multiple independent participants. Whirlpool and WabiSabi CoinJoin transactions regularly score A+ on am-i.exposed.",
  },
  {
    q: "What is a Bitcoin dust attack?",
    a: "A dust attack sends tiny amounts of Bitcoin (dust) to your addresses. If you later spend that dust alongside your other UTXOs, you link those addresses together - giving the attacker a map of your wallet. am-i.exposed detects dust outputs and warns you not to spend them.",
  },
  {
    q: "Why is address reuse bad for Bitcoin privacy?",
    a: "Address reuse creates deterministic, irrefutable links between all transactions using that address. It carries the harshest penalty in privacy scoring. Most modern wallets generate a new address for each receive to avoid this. If you are reusing addresses, switch to a wallet that supports HD key derivation.",
  },
  {
    q: "How does Bitcoin privacy scoring work?",
    a: "Every analysis starts from a base score of 70. Each of the 16 heuristics applies a positive or negative modifier based on what it detects. The sum is clamped to 0-100. Only CoinJoin participation, Taproot usage, and high entropy can raise the score. Everything else can only lower it. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24).",
  },
  {
    q: "Can I use am-i.exposed with Tor?",
    a: "Yes. When you use Tor Browser, am-i.exposed auto-detects it and routes API requests through the mempool.space .onion endpoint. This hides which addresses you are querying from mempool.space. For even stronger privacy, connect your own mempool instance via the Setup Guide.",
  },
  {
    q: "What is the Common Input Ownership Heuristic?",
    a: "If a Bitcoin transaction spends multiple inputs, all inputs are assumed to belong to the same entity. This is the foundational clustering heuristic used by chain surveillance firms like Chainalysis and Elliptic to link addresses together. CoinJoin is the primary way to break this assumption.",
  },
  {
    q: "Does am-i.exposed store my data?",
    a: "No. There is no server, no database, and no analytics. The static site is served from GitHub Pages. Your addresses and transactions are never logged, stored, or transmitted to anyone. The only external requests go to mempool.space for blockchain data (or your own instance if configured).",
  },
];

export const metadata: Metadata = {
  title: "FAQ - Bitcoin Privacy Questions Answered | am-i.exposed",
  description:
    "Answers to common Bitcoin privacy questions. Is Bitcoin traceable? What is CoinJoin? How does privacy scoring work? What happened to OXT and KYCP?",
  keywords: [
    "bitcoin privacy FAQ",
    "is bitcoin traceable",
    "bitcoin CoinJoin explained",
    "bitcoin dust attack",
    "bitcoin address reuse",
    "OXT alternative",
    "KYCP alternative",
    "bitcoin chain analysis",
  ],
  alternates: {
    canonical: "https://am-i.exposed/faq/",
    languages: {
      en: "https://am-i.exposed/faq/",
      es: "https://am-i.exposed/faq/",
      de: "https://am-i.exposed/faq/",
      fr: "https://am-i.exposed/faq/",
      pt: "https://am-i.exposed/faq/",
      "x-default": "https://am-i.exposed/faq/",
    },
  },
  openGraph: {
    title: "FAQ - Bitcoin Privacy Questions Answered | am-i.exposed",
    description:
      "Answers to common Bitcoin privacy questions. Is Bitcoin traceable? What is CoinJoin? How does privacy scoring work?",
    url: "https://am-i.exposed/faq/",
    type: "article",
  },
  twitter: {
    title: "FAQ - Bitcoin Privacy Questions Answered | am-i.exposed",
    description:
      "Answers to common Bitcoin privacy questions. Is Bitcoin traceable? What is CoinJoin? How does privacy scoring work?",
  },
};

export default function FaqLayout({
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
                name: "FAQ",
                item: "https://am-i.exposed/faq/",
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
            "@type": "FAQPage",
            mainEntity: FAQ_ITEMS.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: item.a,
              },
            })),
          }),
        }}
      />
      {children}
    </>
  );
}
