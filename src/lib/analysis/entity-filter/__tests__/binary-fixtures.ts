/**
 * In-test builders for the entity filter binary formats (EIDX index and
 * v2 Bloom filter). Hashing uses the production fnv1a/normalizeAddress so
 * the fixtures match what the parser and lookups compute.
 */
import { fnv1a, normalizeAddress } from "../entity-index";

export interface EidxOptions {
  version?: number;
  seed?: number;
  /** [name, categoryByte] pairs; category byte is only written for v2. */
  names: Array<[string, number]>;
  /** [address, entityId] pairs. Sorted by hash unless `unsorted` is set. */
  entries: Array<[string, number]>;
  unsorted?: boolean;
  /** Override the entryCount header field (to simulate corrupt headers). */
  entryCount?: number;
}

export function buildEidx(opts: EidxOptions): ArrayBuffer {
  const version = opts.version ?? 2;
  const seed = opts.seed ?? 0x811c9dc5;
  const enc = new TextEncoder();
  const nameBytes = opts.names.map(([n]) => enc.encode(n));
  const nameTableLen = nameBytes.reduce(
    (s, b) => s + 1 + b.length + (version >= 2 ? 1 : 0),
    0,
  );

  const records = opts.entries.map(([addr, id]) => ({
    hash: fnv1a(normalizeAddress(addr), seed),
    id,
  }));
  if (!opts.unsorted) records.sort((a, b) => a.hash - b.hash);

  const buf = new ArrayBuffer(20 + nameTableLen + records.length * 6);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  bytes.set([0x45, 0x49, 0x44, 0x58]); // "EIDX"
  view.setUint32(4, version, true);
  view.setUint32(8, opts.entryCount ?? records.length, true);
  view.setUint16(12, opts.names.length, true);
  view.setUint32(14, seed, true);

  let off = 20;
  opts.names.forEach(([, cat], i) => {
    const b = nameBytes[i]!;
    bytes[off++] = b.length;
    bytes.set(b, off);
    off += b.length;
    if (version >= 2) bytes[off++] = cat;
  });
  for (const r of records) {
    view.setUint32(off, r.hash, true);
    view.setUint16(off + 4, r.id, true);
    off += 6;
  }
  return buf;
}

export interface BloomOptions {
  addresses: string[];
  m?: number;
  k?: number;
  seed1?: number;
  seed2?: number;
  version?: number;
  addressCount?: number;
  buildDate?: string;
}

/** Build a v2 Bloom filter binary (32-byte header + 16-byte params + bits). */
export function buildBloom(opts: BloomOptions): ArrayBuffer {
  const m = opts.m ?? 4096;
  const k = opts.k ?? 3;
  const seed1 = opts.seed1 ?? 0x12345678;
  const seed2 = opts.seed2 ?? 0x9abcdef0;
  const buf = new ArrayBuffer(48 + Math.ceil(m / 8));
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const date = new TextEncoder().encode(opts.buildDate ?? "2026-01-01");

  view.setUint32(0, opts.version ?? 2, true);
  view.setUint32(4, opts.addressCount ?? opts.addresses.length, true);
  view.setUint32(8, 1, true); // fpr * 1000
  view.setUint32(12, date.length, true);
  bytes.set(date, 16);
  view.setUint32(32, m, true);
  view.setUint32(36, k, true);
  view.setUint32(40, seed1, true);
  view.setUint32(44, seed2, true);

  const bits = new Uint8Array(buf, 48);
  for (const addr of opts.addresses) {
    const n = normalizeAddress(addr);
    const h1 = fnv1a(n, seed1);
    const h2 = fnv1a(n, seed2);
    for (let i = 0; i < k; i++) {
      const pos = (h1 + i * h2) % m;
      bits[pos >> 3]! |= 1 << (pos & 7);
    }
  }
  return buf;
}
