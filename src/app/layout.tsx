import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NetworkProvider } from "@/context/NetworkContext";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { LangAttributeSync } from "@/lib/i18n/LangAttributeSync";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { AmbientBackground } from "@/components/AmbientBackground";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://am-i.exposed"),
  title: "am-i.exposed - Bitcoin Privacy Scanner",
  description:
    "Is your Bitcoin traceable? Paste an address or txid - get a privacy score with 16 chain analysis heuristics. Free, client-side, no tracking.",
  keywords: [
    "bitcoin transaction privacy",
    "check bitcoin privacy",
    "bitcoin address reuse",
    "bitcoin privacy score",
    "bitcoin privacy checker",
    "is my bitcoin transaction traceable",
    "bitcoin chain analysis",
    "bitcoin privacy tool",
  ],
  alternates: {
    canonical: "https://am-i.exposed/",
    languages: {
      en: "https://am-i.exposed/",
      es: "https://am-i.exposed/",
      de: "https://am-i.exposed/",
      fr: "https://am-i.exposed/",
      pt: "https://am-i.exposed/",
      "x-default": "https://am-i.exposed/",
    },
  },
  openGraph: {
    title: "am-i.exposed - Bitcoin Privacy Scanner",
    description:
      "Find out what the blockchain knows about you. Free, client-side Bitcoin privacy analysis.",
    url: "https://am-i.exposed/",
    siteName: "am-i.exposed",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "am-i.exposed - Bitcoin Privacy Scanner",
    description:
      "The Bitcoin privacy scanner you were afraid to run. Paste a Bitcoin address or txid. Get a score.",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  applicationName: "am-i.exposed",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*; img-src 'self' data:; worker-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "am-i.exposed",
              url: "https://am-i.exposed/",
              description:
                "Free, client-side Bitcoin privacy analyzer. Get a privacy score and actionable findings for any address or transaction.",
              applicationCategory: "FinanceApplication",
              operatingSystem: "Any",
              browserRequirements: "Requires a modern web browser",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              author: {
                "@type": "Organization",
                name: "Copexit",
                url: "https://github.com/Copexit",
              },
              datePublished: "2025-04-01",
              screenshot: "https://am-i.exposed/opengraph-image",
              featureList: [
                "16 Bitcoin privacy heuristics",
                "Transaction and address analysis",
                "CoinJoin detection (Whirlpool, WabiSabi, JoinMarket)",
                "Boltzmann entropy estimation",
                "Wallet fingerprinting",
                "100% client-side analysis",
                "No tracking or data collection",
                "PWA - works offline",
                "5 languages supported",
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
                  name: "Is my Bitcoin transaction traceable?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Most Bitcoin transactions are partially traceable. Chain analysis firms use heuristics like common-input-ownership, change detection, and address reuse to trace fund flows. am-i.exposed runs 16 of these heuristics client-side to show you exactly what surveillance firms can infer about your transactions.",
                  },
                },
                {
                  "@type": "Question",
                  name: "How can I check my Bitcoin privacy?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Paste your Bitcoin address or transaction ID into am-i.exposed. The tool analyzes it using 16 heuristics - the same techniques chain analysis firms use - and gives you a privacy score from 0 to 100 with a letter grade (A+ to F) and specific actionable findings. Everything runs in your browser with no tracking.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What happened to OXT.me and KYCP.org?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "OXT.me and KYCP.org went offline in April 2024 following the arrest of the Samourai Wallet developers. OXT was the gold standard for Boltzmann entropy analysis. KYCP made CoinJoin privacy assessment accessible to ordinary users. am-i.exposed was created to fill the gap left by these tools.",
                  },
                },
                {
                  "@type": "Question",
                  name: "Is am-i.exposed safe to use?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "All analysis runs client-side in your browser. There is no server, no accounts, no cookies, and no tracking. However, your browser makes API requests to mempool.space to fetch blockchain data, which means their servers can see your IP and queries. For maximum privacy, use Tor Browser or connect your own node.",
                  },
                },
              ],
            }),
          }}
        />
        <AmbientBackground />
        <I18nProvider>
          <LangAttributeSync />
          <NetworkProvider>
            <Header />
            <main className="flex-1 flex flex-col pt-[72px] sm:pt-[80px]">
              <PrivacyNotice />
              {children}
            </main>
            <Footer />
          </NetworkProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
