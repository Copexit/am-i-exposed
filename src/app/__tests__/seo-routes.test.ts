import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import type { Metadata } from "next";
import { ORIGIN, SEO_ROUTES, routeJsonLd, type SeoRouteKey } from "../seo-routes";
import { metadata as observatoryHub } from "@/app/observatory/layout";
import { metadata as guideHub } from "@/app/guide/layout";
import { metadata as wabisabi } from "@/app/observatory/wabisabi/layout";
import { metadata as whirlpool } from "@/app/observatory/whirlpool/layout";
import { metadata as p2p } from "@/app/observatory/p2p/layout";
import { metadata as labeling } from "@/app/guide/labeling/layout";
import { metadata as spending } from "@/app/guide/spending/layout";

const LAYOUTS: Record<SeoRouteKey, Metadata> = { wabisabi, whirlpool, p2p, labeling, spending };
const ALL: Metadata[] = [observatoryHub, guideHub, ...Object.values(LAYOUTS)];
const keys = Object.keys(SEO_ROUTES) as SeoRouteKey[];

describe("SEO routes", () => {
  it("every page has a unique title under 60 chars and description under 155", () => {
    for (const m of ALL) {
      expect(String(m.title).length, String(m.title)).toBeLessThanOrEqual(60);
      expect(String(m.description).length, String(m.title)).toBeLessThanOrEqual(155);
      expect(String(m.title) + String(m.description)).not.toMatch(/—|\b(we|us|our)\b|proprietary/i);
    }
    expect(new Set(ALL.map((m) => m.title)).size).toBe(ALL.length);
    expect(new Set(ALL.map((m) => m.description)).size).toBe(ALL.length);
  });

  it("each route layout ships its own canonical, Open Graph and Twitter tags", () => {
    for (const k of keys) {
      const m = LAYOUTS[k];
      const url = `${ORIGIN}${SEO_ROUTES[k].path}`;
      expect(m.alternates?.canonical).toBe(url);
      expect(m.openGraph?.url).toBe(url);
      expect(m.openGraph?.title).toBe(m.title);
      expect(m.twitter).toMatchObject({ card: "summary_large_image", title: m.title });
    }
  });

  it("each route has its page, OG and Twitter image files", () => {
    for (const k of keys) {
      const dir = join(process.cwd(), "src/app", SEO_ROUTES[k].path);
      for (const f of ["page.tsx", "layout.tsx", "opengraph-image.tsx", "twitter-image.tsx"]) expect(existsSync(join(dir, f)), `${dir}${f}`).toBe(true);
    }
  });

  it("JSON-LD: Home > section > page breadcrumbs plus the page node", () => {
    const ld = routeJsonLd("p2p") as { "@graph": [{ itemListElement: { item: string }[] }, { "@type": string; url: string }] };
    expect(ld["@graph"][0].itemListElement.map((i) => i.item)).toEqual([`${ORIGIN}/`, `${ORIGIN}/observatory/`, `${ORIGIN}/observatory/p2p/`]);
    expect(ld["@graph"][1]).toMatchObject({ "@type": "WebPage", url: `${ORIGIN}/observatory/p2p/` });
    expect((routeJsonLd("labeling") as { "@graph": [unknown, { "@type": string }] })["@graph"][1]["@type"]).toBe("TechArticle");
  });

  it("the sitemap lists every route with a lastmod", () => {
    const xml = readFileSync(join(process.cwd(), "public/sitemap.xml"), "utf8");
    for (const path of ["/observatory/", "/guide/", ...keys.map((k) => SEO_ROUTES[k].path)]) {
      expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}${path}</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
    }
  });
});
