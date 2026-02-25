import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology - How Bitcoin Privacy is Scored | am-i.exposed",
  description:
    "16 heuristics, scoring model, and threat model behind am-i.exposed. Learn how chain surveillance firms analyze Bitcoin transactions and how your privacy score is calculated.",
  keywords: [
    "bitcoin privacy methodology",
    "bitcoin chain analysis heuristics",
    "bitcoin privacy scoring",
    "CIOH bitcoin",
    "CoinJoin detection",
    "bitcoin address reuse analysis",
    "bitcoin wallet fingerprinting",
    "bitcoin transaction privacy scoring",
  ],
  alternates: {
    canonical: "https://am-i.exposed/methodology/",
    languages: {
      en: "https://am-i.exposed/methodology/",
      es: "https://am-i.exposed/methodology/",
      de: "https://am-i.exposed/methodology/",
      fr: "https://am-i.exposed/methodology/",
      pt: "https://am-i.exposed/methodology/",
      "x-default": "https://am-i.exposed/methodology/",
    },
  },
  openGraph: {
    title: "Methodology - How Bitcoin Privacy is Scored | am-i.exposed",
    description:
      "16 heuristics that evaluate your Bitcoin transaction privacy. The same techniques chain surveillance firms use - documented and explained.",
    url: "https://am-i.exposed/methodology/",
    type: "article",
  },
  twitter: {
    title: "Methodology - How Bitcoin Privacy is Scored | am-i.exposed",
    description:
      "16 heuristics that evaluate your Bitcoin transaction privacy. Every penalty explained.",
  },
};

export default function MethodologyLayout({
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
                name: "Methodology",
                item: "https://am-i.exposed/methodology/",
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
            mainEntity: [
              {
                "@type": "Question",
                name: "How is Bitcoin privacy scored?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Every analysis starts from a base score of 70. Heuristic impacts are summed and the result is clamped to 0-100. Grades: A+ (90-100), B (75-89), C (50-74), D (25-49), F (0-24). CoinJoin transactions can earn bonuses up to +30, while address reuse carries penalties up to -70.",
                },
              },
              {
                "@type": "Question",
                name: "What is the Common Input Ownership Heuristic (CIOH)?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "If a Bitcoin transaction spends multiple inputs, all inputs are assumed to belong to the same entity. This is the foundational clustering heuristic used by chain surveillance firms like Chainalysis and Elliptic to link addresses together.",
                },
              },
              {
                "@type": "Question",
                name: "Does CoinJoin improve Bitcoin privacy?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. CoinJoin is the primary technique that increases privacy scores (+15 to +30). Whirlpool and WabiSabi CoinJoin transactions break the common-input-ownership heuristic by combining inputs from multiple independent participants, making it impossible to determine fund flow.",
                },
              },
              {
                "@type": "Question",
                name: "Why is address reuse bad for Bitcoin privacy?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Address reuse creates deterministic, irrefutable links between all transactions using that address. It carries the harshest penalty in privacy scoring (-24 to -70), scaling with the number of times the address has been reused. Most modern wallets generate a new address for each receive to avoid this.",
                },
              },
              {
                "@type": "Question",
                name: "What Bitcoin privacy heuristics does am-i.exposed check?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "am-i.exposed checks 16 heuristics across two categories: 12 transaction-level (round amounts, change detection, CIOH, CoinJoin, entropy, fee analysis, OP_RETURN, address reuse, script types, wallet fingerprinting, timing, dust outputs) and 4 address-level (address reuse frequency, UTXO analysis, spending patterns, anonymity set).",
                },
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
