import {
  deriveOneAddress,
  type ParsedXpub,
} from "@/lib/bitcoin/descriptor";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { traceBackward, traceForward, type TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";
import type { MempoolClient } from "@/lib/api/mempool";

/** Default gap limit if settings unavailable. */
export const DEFAULT_GAP_LIMIT = 5;

/** Max UTXO txids to trace (prevents explosion on large wallets). */
export const MAX_UTXO_TRACES = 50;

/** Trace depth for UTXO provenance. */
export const UTXO_TRACE_DEPTH = 3;

/**
 * Consecutive addresses whose fetch still fails after retries before the scan
 * gives up. A backend that keeps failing is an error, not an empty wallet.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Scan-level retries per address, on top of fetchWithRetry's own retries. */
const ADDRESS_RETRIES = 2;

/**
 * Fetch all 3 endpoints for a single address. Rejects on any failure so a
 * rate-limited or unreachable address is never mistaken for an unused one.
 */
async function fetchAddress(
  api: MempoolClient,
  derived: DerivedAddress,
): Promise<WalletAddressInfo> {
  const [addressData, utxos, txs] = await Promise.all([
    api.getAddress(derived.address),
    api.getAddressUtxos(derived.address),
    api.getAddressTxs(derived.address),
  ]);
  return { derived, addressData, utxos, txs };
}

/** Returns true if address has any on-chain activity. */
function isUsed(info: WalletAddressInfo): boolean {
  if (info.txs.length > 0) return true;
  if (info.addressData && typeof info.addressData === "object") {
    const stats = info.addressData.chain_stats;
    if (stats && (stats.tx_count > 0 || stats.funded_txo_count > 0)) return true;
  }
  return false;
}

/** Delay that can be cancelled via AbortSignal. */
function abortableDelay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { abortSignal.removeEventListener("abort", onAbort); resolve(); }, ms);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ScanChainResult {
  infos: WalletAddressInfo[];
  /** Addresses whose data could not be fetched (excluded from infos and the gap count). */
  failed: string[];
}

/**
 * Scan one chain (receive=0 or change=1) incrementally.
 * Derives + fetches one address at a time, stops after gapLimit
 * consecutive unused addresses. Failed fetches are retried with the same
 * throttle delays, then reported in `failed`; after MAX_CONSECUTIVE_FAILURES
 * failed addresses in a row the last error is thrown.
 */
export async function scanChain(
  parsed: ParsedXpub,
  chain: 0 | 1,
  api: MempoolClient,
  signal: AbortSignal,
  isLocal: boolean,
  gapLimit: number,
  onProgress: (info: WalletAddressInfo) => void,
): Promise<ScanChainResult> {
  const results: WalletAddressInfo[] = [];
  const failed: string[] = [];
  let consecutiveUnused = 0;
  let consecutiveFailures = 0;
  let index = 0;
  /** Addresses in the initial token bucket (20 tokens / 3 per addr). */
  const BURST_SIZE = 6;
  /** Delay between addresses after burst for hosted APIs. */
  const SUSTAIN_DELAY_MS = 9000;
  /** Small gap between burst addresses. */
  const BURST_GAP_MS = 300;
  /** Track how many addresses have been fetched across this chain for burst logic. */
  let fetchCount = 0;

  const pause = (ms: number) => abortableDelay(ms, signal).catch((e) => {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      console.warn("delay failed:", e);
    }
  });

  while (consecutiveUnused < gapLimit) {
    if (signal.aborted) return { infos: results, failed };

    const derived = deriveOneAddress(parsed, chain, index);
    const t0 = performance.now();
    let info: WalletAddressInfo | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= ADDRESS_RETRIES && !signal.aborted; attempt++) {
      // Back off on the sustained throttle rate before re-fetching a failed address
      if (attempt > 0) await pause((isLocal ? 1000 : SUSTAIN_DELAY_MS) * attempt);
      try {
        info = await fetchAddress(api, derived);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    const wasCacheHit = performance.now() - t0 < 100;
    if (!wasCacheHit) fetchCount++;
    index++;

    if (info) {
      consecutiveFailures = 0;
      results.push(info);
      onProgress(info);
      if (isUsed(info)) {
        consecutiveUnused = 0;
      } else {
        consecutiveUnused++;
      }
    } else if (!signal.aborted) {
      failed.push(derived.address);
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw lastError;
    }

    // Rate limit for hosted APIs - skip delay on cache hits (IDB reads < 10ms)
    if (!isLocal && !wasCacheHit && consecutiveUnused < gapLimit) {
      await pause(fetchCount <= BURST_SIZE ? BURST_GAP_MS : SUSTAIN_DELAY_MS);
    }
  }

  return { infos: results, failed };
}

/**
 * Collect unique transactions that have outputs belonging to the wallet.
 * Includes both spent and unspent outputs. Sorted by wallet output value descending.
 */
export function collectWalletTxs(
  allInfos: WalletAddressInfo[],
): Map<string, MempoolTransaction> {
  // Build set of all wallet addresses for output matching
  const walletAddresses = new Set<string>();
  for (const info of allInfos) {
    walletAddresses.add(info.derived.address);
  }

  const txMap = new Map<string, MempoolTransaction>();
  const valueMap = new Map<string, number>();

  for (const info of allInfos) {
    for (const tx of info.txs) {
      if (txMap.has(tx.txid)) continue;
      // Sum outputs belonging to the wallet
      let walletValue = 0;
      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address && walletAddresses.has(vout.scriptpubkey_address)) {
          walletValue += vout.value;
        }
      }
      if (walletValue === 0) continue; // Skip txs where wallet has no outputs
      txMap.set(tx.txid, tx);
      valueMap.set(tx.txid, walletValue);
    }
  }

  // Sort by wallet output value descending and cap
  const sorted = [...txMap.entries()]
    .sort((a, b) => (valueMap.get(b[0]) ?? 0) - (valueMap.get(a[0]) ?? 0))
    .slice(0, MAX_UTXO_TRACES);

  return new Map(sorted);
}

export interface UtxoTraceResult {
  tx: MempoolTransaction;
  backward: TraceLayer[];
  forward: TraceLayer[];
  outspends: MempoolOutspend[];
}

/**
 * Trace provenance of wallet txs for graph pre-expansion, running at most
 * `concurrency` traces at once (each trace already runs 3 fetch chains).
 * A failed trace is skipped: its root appears without pre-expansion.
 */
export async function traceWalletTxs(
  txs: Map<string, MempoolTransaction>,
  api: MempoolClient,
  signal: AbortSignal,
  { depth, minSats, concurrency }: { depth: number; minSats: number; concurrency: number },
  onTraced: (traced: number) => void,
): Promise<Map<string, UtxoTraceResult>> {
  const queue = [...txs.entries()];
  const results = new Map<string, UtxoTraceResult>();
  let traced = 0;

  const worker = async () => {
    for (let next = queue.shift(); next && !signal.aborted; next = queue.shift()) {
      const [txid, tx] = next;
      try {
        const [bwResult, fwResult, outspends] = await Promise.all([
          traceBackward(tx, depth, minSats, api, signal),
          traceForward(tx, depth, minSats, api, signal),
          api.getTxOutspends(txid).catch(() => [] as MempoolOutspend[]),
        ]);
        results.set(txid, { tx, backward: bwResult.layers, forward: fwResult.layers, outspends });
      } catch {
        // Failed trace - root will appear without pre-expansion
      }
      onTraced(++traced);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}
