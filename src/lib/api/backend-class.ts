import { isLocalApi } from "./client";
import { NETWORK_CONFIG } from "@/lib/bitcoin/networks";

export type BackendClass = "self-hosted" | "public";

/**
 * Self-hosted: Umbrel's /api proxy, or a custom URL on a private host (localhost,
 * RFC-1918, .local, .onion). mempool.space (clearnet or its onion) and custom URLs
 * on public hostnames are public: lookups there need the user's consent.
 */
/** mempool.space's own onion is a public service, even as a custom URL. */
function isPublicOnion(url: string): boolean {
  const host = endpointHost(url);
  return Object.values(NETWORK_CONFIG).some((c) => c.mempoolOnionUrl && endpointHost(c.mempoolOnionUrl) === host);
}

export function backendClass({ isUmbrel, customApiUrl }: { isUmbrel: boolean; customApiUrl: string | null }): BackendClass {
  if (isUmbrel) return "self-hosted";
  if (!customApiUrl || isPublicOnion(customApiUrl)) return "public";
  return isLocalApi(customApiUrl) ? "self-hosted" : "public";
}

export function endpointHost(baseUrl: string): string {
  if (baseUrl.startsWith("/")) return typeof window !== "undefined" ? window.location.host : "localhost";
  try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
}

export function isOnionUrl(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname.endsWith(".onion"); } catch { return false; }
}
