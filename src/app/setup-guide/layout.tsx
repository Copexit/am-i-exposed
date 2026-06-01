import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect Your Node - Setup Guide | am-i.exposed",
  description:
    "Run am-i.exposed on your own Bitcoin node. One-click install from the official Umbrel and StartOS app stores, plus advanced manual setup for Docker, bare metal, and custom mempool instances.",
  keywords: [
    "am-i.exposed umbrel app",
    "am-i.exposed startos app",
    "mempool self-host guide",
    "bitcoin node privacy setup",
    "umbrel app store bitcoin privacy",
    "start9 mempool setup",
    "bitcoin privacy self-hosted",
    "mempool SSH tunnel",
    "bitcoin node CORS configuration",
  ],
  alternates: {
    canonical: "https://am-i.exposed/setup-guide/",
  },
  openGraph: {
    title: "Connect Your Node - Setup Guide | am-i.exposed",
    description:
      "Run am-i.exposed on your own node - one-click install on Umbrel and StartOS, or advanced manual setup for Docker and bare metal.",
    url: "https://am-i.exposed/setup-guide/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Connect Your Node - Setup Guide | am-i.exposed",
    description:
      "Run am-i.exposed on your own node - one-click install on Umbrel and StartOS, or advanced manual setup for Docker and bare metal.",
  },
};

export default function SetupGuideLayout({
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
                name: "Setup Guide",
                item: "https://am-i.exposed/setup-guide/",
              },
            ],
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "Install am-i.exposed on Your Own Bitcoin Node",
            description:
              "Run am-i.exposed natively on your own node with a one-click install from the official Umbrel or StartOS app store.",
            step: [
              {
                "@type": "HowToStep",
                position: 1,
                name: "Open your app store",
                text: "Open the App Store on your Umbrel dashboard, or the Marketplace on your StartOS dashboard.",
              },
              {
                "@type": "HowToStep",
                position: 2,
                name: "Install am-i.exposed",
                text: "Search for am-i.exposed and click Install. It is published in the official Umbrel and Start9 app stores.",
              },
              {
                "@type": "HowToStep",
                position: 3,
                name: "Open the app",
                text: "Open am-i.exposed from your dashboard. It detects your local mempool automatically - no CORS headers, SSH tunnel, or configuration needed.",
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
