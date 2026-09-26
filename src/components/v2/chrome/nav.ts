/** v2 primary navigation. Guide stays active across the knowledge pages. */
export const V2_NAV = [
  // Labels reuse the classic header's translated keys.
  { href: "/v2/graph/", key: "common.graphExplorer", label: "Graph" },
  { href: "/v2/observatory/", key: "common.observatory", label: "Observatory" },
  { href: "/v2/guide/", key: "common.guide", label: "Guide" },
  { href: "/v2/setup-guide/", key: "common.selfHost", label: "Self-Host" },
  { href: "/v2/about/", key: "common.about", label: "About" },
] as const;

const strip = (p: string) => p.replace(/\/+$/, "") || "/";
const KNOWLEDGE = new Set(["/v2/guide", "/v2/faq", "/v2/glossary"]);

export function isNavActive(href: string, pathname: string): boolean {
  const cur = strip(pathname);
  const target = strip(href);
  return target === "/v2/guide" ? KNOWLEDGE.has(cur) : cur === target;
}

/** Same page in the classic UI (v2 prefix dropped), carrying the scan hash. */
export function classicHref(pathname: string, hash: string): string {
  const rest = strip(pathname).replace(/^\/v2(?=\/|$)/, "");
  return (rest ? `${rest}/` : "/") + hash;
}

/** Graph link opens the current tx when one is loaded on the scanner. */
export function graphHref(pathname: string, hash: string): string {
  const m = strip(pathname) === "/v2" && hash.match(/^#tx=([a-fA-F0-9]{64})$/);
  return m ? `/v2/graph/#txid=${m[1]}` : "/v2/graph/";
}
