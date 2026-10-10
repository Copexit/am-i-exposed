import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bitcoin Privacy Guide: On-Chain Privacy | am-i.exposed",
  description:
    "Practical Bitcoin privacy: avoid address reuse, hide change, use CoinJoin, and understand what chain analysis can infer about your transactions.",
  keywords: [
    "bitcoin privacy guide",
    "how to make bitcoin private",
    "bitcoin address reuse",
    "bitcoin coinjoin",
    "bitcoin change output privacy",
  ],
  alternates: {
    canonical: "https://am-i.exposed/guide/",
  },
  openGraph: {
    title: "Bitcoin Privacy Guide | am-i.exposed",
    description:
      "Practical Bitcoin privacy: avoid address reuse, hide change, use CoinJoin, and understand what chain analysis can infer about your transactions.",
    url: "https://am-i.exposed/guide/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Privacy Guide | am-i.exposed",
    description:
      "Practical Bitcoin privacy: avoid address reuse, hide change, use CoinJoin, and understand what chain analysis can infer about your transactions.",
  },
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
