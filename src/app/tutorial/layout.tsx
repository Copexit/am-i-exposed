import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";
import { VIDEOS_ENABLED } from "@/lib/media/videos-enabled";

const TITLE = "How to use am-i.exposed | Bitcoin Privacy Scanner Tutorial";
const DESC =
  "A 5-minute narrated walkthrough of am-i.exposed: scanning a transaction, reading the findings, a CoinJoin example, the analyst tools and checking an address.";

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
