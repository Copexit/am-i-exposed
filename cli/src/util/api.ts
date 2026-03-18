import { createMempoolClient, type MempoolClient } from "@/lib/api/mempool";
import { createCachedNodeClient } from "../adapters/cached-client-node";
import type { GlobalOpts } from "../index";

/** Resolve the mempool API base URL from CLI flags. */
export function resolveApiUrl(opts: GlobalOpts): string {
  if (opts.api) return opts.api;

  const network = opts.network ?? "mainnet";
  switch (network) {
    case "testnet4":
      return "https://mempool.space/testnet4/api";
    case "signet":
      return "https://mempool.space/signet/api";
    default:
      return "https://mempool.space/api";
  }
}

/** Create a mempool API client from CLI opts. Cached by default. */
export function createClient(opts: GlobalOpts): MempoolClient {
  const baseUrl = resolveApiUrl(opts);

  // --no-cache: use raw client (no SQLite caching)
  if (opts.cache === false) {
    return createMempoolClient(baseUrl);
  }

  return createCachedNodeClient(baseUrl, opts.network);
}
