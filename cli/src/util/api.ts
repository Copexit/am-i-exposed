import { createMempoolClient, type MempoolClient } from "@/lib/api/mempool";
import { createCachedNodeClient } from "../adapters/cached-client-node";
import { cacheGet, cacheSet } from "../adapters/sqlite-cache";
import {
  detectBackendChain,
  isSupportedChain,
  UNSUPPORTED_CHAIN_LABEL,
  type BackendChain,
  type ChainStore,
} from "@/lib/api/backend-network";
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

const sqliteChainStore: ChainStore = {
  get: async (key) => cacheGet<BackendChain>(key),
  put: async (key, chain) => cacheSet(key, chain),
};

/**
 * The network to use with a custom --api: the chain the backend reports
 * (genesis block hash, cached per URL). `explicit` is a --network the user
 * passed; it must match. Returns `fallback` when the backend cannot be asked.
 */
export async function networkForApi(
  api: string,
  { explicit, fallback, cache }: { explicit: boolean; fallback: string; cache: boolean },
): Promise<string> {
  const chain = await detectBackendChain(api, { store: cache ? sqliteChainStore : undefined });
  if (!chain) return fallback;
  if (!isSupportedChain(chain)) {
    const name = chain === "unknown" ? "an unrecognized chain" : UNSUPPORTED_CHAIN_LABEL[chain];
    throw new Error(`The API at ${api} serves ${name}, which is not supported (mainnet, testnet4 or signet).`);
  }
  if (explicit && chain !== fallback) {
    throw new Error(`--network ${fallback} does not match the API at ${api}, which serves ${chain}.`);
  }
  return chain;
}
