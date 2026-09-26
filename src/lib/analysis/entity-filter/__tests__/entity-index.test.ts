import { describe, it, expect, afterEach } from "vitest";
import {
  fnv1a,
  normalizeAddress,
  parseEntityIndex,
  setEntityIndex,
  lookupEntityName,
  lookupEntityCategory,
  createIndexBackedFilter,
} from "../entity-index";
import type { AddressFilter } from "../types";
import { buildEidx } from "./binary-fixtures";

const A1 = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const A2 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const A3 = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const MISSING = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

const SAMPLE = () =>
  buildEidx({
    names: [["Alpha Exchange", 0], ["Beta Market", 1], ["Gamma Pool", 5]],
    entries: [[A1, 0], [A2, 1], [A3, 2]],
  });

afterEach(() => setEntityIndex(null));

describe("fnv1a / normalizeAddress", () => {
  it("matches the FNV-1a 32-bit reference vectors with the standard offset basis", () => {
    expect(fnv1a("", 0x811c9dc5)).toBe(0x811c9dc5);
    expect(fnv1a("a", 0x811c9dc5)).toBe(0xe40c292c);
    expect(fnv1a("foobar", 0x811c9dc5)).toBe(0xbf9cf968);
  });

  it("lowercases bech32 addresses only", () => {
    expect(normalizeAddress("BC1QABC")).toBe("BC1QABC"); // uppercase prefix not matched
    expect(normalizeAddress("bc1QAbC")).toBe("bc1qabc");
    expect(normalizeAddress("tb1QX")).toBe("tb1qx");
    expect(normalizeAddress(A1)).toBe(A1);
  });
});

describe("parseEntityIndex", () => {
  it("parses a valid v2 index with names, category bytes and sorted records", () => {
    const idx = parseEntityIndex(SAMPLE());
    expect(idx).not.toBeNull();
    expect(idx!.names).toEqual(["Alpha Exchange", "Beta Market", "Gamma Pool"]);
    expect(idx!.categories).toEqual(["exchange", "darknet", "mining"]);
    expect(idx!.hashes).toHaveLength(3);
    expect(idx!.hashSeed).toBe(0x811c9dc5);
    const h = [...idx!.hashes];
    expect(h).toEqual([...h].sort((a, b) => a - b));
  });

  it("accepts duplicate hashes (one address under two entity ids)", () => {
    // Production indexes contain such duplicates: sorted order is non-decreasing, not strict
    const idx = parseEntityIndex(
      buildEidx({ names: [["Alpha Exchange", 0], ["Beta Market", 1]], entries: [[A1, 0], [A1, 1], [A2, 1]] }),
    );
    expect(idx).not.toBeNull();
    expect(idx!.hashes).toHaveLength(3);
  });

  it("parses v1 (no category bytes) with exchange fallback", () => {
    const idx = parseEntityIndex(
      buildEidx({ version: 1, names: [["Old", 0], ["Older", 0]], entries: [[A1, 1]] }),
    );
    expect(idx!.names).toEqual(["Old", "Older"]);
    expect(idx!.categories).toEqual(["exchange", "exchange"]);
    expect([...idx!.entityIds]).toEqual([1]);
  });

  it("maps out-of-range category bytes to exchange", () => {
    const idx = parseEntityIndex(buildEidx({ names: [["X", 200]], entries: [] }));
    expect(idx!.categories).toEqual(["exchange"]);
  });

  it("decodes UTF-8 names", () => {
    const idx = parseEntityIndex(buildEidx({ names: [["Börse 交易所", 0]], entries: [] }));
    expect(idx!.names).toEqual(["Börse 交易所"]);
  });

  it("rejects buffers shorter than the header", () => {
    expect(parseEntityIndex(new ArrayBuffer(0))).toBeNull();
    expect(parseEntityIndex(SAMPLE().slice(0, 19))).toBeNull();
  });

  it("rejects bad magic and unknown versions", () => {
    const bad = new Uint8Array(SAMPLE());
    bad[0] = 0x00;
    expect(parseEntityIndex(bad.buffer)).toBeNull();
    expect(parseEntityIndex(buildEidx({ version: 3, names: [], entries: [] }))).toBeNull();
    expect(parseEntityIndex(buildEidx({ version: 0, names: [], entries: [] }))).toBeNull();
  });

  it("returns null (does not throw) when the record section is truncated", () => {
    const full = SAMPLE();
    for (const cut of [1, 3, 6, 7, 17]) {
      expect(() => parseEntityIndex(full.slice(0, full.byteLength - cut))).not.toThrow();
      expect(parseEntityIndex(full.slice(0, full.byteLength - cut))).toBeNull();
    }
  });

  it("returns null when the name table is truncated", () => {
    // Header + first name only partially present
    const full = SAMPLE();
    expect(parseEntityIndex(full.slice(0, 20 + 5))).toBeNull();
    // Name present but its v2 category byte missing
    const oneName = buildEidx({ names: [["Abc", 0]], entries: [] });
    expect(parseEntityIndex(oneName.slice(0, oneName.byteLength - 1))).toBeNull();
  });

  it("returns null for a garbage entryCount without allocating a huge array", () => {
    const buf = buildEidx({ names: [["X", 0]], entries: [[A1, 0]], entryCount: 0xffffffff });
    expect(() => parseEntityIndex(buf)).not.toThrow();
    expect(parseEntityIndex(buf)).toBeNull();
  });

  it("returns null when records are not sorted by hash (binary search would miss)", () => {
    // Find an ordering that is guaranteed unsorted
    const entries: Array<[string, number]> = [[A1, 0], [A2, 1], [A3, 2]];
    const seed = 0x811c9dc5;
    entries.sort((a, b) => fnv1a(normalizeAddress(b[0]), seed) - fnv1a(normalizeAddress(a[0]), seed));
    const buf = buildEidx({ names: [["X", 0], ["Y", 0], ["Z", 0]], entries, unsorted: true });
    expect(parseEntityIndex(buf)).toBeNull();
  });

  it("does not throw on random garbage behind a valid magic", () => {
    let s = 42;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) & 0xff);
    for (let trial = 0; trial < 200; trial++) {
      const bytes = new Uint8Array(20 + (trial % 64));
      for (let i = 0; i < bytes.length; i++) bytes[i] = rnd();
      bytes.set([0x45, 0x49, 0x44, 0x58]);
      bytes[4] = 1 + (trial % 2);
      bytes[5] = bytes[6] = bytes[7] = 0;
      expect(() => parseEntityIndex(bytes.buffer)).not.toThrow();
    }
  });
});

describe("entity index lookups", () => {
  it("returns null for every lookup when no index is set", () => {
    expect(lookupEntityName(A1)).toBeNull();
    expect(lookupEntityCategory(A1)).toBeNull();
  });

  it("resolves names and categories for indexed addresses", () => {
    setEntityIndex(parseEntityIndex(SAMPLE()));
    expect(lookupEntityName(A1)).toBe("Alpha Exchange");
    expect(lookupEntityCategory(A1)).toBe("exchange");
    expect(lookupEntityName(A3)).toBe("Gamma Pool");
    expect(lookupEntityCategory(A3)).toBe("mining");
    expect(lookupEntityName(MISSING)).toBeNull();
    expect(lookupEntityCategory(MISSING)).toBeNull();
  });

  it("matches bech32 addresses case-insensitively", () => {
    setEntityIndex(parseEntityIndex(SAMPLE()));
    expect(lookupEntityName("bc1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ")).toBe("Beta Market");
    expect(lookupEntityCategory(A2)).toBe("darknet");
  });

  it("returns null name for an entity id outside the name table", () => {
    setEntityIndex(parseEntityIndex(buildEidx({ names: [["Only", 0]], entries: [[A1, 7]] })));
    expect(lookupEntityName(A1)).toBeNull();
    expect(lookupEntityCategory(A1)).toBeNull();
  });
});

describe("createIndexBackedFilter", () => {
  it("checks membership by binary search and reports index size", () => {
    const f = createIndexBackedFilter(parseEntityIndex(SAMPLE())!);
    expect(f.has(A1)).toBe(true);
    expect(f.has(A2.toUpperCase().replace("BC1", "bc1"))).toBe(true);
    expect(f.has(A3)).toBe(true);
    expect(f.has(MISSING)).toBe(false);
    expect(f.meta).toEqual({ version: 1, addressCount: 3, fpr: 0, buildDate: "" });
  });

  it("works on an empty index", () => {
    const f = createIndexBackedFilter(parseEntityIndex(buildEidx({ names: [], entries: [] }))!);
    expect(f.has(A1)).toBe(false);
    expect(f.meta.addressCount).toBe(0);
  });

  it("falls back to the overflow filter and merges its metadata", () => {
    const seen: string[] = [];
    const overflow: AddressFilter = {
      has: (a) => (seen.push(a), a === MISSING),
      meta: { version: 2, addressCount: 10, fpr: 0.001, buildDate: "2026-01-01" },
    };
    const f = createIndexBackedFilter(parseEntityIndex(SAMPLE())!, overflow);
    expect(f.has(A1)).toBe(true);
    expect(seen).toEqual([]); // index hit short-circuits the Bloom
    expect(f.has(MISSING)).toBe(true);
    expect(f.has("1CounterpartyXXXXXXXXXXXXXXXUWLpVr")).toBe(false);
    expect(f.meta).toEqual({ version: 1, addressCount: 13, fpr: 0.001, buildDate: "2026-01-01" });
  });
});
