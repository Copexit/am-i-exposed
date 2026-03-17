import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome - am-i.exposed | Bitcoin Privacy Scanner",
  description:
    "They score your wallet every day. You've never seen the results. A free, open-source Bitcoin privacy scanner that runs entirely in your browser.",
  keywords: [
    "bitcoin privacy",
    "bitcoin privacy scanner",
    "bitcoin chain analysis",
    "bitcoin surveillance",
    "OXT alternative",
    "KYCP alternative",
    "bitcoin transaction privacy",
  ],
  alternates: {
    canonical: "https://am-i.exposed/welcome/",
  },
  openGraph: {
    title: "Welcome - am-i.exposed | Bitcoin Privacy Scanner",
    description:
      "They score your wallet every day. You've never seen the results. A free, open-source Bitcoin privacy scanner.",
    url: "https://am-i.exposed/welcome/",
    type: "website",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Welcome - am-i.exposed | Bitcoin Privacy Scanner",
    description:
      "They score your wallet every day. You've never seen the results. A free, open-source Bitcoin privacy scanner.",
  },
};

export default function WelcomeLayout({
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
                name: "Welcome",
                item: "https://am-i.exposed/welcome/",
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
