import { createCachedMempoolClient } from "./cached-client";
import type { NetworkConfig } from "@/lib/bitcoin/networks";

/**
 * API client backed by a single mempool.space-compatible endpoint.
 * All responses are transparently cached in IndexedDB for cross-session reuse.
 */
export function createApiClient(config: NetworkConfig, signal?: AbortSignal) {
  return createCachedMempoolClient(config.mempoolBaseUrl, undefined, signal);
}

export type ApiClient = ReturnType<typeof createApiClient>;
