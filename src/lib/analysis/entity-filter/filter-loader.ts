import type { AddressFilter, FilterStatus, FilterMeta } from "./types";

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

let filterInstance: AddressFilter | null = null;
let filterStatus: FilterStatus = "idle";
let filterError: string | null = null;

let fullFilterInstance: AddressFilter | null = null;
let fullFilterStatus: FilterStatus = "idle";

const CORE_INDEX_PATH = "/data/entity-index.bin";
const FULL_INDEX_PATH = "/data/entity-index-full.bin";
const FULL_BLOOM_PATH = "/data/entity-filter-full.bin";

// ───────────────── Entity name index ─────────────────

/** Category byte -> EntityCategory string. Must match build script CATEGORY_BYTE. */
const CATEGORY_FROM_BYTE = [
  "exchange", "darknet", "scam", "gambling",
  "payment", "mining", "mixer", "p2p", "unknown",
] as const;

interface EntityIndex {
  names: string[];
  categories: string[];
  hashes: Uint32Array;
  entityIds: Uint16Array;
  hashSeed: number;
}

let entityIndexInstance: EntityIndex | null = null;

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

// ───────────────── Hash and parse helpers ─────────────────

/**
 * FNV-1a 32-bit hash with configurable seed.
 * Must match the build script implementation exactly.
 */
function fnv1a(key: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Normalize a Bitcoin address for filter lookup.
 * BIP-173: bech32 addresses are case-insensitive, stored lowercase.
 */
function normalizeAddress(address: string): string {
  if (address.startsWith("bc1") || address.startsWith("tb1")) {
    return address.toLowerCase();
  }
  return address;
}

/**
 * Binary search a sorted Uint32Array for a target value.
 * Returns true if found.
 */
function binarySearchHashes(hashes: Uint32Array, target: number): boolean {
  let lo = 0;
  let hi = hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midVal = hashes[mid];
    if (midVal === target) return true;
    if (midVal < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Parse filter header from an ArrayBuffer (Bloom filter binary format v2).
 * Returns null if the buffer is too small or the version is unsupported.
 */
function parseHeader(buffer: ArrayBuffer): {
  version: number;
  meta: FilterMeta;
} | null {
  if (buffer.byteLength < 32) return null;

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
 */
function parseBloomFilter(
  buffer: ArrayBuffer,
  meta: FilterMeta,
): AddressFilter {
  const bloomView = new DataView(buffer, 32, 16);
  const bloomM = bloomView.getUint32(0, true);
  const bloomK = bloomView.getUint32(4, true);
  const seed1 = bloomView.getUint32(8, true);
  const seed2 = bloomView.getUint32(12, true);

  const bits = new Uint8Array(buffer, 48);

  return {
    has(address: string): boolean {
      const normalized = normalizeAddress(address);
      const h1 = fnv1a(normalized, seed1);
      const h2 = fnv1a(normalized, seed2);

      for (let i = 0; i < bloomK; i++) {
        const pos = (h1 + i * h2) % bloomM;
        if (!(bits[pos >> 3] & (1 << (pos & 7)))) return false;
      }
      return true;
    },
    meta,
  };
}

// ───────────────── Entity index parser ─────────────────

/**
 * Parse an entity name index binary (format v1 or v2).
 *
 * Header (20 bytes): magic("EIDX",4) version(4) entryCount(4) nameCount(2) hashSeed(4) reserved(2)
 * Name table:
 *   v1: for each name: length(1) + UTF-8 bytes
 *   v2: for each name: length(1) + UTF-8 bytes + category(1)
 * Sorted index: for each entry: hash(4,LE) + entityId(2,LE)
 */
function parseEntityIndex(buffer: ArrayBuffer): EntityIndex | null {
  if (buffer.byteLength < 20) return null;

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Check magic "EIDX"
  if (bytes[0] !== 0x45 || bytes[1] !== 0x49 || bytes[2] !== 0x44 || bytes[3] !== 0x58) return null;

  const version = view.getUint32(4, true);
  if (version !== 1 && version !== 2) return null;

  const entryCount = view.getUint32(8, true);
  const nameCount = view.getUint16(12, true);
  const hashSeed = view.getUint32(14, true);

  // Parse name table
  const names: string[] = [];
  const categories: string[] = [];
  const decoder = new TextDecoder();
  let offset = 20;
  for (let i = 0; i < nameCount; i++) {
    if (offset >= buffer.byteLength) return null;
    const len = bytes[offset];
    offset++;
    names.push(decoder.decode(bytes.slice(offset, offset + len)));
    offset += len;
    if (version >= 2) {
      // v2: category byte follows the name
      const catByte = bytes[offset] ?? 0;
      categories.push(CATEGORY_FROM_BYTE[catByte] ?? "exchange");
      offset++;
    } else {
      categories.push("exchange"); // v1 fallback
    }
  }

  // Parse sorted index entries into typed arrays for fast binary search
  const hashes = new Uint32Array(entryCount);
  const entityIds = new Uint16Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    hashes[i] = view.getUint32(offset, true);
    entityIds[i] = view.getUint16(offset + 4, true);
    offset += 6;
  }

  return { names, categories, hashes, entityIds, hashSeed };
}

/**
 * Binary search the entity index for a given address hash.
 * Returns the entity ID index, or -1 if not found.
 */
function searchEntityIndex(address: string): number {
  if (!entityIndexInstance) return -1;

  const { hashes, entityIds, hashSeed } = entityIndexInstance;
  const hash = fnv1a(normalizeAddress(address), hashSeed);

  let lo = 0;
  let hi = hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midHash = hashes[mid];
    if (midHash === hash) return entityIds[mid];
    if (midHash < hash) lo = mid + 1;
    else hi = mid - 1;
  }

  return -1;
}

/**
 * Look up an entity name for a given address using the entity index.
 * Returns the canonical entity name, or null if not found or index not loaded.
 */
export function lookupEntityName(address: string): string | null {
  const eid = searchEntityIndex(address);
  if (eid < 0 || !entityIndexInstance) return null;
  return eid < entityIndexInstance.names.length ? entityIndexInstance.names[eid] : null;
}

/**
 * Look up the category for a given address using the entity index.
 * Returns "exchange", "mining", "gambling", etc., or null if not found.
 */
export function lookupEntityCategory(address: string): string | null {
  const eid = searchEntityIndex(address);
  if (eid < 0 || !entityIndexInstance) return null;
  return eid < entityIndexInstance.categories.length ? entityIndexInstance.categories[eid] : null;
}

// ───────────────── Index-backed filter ─────────────────

/**
 * Create an AddressFilter backed by a sorted entity index.
 * Optionally includes an overflow Bloom filter for addresses not in the index.
 *
 * For core: wraps entity index only (1M addresses, all named).
 * For full: wraps full index (10M named) + overflow Bloom (20M boolean).
 */
function createIndexBackedFilter(
  index: EntityIndex,
  overflowBloom?: AddressFilter,
): AddressFilter {
  const addressCount = index.hashes.length + (overflowBloom?.meta.addressCount ?? 0);
  return {
    has(address: string): boolean {
      const normalized = normalizeAddress(address);
      const hash = fnv1a(normalized, index.hashSeed);
      // Check index first (binary search on sorted hashes)
      if (binarySearchHashes(index.hashes, hash)) return true;
      // Fall back to overflow Bloom (no name, just "Known entity")
      return overflowBloom?.has(address) ?? false;
    },
    meta: {
      version: 1,
      addressCount,
      fpr: overflowBloom?.meta.fpr ?? 0,
      buildDate: overflowBloom?.meta.buildDate ?? "",
    },
  };
}

// ───────────────── Streaming fetch helper ─────────────────

/** Progress callback: received bytes and total bytes (0 if unknown). */
export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Fetch a binary file with optional streaming progress.
 * Returns the ArrayBuffer, or null on failure.
 */
async function fetchArrayBuffer(
  path: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer | null> {
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
 * Safe to call multiple times - only loads once.
 */
export async function loadEntityFilter(): Promise<AddressFilter | null> {
  if (filterInstance) return filterInstance;
  if (filterStatus === "loading") return null;
  if (filterStatus === "error" || filterStatus === "unavailable") return null;

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

    // Set entity index for name lookups
    entityIndexInstance = index;

    // Create index-backed filter (no Bloom needed for core)
    filterInstance = createIndexBackedFilter(index);
    filterStatus = "ready";
    return filterInstance;
  } catch (err) {
    filterStatus = "error";
    filterError = err instanceof Error ? err.message : "Failed to load filter";
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
export async function loadFullEntityFilter(
  onProgress?: ProgressCallback,
): Promise<AddressFilter | null> {
  if (fullFilterInstance) return fullFilterInstance;
  if (fullFilterStatus === "loading") return null;
  if (fullFilterStatus === "error" || fullFilterStatus === "unavailable") {
    return null;
  }

  fullFilterStatus = "loading";

  try {
    // Phase 1: Download full entity index (with progress)
    // Report total=0 during file 1 so UI shows pulse animation instead of
    // a percentage that would jump backwards when file 2 starts.
    const indexBuffer = await fetchArrayBuffer(FULL_INDEX_PATH, (loaded) => {
      onProgress?.(loaded, 0);
    });

    if (!indexBuffer) {
      fullFilterStatus = "unavailable";
      return null;
    }

    const fullIndex = parseEntityIndex(indexBuffer);
    if (!fullIndex) {
      fullFilterStatus = "unavailable";
      return null;
    }

    const indexSize = indexBuffer.byteLength;

    // Phase 2: Download overflow Bloom filter (with accumulated progress)
    let overflowBloom: AddressFilter | undefined;

    const bloomBuffer = await fetchArrayBuffer(FULL_BLOOM_PATH, (loaded, total) => {
      onProgress?.(indexSize + loaded, indexSize + total);
    });

    if (bloomBuffer) {
      const parsed = parseHeader(bloomBuffer);
      if (parsed && parsed.version === 2) {
        overflowBloom = parseBloomFilter(bloomBuffer, parsed.meta);
      }
    }

    // Replace entity index with full version
    entityIndexInstance = fullIndex;

    // Create combined filter (index + optional overflow Bloom)
    fullFilterInstance = createIndexBackedFilter(fullIndex, overflowBloom);
    fullFilterStatus = "ready";
    return fullFilterInstance;
  } catch {
    fullFilterStatus = "error";
    return null;
  }
}

/**
 * Get the filter error message, if any.
 */
export function getFilterError(): string | null {
  return filterError;
}
