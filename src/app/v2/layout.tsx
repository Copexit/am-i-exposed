import type { Metadata } from "next";
import { V2Header } from "@/components/v2/chrome/V2Header";
import { V2Footer } from "@/components/v2/chrome/V2Footer";
import { V2ThemeGuard } from "@/components/v2/chrome/V2ThemeGuard";
import { V2PrivacyNotice } from "@/components/v2/chrome/V2PrivacyNotice";

export const metadata: Metadata = {
  title: "am-i.exposed (beta) - Bitcoin Privacy Scanner",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://am-i.exposed/" },
};

/** v2 UI shell: own chrome and tokens, beside the classic UI during the beta. */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-ui="v2" className="flex-1 flex flex-col min-h-screen">
      <V2ThemeGuard />
      <V2Header />
      <div className="md:hidden"><V2PrivacyNotice inFlow /></div>
      <div className="flex-1 flex flex-col">{children}</div>
      <V2Footer />
    </div>
  );
}
