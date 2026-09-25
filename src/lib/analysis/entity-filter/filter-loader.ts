/**
 * Lazy-loads the entity address filter on first use.
 *
 * Two-tier architecture:
 *   - Core (~5.8 MB): entity-index.bin only, auto-loaded.
 *     The sorted hash index serves as BOTH membership test (binary search)
 *     AND name resolver. No Bloom filter needed for core.
 *   - Full (~93 MB total): loaded on demand. Two files:
 *     1. entity-index-full.bin (~58 MB) - 10M addresses with entity names
 *     2. entity-filter-full.bin (~35 MB) - overflow Bloom for remaining ~20M
 *        addresses (boolean "Known entity" only, no name).
 *
 * Build pipeline: scripts/build-entity-filter.mjs -> public/data/
 */

import type { AddressFilter, FilterMeta, FilterStatus } from "./types";
import {
  fnv1a,
  normalizeAddress,
  parseEntityIndex,
  setEntityIndex,
  createIndexBackedFilter,
} from "./entity-index";
import {
  checkForFullDataUpdate as checkForFullDataUpdateImpl,
  updateFullEntityData as updateFullEntityDataImpl,
} from "./data-updater";

// Re-export entity index lookup functions
export { lookupEntityName, lookupEntityCategory } from "./entity-index";

let filterInstance: AddressFilter | null = null;
let filterStatus: FilterStatus = "idle";

let fullFilterInstance: AddressFilter | null = null;
let fullFilterStatus: FilterStatus = "idle";

// In-flight loads, shared so concurrent callers all get the loaded filter.
let corePromise: Promise<AddressFilter | null> | null = null;
let fullPromise: Promise<AddressFilter | null> | null = null;
// Bumped by updateFullEntityData: a full load from an older generation that
// finishes late must not overwrite the newer state.
let fullGeneration = 0;
// Progress listeners of every caller sharing the in-flight full download.
const fullProgressListeners = new Set<ProgressCallback>();

const CORE_INDEX_PATH = "/data/entity-index.bin";
const FULL_INDEX_PATH = "/data/entity-index-full.bin";
const FULL_BLOOM_PATH = "/data/entity-filter-full.bin";

/**
 * Get the current core filter status without triggering a load.
 */
export function getFilterStatus(): FilterStatus {
  return filterStatus;
}

/**
 * Get the loaded filter instance (core or full, whichever is best available).
 * Returns null if no filter is ready.
 */
export function getFilter(): AddressFilter | null {
  return fullFilterInstance ?? filterInstance;
}

/**
 * Whether the full (expanded) filter is loaded.
 */
export function isFullFilterLoaded(): boolean {
  return fullFilterInstance !== null;
}

/**
 * Get the full filter status.
 */
export function getFullFilterStatus(): FilterStatus {
  return fullFilterStatus;
}

// ───────────────── Bloom filter parser ─────────────────

/**
 * Parse filter header from an ArrayBuffer (Bloom filter binary format v2).
 * Returns null if the buffer is too small or the version is unsupported.
 */
function parseHeader(buffer: ArrayBuffer): {
  version: number;
  meta: FilterMeta;
} | null {
  // 32-byte header + 16-byte Bloom parameters (m, k, seed1, seed2)
  if (buffer.byteLength < 48) return null;

  const view = new DataView(buffer);
  const version = view.getUint32(0, true);
  const addressCount = view.getUint32(4, true);
  const fprX1000 = view.getUint32(8, true);
  const buildDateLen = view.getUint32(12, true);

  const decoder = new TextDecoder();
  const buildDate = decoder.decode(
    new Uint8Array(buffer, 16, Math.min(buildDateLen, 16)),
  );

  return {
    version,
    meta: {
      version,
      addressCount,
      fpr: fprX1000 / 1000,
      buildDate,
    },
  };
}

/**
 * Parse a version-2 Bloom filter from an ArrayBuffer.
 * Returns null for degenerate parameters (m = 0 or k = 0), which would
 * otherwise match every address.
 */
function parseBloomFilter(
  buffer: ArrayBuffer,
  meta: FilterMeta,
): AddressFilter | null {
  const bloomView = new DataView(buffer, 32, 16);
  const bloomM = bloomView.getUint32(0, true);
  const bloomK = bloomView.getUint32(4, true);
  const seed1 = bloomView.getUint32(8, true);
  const seed2 = bloomView.getUint32(12, true);
  if (bloomM === 0 || bloomK === 0) return null;

  const bits = new Uint8Array(buffer, 48);

  return {
    has(address: string): boolean {
      const normalized = normalizeAddress(address);
      const h1 = fnv1a(normalized, seed1);
      const h2 = fnv1a(normalized, seed2);

      for (let i = 0; i < bloomK; i++) {
        const pos = (h1 + i * h2) % bloomM;
        // A bit past the end of a truncated filter reads as unset.
        if (!((bits[pos >> 3] ?? 0) & (1 << (pos & 7)))) return false;
      }
      return true;
    },
    meta,
  };
}

// ───────────────── Streaming fetch helper ─────────────────

/** Progress callback: received bytes and total bytes (0 if unknown). */
export type ProgressCallback = (loaded: number, total: number) => void;

/** Custom data loader (used by the CLI to read from the local filesystem). */
export type DataFetchFn = (
  path: string,
  onProgress?: ProgressCallback,
) => Promise<ArrayBuffer | null>;

let customFetchFn: DataFetchFn | null = null;

/**
 * Override the default `fetch()`-based loader. Used by environments without
 * a network (e.g. the CLI, which reads files from disk).
 */
export function configureDataLoader(opts: { fetchFn: DataFetchFn }): void {
  customFetchFn = opts.fetchFn;
}

/**
 * Fetch a binary file with optional streaming progress.
 * Returns the ArrayBuffer, or null on failure.
 */
async function fetchArrayBuffer(
  path: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer | null> {
  if (customFetchFn) {
    return customFetchFn(path, onProgress);
  }

  const res = await fetch(path);
  if (!res.ok) return null;

  if (onProgress && res.body) {
    const total = Number(res.headers.get("content-length") ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }

    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }

  return res.arrayBuffer();
}

// ───────────────── Public API ─────────────────

/**
 * Load the core entity address filter (small, auto-loaded).
 * Loads entity-index.bin and creates an index-backed AddressFilter.
 * Returns the filter if successful, null otherwise.
 * Safe to call multiple times - only loads once; concurrent callers share
 * the same in-flight load. A missing or corrupt file ("unavailable") is final;
 * a thrown load ("error", e.g. a network failure) is retried on the next call.
 */
export function loadEntityFilter(): Promise<AddressFilter | null> {
  if (filterInstance) return Promise.resolve(filterInstance);
  if (filterStatus === "unavailable") return Promise.resolve(null);
  return (corePromise ??= loadCore());
}

async function loadCore(): Promise<AddressFilter | null> {
  filterStatus = "loading";

  try {
    const buffer = await fetchArrayBuffer(CORE_INDEX_PATH);
    if (!buffer) {
      filterStatus = "unavailable";
      return null;
    }

    const index = parseEntityIndex(buffer);
    if (!index) {
      filterStatus = "unavailable";
      return null;
    }

    // Set entity index for name lookups, unless the full index won the race
    if (!fullFilterInstance) setEntityIndex(index);

    // Create index-backed filter (no Bloom needed for core)
    filterInstance = createIndexBackedFilter(index);
    filterStatus = "ready";
    return filterInstance;
  } catch {
    filterStatus = "error";
    corePromise = null; // allow a retry on the next call
    return null;
  }
}

/**
 * Load the full entity database (large, on-demand).
 * Downloads TWO files:
 *   1. entity-index-full.bin (~58 MB) - 10M addresses with entity names
 *   2. entity-filter-full.bin (~35 MB) - overflow Bloom for ~20M addresses
 *
 * Combined progress is reported through the callback.
 * When loaded, replaces the core filter for all lookups via getFilter().
 *
 * @param onProgress - Optional callback for download progress (loaded, total bytes)
 */
export function loadFullEntityFilter(
  onProgress?: ProgressCallback,
): Promise<AddressFilter | null> {
  if (fullFilterInstance) return Promise.resolve(fullFilterInstance);
  if (fullFilterStatus === "error" || fullFilterStatus === "unavailable") {
    return Promise.resolve(null);
  }
  // Concurrent callers share the in-flight download; each gets progress.
  if (onProgress) fullProgressListeners.add(onProgress);
  return (fullPromise ??= loadFull());
}

async function loadFull(): Promise<AddressFilter | null> {
  const generation = fullGeneration;
  const stale = () => generation !== fullGeneration;
  fullFilterStatus = "loading";

  try {
    // Download both files concurrently with merged progress
    let indexLoaded = 0, indexTotal = 0;
    let bloomLoaded = 0, bloomTotal = 0;

    const reportProgress = () => {
      // Only report a real total when both content-lengths are known
      if (stale()) return;
      const totalKnown = indexTotal > 0 && bloomTotal > 0;
      for (const listener of fullProgressListeners) {
        listener(indexLoaded + bloomLoaded, totalKnown ? indexTotal + bloomTotal : 0);
      }
    };

    const [indexBuffer, bloomBuffer] = await Promise.all([
      fetchArrayBuffer(FULL_INDEX_PATH, (loaded, total) => {
        indexLoaded = loaded;
        indexTotal = total;
        reportProgress();
      }),
      fetchArrayBuffer(FULL_BLOOM_PATH, (loaded, total) => {
        bloomLoaded = loaded;
        bloomTotal = total;
        reportProgress();
      }),
    ]);

    // Superseded by an update: hand callers the newer load's result instead.
    if (stale()) return loadFullEntityFilter();

    if (!indexBuffer) {
      fullFilterStatus = "unavailable";
      return null;
    }

    const fullIndex = parseEntityIndex(indexBuffer);
    if (!fullIndex) {
      fullFilterStatus = "unavailable";
      return null;
    }

    // Parse overflow Bloom filter
    let overflowBloom: AddressFilter | undefined;
    if (bloomBuffer) {
      const parsed = parseHeader(bloomBuffer);
      if (parsed && parsed.version === 2) {
        overflowBloom = parseBloomFilter(bloomBuffer, parsed.meta) ?? undefined;
      }
    }

    // Replace entity index with full version
    setEntityIndex(fullIndex);

    // Create combined filter (index + optional overflow Bloom)
    fullFilterInstance = createIndexBackedFilter(fullIndex, overflowBloom);
    fullFilterStatus = "ready";
    return fullFilterInstance;
  } catch {
    if (stale()) return loadFullEntityFilter();
    fullFilterStatus = "error";
    return null;
  } finally {
    if (!stale()) fullProgressListeners.clear();
  }
}

// ───────────────── Data update check ─────────────────

/**
 * Check if the server has newer full entity data than what's cached.
 * Delegates to data-updater module.
 */
export const checkForFullDataUpdate = checkForFullDataUpdateImpl;

/**
 * Force re-download of full entity data (clears cache, re-fetches).
 * Called when user clicks "Update to latest database".
 */
export async function updateFullEntityData(
  onProgress?: ProgressCallback,
): Promise<AddressFilter | null> {
  return updateFullEntityDataImpl(
    () => {
      fullGeneration++;
      fullProgressListeners.clear();
      fullFilterInstance = null;
      fullFilterStatus = "idle";
      fullPromise = null;
    },
    loadFullEntityFilter,
    onProgress,
  );
}
