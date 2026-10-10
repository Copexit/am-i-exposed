import type { Metadata } from "next";

export const ORIGIN = "https://am-i.exposed";

export interface SeoRoute {
  path: string;
  /** <title>, under ~60 chars */
  title: string;
  /** meta description, under ~155 chars */
  description: string;
  /** Breadcrumb and OG card name */
  name: string;
  /** OG card subtitle */
  tagline: string;
  /** schema.org type for the page node next to the BreadcrumbList */
  schema: "WebPage" | "TechArticle";
  parent?: { name: string; path: string };
  keywords: string[];
}

const OBSERVATORY = { name: "CoinJoin Observatory", path: "/observatory/" };
const GUIDE = { name: "Privacy Guide", path: "/guide/" };

/** Routes split out of the Observatory tabs and the guide anchors, so each one is indexable on its own. */
export const SEO_ROUTES = {
  wabisabi: {
    path: "/observatory/wabisabi/",
    title: "Live CoinJoin Map: WabiSabi Coordinators | am-i.exposed",
    description: "Live CoinJoin map of the public WabiSabi coordinators: rounds, volume, fees and history of Wasabi Wallet CoinJoins, sourced from Wabisator.",
    name: "WabiSabi CoinJoin map",
    tagline: "Live WabiSabi rounds, volume and coordinators.",
    schema: "WebPage",
    parent: OBSERVATORY,
    keywords: ["live coinjoin map", "wabisabi coordinators", "wasabi wallet coinjoin", "wabisator", "kruw coordinator", "bitcoin coinjoin volume"],
  },
  whirlpool: {
    path: "/observatory/whirlpool/",
    title: "Whirlpool CoinJoin Pools: Live Ashigaru Stats | am-i.exposed",
    description: "Live Whirlpool pool stats for Ashigaru: lifetime volume, unspent capacity, recent mixing cycles and 30-day trends, sourced from whirlpoolstats.xyz.",
    name: "Whirlpool pools",
    tagline: "Live Ashigaru Whirlpool pools and mixing cycles.",
    schema: "WebPage",
    parent: OBSERVATORY,
    keywords: ["whirlpool stats", "ashigaru pool size", "whirlpool coinjoin", "samourai whirlpool pools", "whirlpoolstats"],
  },
  p2p: {
    path: "/observatory/p2p/",
    title: "KYC-free Bitcoin P2P Offers | am-i.exposed",
    description: "Live KYC-free bitcoin P2P offers and premiums from RoboSats, Mostro and HodlHodl, by currency and payment method. Fetched via a relay, never your browser.",
    name: "KYC-free P2P markets",
    tagline: "Live no-KYC offers from RoboSats, Mostro and HodlHodl.",
    schema: "WebPage",
    parent: OBSERVATORY,
    keywords: ["kyc-free bitcoin", "p2p bitcoin offers", "robosats", "mostro", "hodlhodl", "no kyc bitcoin", "p2p bitcoin premium"],
  },
  labeling: {
    path: "/guide/labeling/",
    title: "How to Label Bitcoin UTXOs (BIP329, Sparrow) | am-i.exposed",
    description: "Label bitcoin UTXOs by origin ([KYC], [noKYC], [CJ]) so coins that would link identities never merge. BIP329 example file and Sparrow how-to.",
    name: "Labeling bitcoin UTXOs",
    tagline: "Origin labels, BIP329 files and Sparrow, step by step.",
    schema: "TechArticle",
    parent: GUIDE,
    keywords: ["how to label bitcoin utxos", "bip329", "sparrow wallet labels", "bitcoin coin labeling", "kyc nokyc utxo"],
  },
  spending: {
    path: "/guide/spending/",
    title: "Bitcoin Coin Control Privacy Checklist | am-i.exposed",
    description: "A bitcoin coin control privacy checklist: which UTXOs to spend together, when to avoid change, and how payment plans are ranked privacy first.",
    name: "Spending checklist",
    tagline: "Coin control rules for every payment, privacy first.",
    schema: "TechArticle",
    parent: GUIDE,
    keywords: ["bitcoin coin control", "bitcoin privacy checklist", "utxo consolidation privacy", "bitcoin change output", "coin selection privacy"],
  },
} as const satisfies Record<string, SeoRoute>;

export type SeoRouteKey = keyof typeof SEO_ROUTES;

/** Title, description, canonical, Open Graph and Twitter for one route (images come from its opengraph-image files). */
export function routeMetadata(key: SeoRouteKey): Metadata {
  const r: SeoRoute = SEO_ROUTES[key];
  const url = `${ORIGIN}${r.path}`;
  return {
    title: r.title,
    description: r.description,
    keywords: r.keywords,
    alternates: { canonical: url },
    openGraph: { title: r.title, description: r.description, url, type: "article", siteName: "am-i.exposed", locale: "en_US" },
    twitter: { card: "summary_large_image", title: r.title, description: r.description },
  };
}

/** BreadcrumbList (Home > parent > page) plus the page node, as one @graph. */
export function routeJsonLd(key: SeoRouteKey): object {
  const r: SeoRoute = SEO_ROUTES[key];
  const url = `${ORIGIN}${r.path}`;
  const crumbs = [{ name: "Home", path: "/" }, ...(r.parent ? [r.parent] : []), { name: r.name, path: r.path }];
  const page = {
    "@type": r.schema,
    "@id": url,
    url,
    name: r.title.replace(/ \| am-i\.exposed$/, ""),
    description: r.description,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: "am-i.exposed", url: `${ORIGIN}/` },
    ...(r.schema === "TechArticle"
      ? { headline: r.name, author: { "@type": "Organization", name: "Copexit", url: "https://github.com/Copexit" }, image: `${url}opengraph-image` }
      : { primaryImageOfPage: `${url}opengraph-image` }),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${ORIGIN}${c.path}` })),
      },
      page,
    ],
  };
}
