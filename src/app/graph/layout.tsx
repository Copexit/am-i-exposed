import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Graph Explorer - Trace Bitcoin Transaction Flows | am-i.exposed",
  description:
    "Explore a Bitcoin transaction graph hop by hop, with change, entity and privacy annotations. Runs entirely in your browser.",
  keywords: [
    "bitcoin transaction graph",
    "bitcoin graph explorer",
    "trace bitcoin transaction",
    "OXT alternative",
    "bitcoin chain analysis",
  ],
  alternates: {
    canonical: "https://am-i.exposed/graph/",
  },
  openGraph: {
    title: "Graph Explorer | am-i.exposed",
    description:
      "Explore a Bitcoin transaction graph hop by hop, with change, entity and privacy annotations. Runs entirely in your browser.",
    url: "https://am-i.exposed/graph/",
    type: "website",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Graph Explorer | am-i.exposed",
    description:
      "Explore a Bitcoin transaction graph hop by hop, with change, entity and privacy annotations. Runs entirely in your browser.",
  },
};

export default function GraphLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd name="Graph Explorer" path="/graph/" />
      {children}
    </>
  );
}
