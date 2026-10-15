import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";
import { VIDEOS_ENABLED } from "@/lib/media/videos-enabled";

const TITLE = "How to use am-i.exposed | Bitcoin Privacy Scanner Tutorial";
const DESC =
  "Narrated walkthroughs of am-i.exposed: scanning a transaction, reading the findings, a CoinJoin example and checking an address, plus an in-depth guide to the transaction graph.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  robots: { index: VIDEOS_ENABLED, follow: true },
  alternates: { canonical: "https://am-i.exposed/tutorial/" },
  openGraph: {
    title: TITLE,
    description: DESC,
    url: "https://am-i.exposed/tutorial/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function TutorialLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd name="Tutorial" path="/tutorial/" />
      {children}
    </>
  );
}
