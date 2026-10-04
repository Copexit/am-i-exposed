import { isLocalApi } from "./client";

export type BackendClass = "self-hosted" | "public";

/**
 * Self-hosted: Umbrel's /api proxy, or a custom URL on a private host (localhost,
 * RFC-1918, .local, .onion). mempool.space (clearnet or its onion) and custom URLs
 * on public hostnames are public: lookups there need the user's consent.
 */
export function backendClass({ isUmbrel, customApiUrl }: { isUmbrel: boolean; customApiUrl: string | null }): BackendClass {
  if (isUmbrel) return "self-hosted";
  return customApiUrl && isLocalApi(customApiUrl) ? "self-hosted" : "public";
}

export function endpointHost(baseUrl: string): string {
  if (baseUrl.startsWith("/")) return typeof window !== "undefined" ? window.location.host : "localhost";
  try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
}

export function isOnionUrl(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname.endsWith(".onion"); } catch { return false; }
}
