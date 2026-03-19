/**
 * Entity index parsing, binary search, and name/category lookups.
 *
 * The entity index is a compact binary format (EIDX) that stores
 * address hashes sorted for fast binary search, paired with entity IDs
 * that reference a name table. This module handles all index-related logic
 * extracted from filter-loader.ts.
 */

import type { AddressFilter } from "./types";

/** Category byte -> EntityCategory string. Must match build script CATEGORY_BYTE. */
const CATEGORY_FROM_BYTE = [
  "exchange", "darknet", "scam", "gambling",
  "payment", "mining", "mixer", "p2p", "unknown",
] as const;

export interface EntityIndex {
  names: string[];
  categories: string[];
  hashes: Uint32Array;
  entityIds: Uint16Array;
  hashSeed: number;
}

let entityIndexInstance: EntityIndex | null = null;

// ───────────────── Hash and address helpers ─────────────────

/**
 * FNV-1a 32-bit hash with configurable seed.
 * Must match the build script implementation exactly.
 */
export function fnv1a(key: string, seed: number): number {
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
export function normalizeAddress(address: string): string {
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
export function parseEntityIndex(buffer: ArrayBuffer): EntityIndex | null {
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

// ───────────────── Entity index state ─────────────────

/**
 * Set the active entity index instance.
 * Called by filter-loader when core or full index is loaded.
 */
export function setEntityIndex(index: EntityIndex | null): void {
  entityIndexInstance = index;
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
export function createIndexBackedFilter(
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
