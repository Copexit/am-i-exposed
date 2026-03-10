import { createMempoolClient } from "./mempool";
import type { NetworkConfig } from "@/lib/bitcoin/networks";

/**
 * API client backed by a single mempool.space-compatible endpoint.
 * No secondary fallback - all queries go to the configured API only.
 */
export function createApiClient(config: NetworkConfig, signal?: AbortSignal) {
  return createMempoolClient(config.mempoolBaseUrl, signal);
}

export type ApiClient = ReturnType<typeof createApiClient>;
