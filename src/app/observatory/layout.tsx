import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "CoinJoin Observatory: live WabiSabi map and coordinators | am-i.exposed",
  description:
    "A live map of Bitcoin CoinJoins across the public WabiSabi coordinators: volume, live rounds, coordinator history and remix flows, sourced from Wabisator. Ashigaru Whirlpool pools from whirlpoolstats.xyz.",
  keywords: [
    "whirlpool stats",
    "wabisabi coordinator status",
    "bitcoin coinjoin volume",
    "ashigaru pool size",
    "kruw coordinator",
    "wabisator",
    "coinjoin map",
  ],
  alternates: {
    canonical: "https://am-i.exposed/observatory/",
  },
  openGraph: {
    title: "CoinJoin Observatory | am-i.exposed",
    description:
      "A live map of WabiSabi CoinJoins and coordinators (Wabisator), plus Whirlpool pools (whirlpoolstats.xyz).",
    url: "https://am-i.exposed/observatory/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinJoin Observatory | am-i.exposed",
    description:
      "A live map of WabiSabi CoinJoins and coordinators (Wabisator), plus Whirlpool pools (whirlpoolstats.xyz).",
  },
};

export default function ObservatoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd name="CoinJoin Observatory" path="/observatory/" />
      {children}
    </>
  );
}
