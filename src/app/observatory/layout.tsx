import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CoinJoin Observatory - Live Whirlpool & WabiSabi stats | am-i.exposed",
  description:
    "Live Bitcoin CoinJoin activity for Ashigaru Whirlpool pools and WabiSabi coordinators. Sourced from whirlpool.observer and liquisabi.com.",
  keywords: [
    "whirlpool stats",
    "wabisabi coordinator status",
    "bitcoin coinjoin volume",
    "ashigaru pool size",
    "kruw coordinator",
    "liquisabi",
  ],
  alternates: {
    canonical: "https://am-i.exposed/observatory/",
  },
  openGraph: {
    title: "CoinJoin Observatory | am-i.exposed",
    description:
      "Live Whirlpool and WabiSabi stats, sourced from whirlpool.observer and liquisabi.com.",
    url: "https://am-i.exposed/observatory/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinJoin Observatory | am-i.exposed",
    description:
      "Live Whirlpool and WabiSabi stats, sourced from whirlpool.observer and liquisabi.com.",
  },
};

export default function ObservatoryLayout({
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
                name: "CoinJoin Observatory",
                item: "https://am-i.exposed/observatory/",
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
