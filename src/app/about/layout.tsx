import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About - Why am-i.exposed Exists | Bitcoin Privacy Scanner",
  description:
    "When OXT.me and KYCP.org went offline, the Bitcoin community lost its privacy analysis tools. am-i.exposed fills that gap - free, open-source, client-side.",
  keywords: [
    "OXT alternative",
    "KYCP alternative",
    "bitcoin privacy tool",
    "open source bitcoin analysis",
    "bitcoin privacy scanner history",
  ],
  alternates: {
    canonical: "https://am-i.exposed/about/",
    languages: {
      en: "https://am-i.exposed/about/",
      es: "https://am-i.exposed/about/",
      de: "https://am-i.exposed/about/",
      fr: "https://am-i.exposed/about/",
      pt: "https://am-i.exposed/about/",
      "x-default": "https://am-i.exposed/about/",
    },
  },
  openGraph: {
    title: "About - Why am-i.exposed Exists | Bitcoin Privacy Scanner",
    description:
      "When OXT.me and KYCP.org went offline, the Bitcoin community lost its privacy analysis tools. am-i.exposed fills that gap.",
    url: "https://am-i.exposed/about/",
    type: "article",
  },
  twitter: {
    title: "About - Why am-i.exposed Exists | Bitcoin Privacy Scanner",
    description:
      "When OXT.me and KYCP.org went offline, the Bitcoin community lost its privacy analysis tools. am-i.exposed fills that gap.",
  },
};

export default function AboutLayout({
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
                name: "About",
                item: "https://am-i.exposed/about/",
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
