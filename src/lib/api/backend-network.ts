/**
 * Which chain a mempool-compatible backend serves, read from its genesis block
 * hash (`GET {base}/block-height/0`, plain text). Self-hosted backends (Umbrel,
 * StartOS, a custom URL) carry no network in their URL path, so the backend is
 * asked instead.
 *
 * Storage-agnostic (shared with the CLI): the caller passes a ChainStore.
 */

import { isValidNetwork, type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { abortSignalAny, abortSignalTimeout } from "@/lib/abort-signal";

/** A supported network, or a chain the app does not support. */
export type BackendChain = BitcoinNetwork | "testnet3" | "regtest" | "unknown";

/**
 * Genesis block hashes from Bitcoin Core's chainparams (src/kernel/chainparams.cpp).
 * Every signet, default or custom, shares the same genesis block, so a custom
 * signet reads as signet (same address formats, the backend answers for it).
 */
const GENESIS: Record<string, BackendChain> = {
  "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f": "mainnet",
  "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943": "testnet3",
  "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043": "testnet4",
  "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6": "signet",
  "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206": "regtest",
};

export const isSupportedChain = (chain: BackendChain): chain is BitcoinNetwork => isValidNetwork(chain);

/** Display names of the unsupported chains ("unknown" is translated by the UI). */
export const UNSUPPORTED_CHAIN_LABEL: Record<"testnet3" | "regtest", string> = {
  testnet3: "Testnet3",
  regtest: "Regtest",
};

/** The chain behind a genesis hash: null when the text is not a block hash at all. */
export function chainFromGenesis(text: string): BackendChain | null {
  const hash = text.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return GENESIS[hash] ?? "unknown";
}

/**
 * Map a packager hint (Umbrel's APP_BITCOIN_NETWORK: mainnet, testnet,
 * testnet4, signet, regtest) to a chain. Unset or unrecognized: null.
 */
export function chainFromHint(hint: string | null | undefined): BackendChain | null {
  const h = hint?.trim().toLowerCase();
  if (!h) return null;
  if (h === "testnet" || h === "testnet3") return "testnet3";
  if (h === "regtest") return "regtest";
  return isValidNetwork(h) ? h : null;
}

export const GENESIS_TIMEOUT_MS = 4_000;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** Fetch the genesis hash. null on any failure (timeout, HTTP error, not a hash). */
export async function fetchGenesisChain(
  baseUrl: string,
  signal?: AbortSignal,
  timeoutMs = GENESIS_TIMEOUT_MS,
): Promise<BackendChain | null> {
  try {
    const timeout = abortSignalTimeout(timeoutMs);
    const res = await fetch(`${trimSlash(baseUrl)}/block-height/0`, {
      signal: signal ? abortSignalAny([signal, timeout]) : timeout,
    });
    if (!res.ok) return null;
    return chainFromGenesis(await res.text());
  } catch {
    return null;
  }
}

/** Persistent cache for detected chains (IndexedDB on the web, SQLite in the CLI). */
export interface ChainStore {
  get(key: string): Promise<BackendChain | undefined>;
  put(key: string, chain: BackendChain): Promise<void>;
}

/** Detected chains by normalized base URL, for this page load / process. */
const known = new Map<string, BackendChain>();
let listeners: (() => void)[] = [];

/** The chain detected for a backend in this session, if any. */
export function knownBackendChain(baseUrl: string): BackendChain | undefined {
  return known.get(trimSlash(baseUrl));
}

/** Subscribe to detections (for useSyncExternalStore). */
export function subscribeBackendChains(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

function remember(url: string, chain: BackendChain) {
  if (known.get(url) === chain) return;
  known.set(url, chain);
  for (const l of listeners) l();
}

export const genesisCacheKey = (baseUrl: string) => `genesis@${trimSlash(baseUrl)}`;

/**
 * Detect the chain a backend serves, once per backend: memory, then `store`
 * (infinite TTL, keyed by base URL), then the network. `refresh` skips both
 * caches and re-asks the backend (still writing them). Returns null when the
 * backend could not be asked; the caller keeps its previous assumption.
 */
export async function detectBackendChain(
  baseUrl: string,
  { store, refresh = false, signal }: { store?: ChainStore; refresh?: boolean; signal?: AbortSignal } = {},
): Promise<BackendChain | null> {
  const url = trimSlash(baseUrl);
  const key = genesisCacheKey(url);
  if (!refresh) {
    const hit = known.get(url) ?? (await store?.get(key).catch(() => undefined));
    if (hit) {
      remember(url, hit);
      return hit;
    }
  }
  const chain = await fetchGenesisChain(url, signal);
  if (chain) {
    remember(url, chain);
    await store?.put(key, chain).catch(() => {});
  }
  return chain;
}

/** Test helper: forget every detection. */
export function _resetBackendChainsForTest() {
  known.clear();
  listeners = [];
}
