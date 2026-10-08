import { createMempoolClient, type MempoolClient } from "@/lib/api/mempool";
import { createCachedNodeClient } from "../adapters/cached-client-node";
import {
  detectBackendChain,
  isSupportedChain,
  UNSUPPORTED_CHAIN_LABEL,
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

/**
 * The network to use with a custom --api: the chain the backend reports
 * (genesis block hash). Asked on every run, never cached: a node can switch
 * chains behind the same URL. `explicit` is a --network the user passed; it
 * must match. Returns `fallback` when the backend cannot be asked.
 */
export async function networkForApi(
  api: string,
  { explicit, fallback }: { explicit: boolean; fallback: string },
): Promise<string> {
  const chain = await detectBackendChain(api, { refresh: true });
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
