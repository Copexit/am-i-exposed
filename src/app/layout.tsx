import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NetworkProvider } from "@/context/NetworkContext";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { LangAttributeSync } from "@/lib/i18n/LangAttributeSync";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { COLORS, LIGHT_COLORS } from "@/lib/palette";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { MempoolDownDialog } from "@/components/MempoolDownDialog";
import { AmbientBackground } from "@/components/AmbientBackground";
import { ClassicOnly, AppMain } from "@/components/ClassicChrome";
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
    "Is your Bitcoin traceable? Paste an address or txid - get a privacy score with 33 chain analysis heuristics. Free, client-side, no tracking.",
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
  },
  openGraph: {
    title: "am-i.exposed - Bitcoin Privacy Scanner",
    description:
      "Is your Bitcoin traceable? Paste an address or txid - get a privacy score with 33 chain analysis heuristics. Free, client-side, no tracking.",
    url: "https://am-i.exposed/",
    siteName: "am-i.exposed",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "am-i.exposed - Bitcoin Privacy Scanner",
    description:
      "Is your Bitcoin traceable? Paste an address or txid - get a privacy score with 33 chain analysis heuristics. Free, client-side, no tracking.",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https: http://*.onion http://localhost:* http://127.0.0.1:* http://*.local:*; img-src 'self' data:; worker-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <meta name="theme-color" content={COLORS.background} id="meta-theme-color" />
        {/* Pre-paint theme (mirrors useTheme): stored "light"/"dark", else the OS preference. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=localStorage.getItem("ami-theme");if(s==="light"||(s!=="dark"&&typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: light)").matches)){document.documentElement.dataset.theme="light";var m=document.getElementById("meta-theme-color");if(m)m.content="${LIGHT_COLORS.background}"}}catch(e){}})()` }} />
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
              dateModified: "2026-03-07",
              screenshot: "https://am-i.exposed/opengraph-image",
              featureList: [
                "33 Bitcoin privacy heuristics",
                "Transaction and address analysis",
                "CoinJoin detection (Whirlpool, WabiSabi, JoinMarket)",
                "Boltzmann entropy estimation",
                "Wallet fingerprinting",
                "100% client-side analysis",
                "No tracking or data collection",
                "PWA - works offline",
                "6 languages supported",
              ],
            }),
          }}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-bitcoin focus:text-background focus:rounded-lg focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <ClassicOnly><AmbientBackground /></ClassicOnly>
        <I18nProvider>
          <LangAttributeSync />
          <NetworkProvider>
            <ClassicOnly><Header /></ClassicOnly>
            <AppMain>
              <ClassicOnly><PrivacyNotice /></ClassicOnly>
              {children}
            </AppMain>
            <ClassicOnly><Footer /></ClassicOnly>
            <MempoolDownDialog />
          </NetworkProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
