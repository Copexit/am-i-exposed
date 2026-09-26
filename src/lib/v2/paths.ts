/** Route prefix of the v2 UI, served beside the classic UI during the beta. */
export const V2_PREFIX = "/v2";

/** True when a pathname belongs to the v2 UI. */
export function isV2Path(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === V2_PREFIX || pathname.startsWith(`${V2_PREFIX}/`));
}

/**
 * Link to the scanner home for a hash route (e.g. `tx=<txid>`), staying in the
 * UI the user is currently in. Without a pathname, links to the classic root.
 */
export function scannerHref(hash: string, pathname?: string | null): string {
  const base = isV2Path(pathname) ? `${V2_PREFIX}/` : "/";
  return hash ? `${base}#${hash}` : base;
}

/**
 * The v2 counterpart of a classic page: same page under /v2, keeping the hash
 * only where v2 understands it (scanner routes on the home page, a graph root).
 */
export function v2Href(pathname: string | null | undefined, hash: string): string {
  const path = (pathname ?? "/").replace(/\/+$/, "");
  const target = `${V2_PREFIX}${path}/`;
  const keep = path === "" ? /^#(tx|addr|check|xpub)=/.test(hash) : path === "/graph" && /^#txid=/.test(hash);
  return keep ? `${target}${hash}` : target;
}
