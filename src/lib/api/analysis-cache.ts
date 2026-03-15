/**
 * Analysis result cache - stores computed analysis results in IndexedDB.
 *
 * Unlike cached-client.ts (which caches raw API responses), this caches the
 * entire analysis result (score, findings, trace layers) so returning to a
 * previously-analyzed tx/address is instant - no loading screen, no heuristic
 * recalculation.
 *
 * Cache key embeds analysis settings so changing settings forces recomputation.
 * TraceLayer.txs (Map) is serialized to/from plain objects at the boundary.
 */

import { idbGet, idbPut } from "./idb-cache";
import type { AnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { ScoringResult, InputType, TxAnalysisResult } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
  MempoolOutspend,
} from "@/lib/api/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { AnalysisState } from "@/hooks/useAnalysisState";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";

export const TTL_24_HOURS = 24 * 60 * 60 * 1000;

/** TraceLayer with txs stored as a plain object (for JSON/IDB serialization). */
interface StoredTraceLayer {
  depth: number;
  txs: Record<string, MempoolTransaction>;
}

/** What gets stored in IDB (layers as plain objects). */
interface StoredAnalysisResult {
  phase: "complete";
  query: string;
  inputType: InputType;
  result: ScoringResult | null;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  durationMs: number | null;
  usdPrice: number | null;
  outspends: MempoolOutspend[] | null;
  backwardLayers: StoredTraceLayer[] | null;
  forwardLayers: StoredTraceLayer[] | null;
  boltzmannResult: BoltzmannWorkerResult | null;
}

/** Deserialized analysis result returned from getCachedResult. */
export interface CachedAnalysisResult {
  phase: "complete";
  query: string;
  inputType: InputType;
  result: ScoringResult | null;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  durationMs: number | null;
  usdPrice: number | null;
  outspends: MempoolOutspend[] | null;
  backwardLayers: TraceLayer[] | null;
  forwardLayers: TraceLayer[] | null;
  boltzmannResult: BoltzmannWorkerResult | null;
}

/**
 * Cache version - bump when computation logic changes (WASM rebuild, heuristic
 * updates, scoring changes) to invalidate stale cached results.
 */
const CACHE_VERSION = 2;

/**
 * Build a cache key that embeds the analysis settings affecting results.
 * Format: result:v{CACHE_VERSION}:{network}:{query}:{maxDepth}:{minSats}:{skipCoinJoins}:{skipLargeClusters}
 */
export function buildResultCacheKey(
  network: string,
  query: string,
  settings: AnalysisSettings,
): string {
  return `result:v${CACHE_VERSION}:${network}:${query}:${settings.maxDepth}:${settings.minSats}:${settings.skipCoinJoins ? 1 : 0}:${settings.skipLargeClusters ? 1 : 0}`;
}

/** Convert TraceLayer[] to stored form (Map -> Record). */
function serializeLayers(layers: TraceLayer[]): StoredTraceLayer[] {
  return layers.map((layer) => ({
    depth: layer.depth,
    txs: Object.fromEntries(layer.txs),
  }));
}

/** Convert stored layers back to TraceLayer[] (Record -> Map). */
function deserializeLayers(layers: StoredTraceLayer[]): TraceLayer[] {
  return layers.map((layer) => ({
    depth: layer.depth,
    txs: new Map(Object.entries(layer.txs)),
  }));
}

/**
 * Get a cached analysis result. Returns undefined if not found, expired,
 * or cache is disabled.
 */
export async function getCachedResult(
  network: string,
  query: string,
  settings: AnalysisSettings,
): Promise<CachedAnalysisResult | undefined> {
  if (!settings.enableCache) return undefined;

  const key = buildResultCacheKey(network, query, settings);
  const stored = await idbGet<StoredAnalysisResult>(key);
  if (!stored) return undefined;

  return {
    ...stored,
    backwardLayers: stored.backwardLayers
      ? deserializeLayers(stored.backwardLayers)
      : null,
    forwardLayers: stored.forwardLayers
      ? deserializeLayers(stored.forwardLayers)
      : null,
    boltzmannResult: stored.boltzmannResult ?? null,
  };
}

/**
 * Store an analysis result in the cache. No-op if cache is disabled.
 * Extracts relevant fields from AnalysisState and serializes trace layers.
 */
export async function putCachedResult(
  network: string,
  query: string,
  settings: AnalysisSettings,
  state: AnalysisState,
): Promise<void> {
  if (!settings.enableCache) return;

  const key = buildResultCacheKey(network, query, settings);

  const stored: StoredAnalysisResult = {
    phase: "complete",
    query: state.query ?? query,
    inputType: state.inputType ?? "txid",
    result: state.result,
    txData: state.txData,
    addressData: state.addressData,
    addressTxs: state.addressTxs,
    addressUtxos: state.addressUtxos,
    txBreakdown: state.txBreakdown,
    preSendResult: state.preSendResult,
    durationMs: state.durationMs,
    usdPrice: state.usdPrice,
    outspends: state.outspends,
    backwardLayers: state.backwardLayers
      ? serializeLayers(state.backwardLayers)
      : null,
    forwardLayers: state.forwardLayers
      ? serializeLayers(state.forwardLayers)
      : null,
    boltzmannResult: state.boltzmannResult ?? null,
  };

  await idbPut(key, stored, TTL_24_HOURS);
}
