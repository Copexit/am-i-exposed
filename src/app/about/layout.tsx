import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";

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
  },
  openGraph: {
    title: "About - Why am-i.exposed Exists | Bitcoin Privacy Scanner",
    description:
      "When OXT.me and KYCP.org went offline, the Bitcoin community lost its privacy analysis tools. am-i.exposed fills that gap.",
    url: "https://am-i.exposed/about/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
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
      <BreadcrumbJsonLd name="About" path="/about/" />
      {children}
    </>
  );
}
