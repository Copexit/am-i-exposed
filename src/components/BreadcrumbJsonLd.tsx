const ORIGIN = "https://am-i.exposed";

/** Home > page BreadcrumbList JSON-LD. Server-safe (no hooks), rendered by route layouts. */
export function BreadcrumbJsonLd({ name, path }: { name: string; path: string }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
            { "@type": "ListItem", position: 2, name, item: `${ORIGIN}${path}` },
          ],
        }),
      }}
    />
  );
}
