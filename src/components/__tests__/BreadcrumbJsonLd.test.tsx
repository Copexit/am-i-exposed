import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BreadcrumbJsonLd } from "../BreadcrumbJsonLd";

describe("BreadcrumbJsonLd", () => {
  it("emits the same JSON-LD the layouts used to inline", () => {
    const html = renderToStaticMarkup(<BreadcrumbJsonLd name="FAQ" path="/faq/" />);
    const expected = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://am-i.exposed/" },
        { "@type": "ListItem", position: 2, name: "FAQ", item: "https://am-i.exposed/faq/" },
      ],
    });
    expect(html).toBe(`<script type="application/ld+json">${expected}</script>`);
  });
});
