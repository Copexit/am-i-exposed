import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEidx, buildBloom } from "./binary-fixtures";

type Loader = typeof import("../filter-loader");

const CORE = "/data/entity-index.bin";
const FULL_INDEX = "/data/entity-index-full.bin";
const FULL_BLOOM = "/data/entity-filter-full.bin";

const CORE_ADDR = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const FULL_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BLOOM_ADDR = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const MISSING = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

const coreBin = () => buildEidx({ names: [["Core Exchange", 0]], entries: [[CORE_ADDR, 0]] });
const fullBin = () =>
  buildEidx({
    names: [["Core Exchange", 0], ["Full Market", 1]],
    entries: [[CORE_ADDR, 0], [FULL_ADDR, 1]],
  });
const bloomBin = () => buildBloom({ addresses: [BLOOM_ADDR], m: 1 << 16, k: 7 });

/** A file served by the fake fetch: bytes, an HTTP error status, or a thrown error. */
type Served = ArrayBuffer | number | Error;

function respond(served: Served | undefined, withLength: boolean): Response {
  if (served === undefined) return new Response(null, { status: 404 });
  if (typeof served === "number") return new Response(null, { status: served });
  if (served instanceof Error) throw served;
  const bytes = new Uint8Array(served);
  // Two chunks so streamed progress reports more than once
  const mid = bytes.length >> 1;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, mid));
      c.enqueue(bytes.slice(mid));
      c.close();
    },
  });
  const headers = withLength ? { "content-length": String(bytes.length) } : undefined;
  return new Response(body, { status: 200, headers });
}

let files: Record<string, Served>;
let noLength: Set<string>;
let fetchMock: ReturnType<typeof vi.fn<(path: string) => Promise<Response>>>;
let L: Loader;

beforeEach(async () => {
  vi.resetModules();
  files = {};
  noLength = new Set();
  fetchMock = vi.fn((path: string) =>
    Promise.resolve().then(() => respond(files[path], !noLength.has(path))),
  );
  vi.stubGlobal("fetch", fetchMock);
  L = await import("../filter-loader");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fetchCount = (path: string) => fetchMock.mock.calls.filter(([p]) => p === path).length;

describe("loadEntityFilter (core)", () => {
  it("starts idle with no filter and no lookups", () => {
    expect(L.getFilterStatus()).toBe("idle");
    expect(L.getFilter()).toBeNull();
    expect(L.lookupEntityName(CORE_ADDR)).toBeNull();
  });

  it("loads the core index, goes loading -> ready, and serves lookups", async () => {
    files[CORE] = coreBin();
    const p = L.loadEntityFilter();
    expect(L.getFilterStatus()).toBe("loading");
    const f = await p;
    expect(L.getFilterStatus()).toBe("ready");
    expect(f).not.toBeNull();
    expect(L.getFilter()).toBe(f);
    expect(f!.has(CORE_ADDR)).toBe(true);
    expect(f!.has(MISSING)).toBe(false);
    expect(L.lookupEntityName(CORE_ADDR)).toBe("Core Exchange");
    expect(L.lookupEntityCategory(CORE_ADDR)).toBe("exchange");
    expect(L.isFullFilterLoaded()).toBe(false);
  });

  it("returns the cached instance on later calls without refetching", async () => {
    files[CORE] = coreBin();
    const a = await L.loadEntityFilter();
    const b = await L.loadEntityFilter();
    expect(b).toBe(a);
    expect(fetchCount(CORE)).toBe(1);
  });

  it("dedups concurrent loads: every caller gets the filter from one fetch", async () => {
    files[CORE] = coreBin();
    const [a, b, c] = await Promise.all([
      L.loadEntityFilter(),
      L.loadEntityFilter(),
      L.loadEntityFilter(),
    ]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchCount(CORE)).toBe(1);
  });

  it("marks unavailable on HTTP failure and does not retry", async () => {
    files[CORE] = 404;
    expect(await L.loadEntityFilter()).toBeNull();
    expect(L.getFilterStatus()).toBe("unavailable");
    expect(await L.loadEntityFilter()).toBeNull();
    expect(fetchCount(CORE)).toBe(1);
  });

  it("marks unavailable on a corrupt index", async () => {
    files[CORE] = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]).buffer;
    expect(await L.loadEntityFilter()).toBeNull();
    expect(L.getFilterStatus()).toBe("unavailable");
    expect(L.getFilter()).toBeNull();
  });

  it("marks unavailable on a truncated index", async () => {
    const full = coreBin();
    files[CORE] = full.slice(0, full.byteLength - 2);
    expect(await L.loadEntityFilter()).toBeNull();
    expect(L.getFilterStatus()).toBe("unavailable");
  });

  it("marks error when fetch rejects (network failure or abort)", async () => {
    files[CORE] = new DOMException("The operation was aborted.", "AbortError") as Error;
    expect(await L.loadEntityFilter()).toBeNull();
    expect(L.getFilterStatus()).toBe("error");
    expect(L.getFilter()).toBeNull();
  });

  it("retries on the next call after a transient network error", async () => {
    files[CORE] = new TypeError("Failed to fetch");
    expect(await L.loadEntityFilter()).toBeNull();
    expect(L.getFilterStatus()).toBe("error");

    files[CORE] = coreBin();
    const f = await L.loadEntityFilter();
    expect(f).not.toBeNull();
    expect(f!.has(CORE_ADDR)).toBe(true);
    expect(L.getFilterStatus()).toBe("ready");
    expect(fetchCount(CORE)).toBe(2);
  });

  it("uses a configured data loader instead of fetch", async () => {
    const fetchFn = vi.fn((path: string) => Promise.resolve(path === CORE ? coreBin() : null));
    L.configureDataLoader({ fetchFn });
    const f = await L.loadEntityFilter();
    expect(f!.has(CORE_ADDR)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(CORE, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadFullEntityFilter", () => {
  it("loads index + overflow Bloom and replaces the core filter", async () => {
    files[CORE] = coreBin();
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    const core = await L.loadEntityFilter();
    const full = await L.loadFullEntityFilter();

    expect(L.getFullFilterStatus()).toBe("ready");
    expect(L.isFullFilterLoaded()).toBe(true);
    expect(L.getFilter()).toBe(full);
    expect(full).not.toBe(core);
    expect(full!.has(FULL_ADDR)).toBe(true);
    expect(full!.has(BLOOM_ADDR)).toBe(true); // overflow Bloom hit
    expect(full!.has(MISSING)).toBe(false);
    expect(L.lookupEntityName(FULL_ADDR)).toBe("Full Market");
    expect(L.lookupEntityCategory(FULL_ADDR)).toBe("darknet");
    expect(L.lookupEntityName(BLOOM_ADDR)).toBeNull(); // Bloom carries no name
    expect(full!.meta.addressCount).toBe(3);
    expect(full!.meta.buildDate).toBe("2026-01-01");
    expect(full!.meta.fpr).toBe(0.001);
  });

  it("reports merged streaming progress with a total only when both lengths are known", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    const calls: Array<[number, number]> = [];
    await L.loadFullEntityFilter((l, t) => calls.push([l, t]));
    const total = fullBin().byteLength + bloomBin().byteLength;
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.at(-1)).toEqual([total, total]);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
    }
  });

  it("reports total 0 when a content-length is missing", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    noLength.add(FULL_BLOOM);
    const calls: Array<[number, number]> = [];
    await L.loadFullEntityFilter((l, t) => calls.push([l, t]));
    expect(calls.every(([, t]) => t === 0)).toBe(true);
    expect(calls.at(-1)![0]).toBe(fullBin().byteLength + bloomBin().byteLength);
  });

  it("still loads the index when the Bloom file is missing", async () => {
    files[FULL_INDEX] = fullBin();
    const f = await L.loadFullEntityFilter();
    expect(L.getFullFilterStatus()).toBe("ready");
    expect(f!.has(FULL_ADDR)).toBe(true);
    expect(f!.has(BLOOM_ADDR)).toBe(false);
    expect(f!.meta.addressCount).toBe(2);
  });

  it("ignores a Bloom file with an unsupported version", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = buildBloom({ addresses: [BLOOM_ADDR], version: 1 });
    const f = await L.loadFullEntityFilter();
    expect(f!.has(BLOOM_ADDR)).toBe(false);
    expect(f!.meta.addressCount).toBe(2);
  });

  it("ignores a truncated Bloom header instead of failing the whole load", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin().slice(0, 40); // header ok, params cut off
    const f = await L.loadFullEntityFilter();
    expect(L.getFullFilterStatus()).toBe("ready");
    expect(f!.has(FULL_ADDR)).toBe(true);
    expect(f!.has(BLOOM_ADDR)).toBe(false);
  });

  it("treats bits past the end of a truncated Bloom as unset", async () => {
    files[FULL_INDEX] = fullBin();
    // Keep only the first 16 bytes of bits, all set: every in-range read hits,
    // so the lookup can only fail on the (unset) positions past the end.
    const truncated = new Uint8Array(bloomBin().slice(0, 48 + 16));
    truncated.fill(0xff, 48);
    files[FULL_BLOOM] = truncated.buffer;
    const f = await L.loadFullEntityFilter();
    expect(f!.has(BLOOM_ADDR)).toBe(false);
  });

  it.each([
    ["k = 0", { m: 1 << 16, k: 0 }],
    ["m = 0", { m: 0, k: 7 }],
  ])("ignores a Bloom file with %s instead of matching everything", async (_, params) => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = buildBloom({ addresses: [BLOOM_ADDR], addressCount: 1000, ...params });
    const f = await L.loadFullEntityFilter();
    expect(L.getFullFilterStatus()).toBe("ready");
    expect(f!.has(FULL_ADDR)).toBe(true);
    expect(f!.has(MISSING)).toBe(false);
    expect(f!.meta.addressCount).toBe(2);
  });

  it("marks unavailable when the full index is missing, keeping the core filter", async () => {
    files[CORE] = coreBin();
    files[FULL_BLOOM] = bloomBin();
    const core = await L.loadEntityFilter();
    expect(await L.loadFullEntityFilter()).toBeNull();
    expect(L.getFullFilterStatus()).toBe("unavailable");
    expect(L.getFilter()).toBe(core);
    expect(L.lookupEntityName(CORE_ADDR)).toBe("Core Exchange");
  });

  it("marks unavailable when the full index is corrupt", async () => {
    files[FULL_INDEX] = new ArrayBuffer(25);
    expect(await L.loadFullEntityFilter()).toBeNull();
    expect(L.getFullFilterStatus()).toBe("unavailable");
  });

  it("marks error when a download rejects", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = new TypeError("Failed to fetch");
    expect(await L.loadFullEntityFilter()).toBeNull();
    expect(L.getFullFilterStatus()).toBe("error");
    expect(L.isFullFilterLoaded()).toBe(false);
  });

  it("dedups concurrent full loads", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    const [a, b] = await Promise.all([L.loadFullEntityFilter(), L.loadFullEntityFilter()]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(fetchCount(FULL_INDEX)).toBe(1);
  });

  it("fans progress out to a second caller that joins an in-flight download", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    const first = vi.fn();
    const second = vi.fn();
    const [a, b] = await Promise.all([L.loadFullEntityFilter(first), L.loadFullEntityFilter(second)]);
    expect(b).toBe(a);
    const total = fullBin().byteLength + bloomBin().byteLength;
    expect(first).toHaveBeenLastCalledWith(total, total);
    expect(second).toHaveBeenLastCalledWith(total, total);
  });

  it("keeps full-index names when the core load finishes after the full load", async () => {
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    let releaseCore!: () => void;
    const coreGate = new Promise<void>((r) => (releaseCore = r));
    fetchMock.mockImplementation((path: string) =>
      path === CORE
        ? coreGate.then(() => respond(coreBin(), true))
        : Promise.resolve().then(() => respond(files[path], true)),
    );

    const coreP = L.loadEntityFilter();
    const full = await L.loadFullEntityFilter();
    releaseCore();
    await coreP;

    expect(L.getFilter()).toBe(full);
    expect(L.lookupEntityName(FULL_ADDR)).toBe("Full Market");
  });
});

describe("updateFullEntityData", () => {
  it("clears cached files, resets full state and re-downloads", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      open: vi.fn(() =>
        Promise.resolve({ delete: (p: string) => (deleted.push(p), Promise.resolve(true)) }),
      ),
    });
    files[FULL_INDEX] = fullBin();
    files[FULL_BLOOM] = bloomBin();
    const first = await L.loadFullEntityFilter();
    const progress = vi.fn();
    const second = await L.updateFullEntityData(progress);

    expect(deleted).toEqual([FULL_INDEX, FULL_BLOOM]);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(L.getFilter()).toBe(second);
    expect(fetchCount(FULL_INDEX)).toBe(2);
    expect(progress).toHaveBeenCalled();
  });

  it("an older in-flight download finishing late does not overwrite the update", async () => {
    const oldBin = buildEidx({ names: [["Old Market", 1]], entries: [[FULL_ADDR, 0]] });
    files[FULL_BLOOM] = bloomBin();
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((r) => (releaseOld = r));
    let indexCalls = 0;
    fetchMock.mockImplementation((path: string) => {
      if (path === FULL_INDEX && ++indexCalls === 1) return oldGate.then(() => respond(oldBin, true));
      const served = path === FULL_INDEX ? fullBin() : files[path];
      return Promise.resolve().then(() => respond(served, true));
    });
    const oldProgress = vi.fn();
    const oldP = L.loadFullEntityFilter(oldProgress);
    const updated = await L.updateFullEntityData();
    expect(L.lookupEntityName(FULL_ADDR)).toBe("Full Market");
    oldProgress.mockClear();

    releaseOld();
    const late = await oldP;
    expect(L.getFilter()).toBe(updated);
    expect(late).toBe(updated);
    expect(L.getFullFilterStatus()).toBe("ready");
    expect(L.lookupEntityName(FULL_ADDR)).toBe("Full Market");
    expect(oldProgress).not.toHaveBeenCalled();
  });

  it("recovers from a previous error state", async () => {
    files[FULL_INDEX] = new TypeError("offline");
    await L.loadFullEntityFilter();
    expect(L.getFullFilterStatus()).toBe("error");

    files[FULL_INDEX] = fullBin();
    // No Cache API in this environment: update must still proceed
    const f = await L.updateFullEntityData();
    expect(L.getFullFilterStatus()).toBe("ready");
    expect(f!.has(FULL_ADDR)).toBe(true);
  });
});
