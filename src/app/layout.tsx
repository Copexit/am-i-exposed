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
    "Paste a Bitcoin address or transaction ID. Get a privacy score 0-100 with actionable findings. 100% client-side. No tracking.",
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
