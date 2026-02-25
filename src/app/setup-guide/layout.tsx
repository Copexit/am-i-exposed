import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect Your Node - Setup Guide | am-i.exposed",
  description:
    "Point am-i.exposed at your own mempool instance for maximum privacy. Step-by-step guides for Umbrel, Start9, Docker, bare metal, SSH tunnels, and Tor.",
  keywords: [
    "mempool self-host guide",
    "bitcoin node privacy setup",
    "umbrel mempool CORS",
    "start9 mempool setup",
    "bitcoin privacy self-hosted",
    "mempool SSH tunnel",
    "bitcoin node CORS configuration",
  ],
  alternates: {
    canonical: "https://am-i.exposed/setup-guide/",
    languages: {
      en: "https://am-i.exposed/setup-guide/",
      es: "https://am-i.exposed/setup-guide/",
      de: "https://am-i.exposed/setup-guide/",
      fr: "https://am-i.exposed/setup-guide/",
      pt: "https://am-i.exposed/setup-guide/",
      "x-default": "https://am-i.exposed/setup-guide/",
    },
  },
  openGraph: {
    title: "Connect Your Node - Setup Guide | am-i.exposed",
    description:
      "Point am-i.exposed at your own mempool instance. Guides for Umbrel, Start9, Docker, and Tor.",
    url: "https://am-i.exposed/setup-guide/",
    type: "article",
  },
  twitter: {
    title: "Connect Your Node - Setup Guide | am-i.exposed",
    description:
      "Point am-i.exposed at your own mempool instance. Guides for Umbrel, Start9, Docker, and Tor.",
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
            name: "Connect am-i.exposed to Your Own Bitcoin Node",
            description:
              "Point am-i.exposed at your own mempool instance for maximum privacy using SSH tunnels and CORS configuration.",
            step: [
              {
                "@type": "HowToStep",
                position: 1,
                name: "Add CORS Headers",
                text: "Edit your mempool nginx configuration to add Access-Control-Allow-Origin headers inside the location /api/ block, then reload nginx.",
              },
              {
                "@type": "HowToStep",
                position: 2,
                name: "Create SSH Tunnel",
                text: "Run an SSH tunnel command to forward your node's mempool port to localhost, e.g. ssh -L 3006:localhost:3006 user@your-node-ip.",
              },
              {
                "@type": "HowToStep",
                position: 3,
                name: "Configure am-i.exposed",
                text: "Click the gear icon in the am-i.exposed header and enter http://localhost:3006/api as your custom API endpoint. Click Apply and verify the green Connected status.",
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
