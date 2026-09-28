/** Primary navigation. Guide stays active across the knowledge pages. */
export const NAV_ITEMS = [
  { href: "/graph/", key: "common.graphExplorer", label: "Graph" },
  { href: "/observatory/", key: "common.observatory", label: "Observatory" },
  { href: "/guide/", key: "common.guide", label: "Guide" },
  { href: "/setup-guide/", key: "common.selfHost", label: "Self-Host" },
  { href: "/about/", key: "common.about", label: "About" },
] as const;

const strip = (p: string) => p.replace(/\/+$/, "") || "/";
const KNOWLEDGE = new Set(["/guide", "/faq", "/glossary"]);

export function isNavActive(href: string, pathname: string): boolean {
  const cur = strip(pathname);
  const target = strip(href);
  return target === "/guide" ? KNOWLEDGE.has(cur) : cur === target;
}

/** Graph link opens the current tx when one is loaded on the scanner. */
export function graphHref(pathname: string, hash: string): string {
  const m = strip(pathname) === "/" && hash.match(/^#tx=([a-fA-F0-9]{64})$/);
  return m ? `/graph/#txid=${m[1]}` : "/graph/";
}
