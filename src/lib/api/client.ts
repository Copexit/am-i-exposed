import { createCachedMempoolClient } from "./cached-client";
import type { NetworkConfig } from "@/lib/bitcoin/networks";

/** Timeout for hosted mempool.space (and Tor) */
const HOSTED_TIMEOUT_MS = 15_000;
/** Timeout for self-hosted / Umbrel / custom Electrs backends (heavy queries can be slow) */
const LOCAL_TIMEOUT_MS = 60_000;

/**
 * Detect whether a base URL points to a local/self-hosted API
 * (Umbrel /api proxy, localhost, LAN IPs, .onion).
 */
function isLocalApi(url: string): boolean {
  if (url.startsWith("/")) return true; // Umbrel /api proxy
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.endsWith(".local") ||
      host.endsWith(".onion")
    );
  } catch {
    return false;
  }
}

/**
 * API client backed by a single mempool.space-compatible endpoint.
 * All responses are transparently cached in IndexedDB for cross-session reuse.
 *
 * Self-hosted/Umbrel APIs get a 120s per-request timeout (Electrs can be slow
 * on large addresses). Hosted mempool.space keeps the default 15s timeout.
 */
export function createApiClient(config: NetworkConfig, signal?: AbortSignal) {
  const timeoutMs = isLocalApi(config.mempoolBaseUrl)
    ? LOCAL_TIMEOUT_MS
    : HOSTED_TIMEOUT_MS;
  return createCachedMempoolClient(config.mempoolBaseUrl, undefined, { signal, timeoutMs });
}

export type ApiClient = ReturnType<typeof createApiClient>;
