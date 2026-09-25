/**
 * matchEntitySync against the real filter-loader state: not loaded,
 * index hit, overflow Bloom hit, and OFAC precedence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEidx, buildBloom } from "./binary-fixtures";

const OFAC_ADDR = "12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h"; // Hydra market, from ofac-addresses.json
const INDEX_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BLOOM_ADDR = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const UNKNOWN = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

let loader: typeof import("../filter-loader");
let match: typeof import("../entity-match");

beforeEach(async () => {
  vi.resetModules();
  loader = await import("../filter-loader");
  match = await import("../entity-match");
});

afterEach(() => vi.unstubAllGlobals());

async function loadFull() {
  const files: Record<string, ArrayBuffer> = {
    "/data/entity-index-full.bin": buildEidx({
      names: [["Zz Test Casino", 3], ["Zz Test Pool", 5]],
      entries: [[INDEX_ADDR, 0], [OFAC_ADDR, 1]],
    }),
    "/data/entity-filter-full.bin": buildBloom({ addresses: [BLOOM_ADDR], m: 1 << 16, k: 7 }),
  };
  loader.configureDataLoader({ fetchFn: (p) => Promise.resolve(files[p] ?? null) });
  expect(await loader.loadFullEntityFilter()).not.toBeNull();
}

describe("matchEntitySync without a loaded filter", () => {
  it("returns null for a non-sanctioned address and does not trigger a load", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(match.matchEntitySync(INDEX_ADDR)).toBeNull();
    expect(match.matchEntitySync(UNKNOWN)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loader.getFilterStatus()).toBe("idle");
  });

  it("still flags OFAC addresses from the bundled list", () => {
    const m = match.matchEntitySync(OFAC_ADDR);
    expect(m).toMatchObject({ address: OFAC_ADDR, ofac: true, confidence: "high" });
    expect(m!.entityName.length).toBeGreaterThan(0);
  });
});

describe("matchEntitySync with the full filter loaded", () => {
  it("names index hits with their category at high confidence", async () => {
    await loadFull();
    expect(match.matchEntitySync(INDEX_ADDR)).toEqual({
      address: INDEX_ADDR,
      entityName: "Zz Test Casino",
      category: "gambling",
      ofac: false,
      confidence: "high",
    });
  });

  it("reports Bloom-only hits as an unnamed known entity at medium confidence", async () => {
    await loadFull();
    expect(match.matchEntitySync(BLOOM_ADDR)).toEqual({
      address: BLOOM_ADDR,
      entityName: "Known Entity",
      category: "unknown",
      ofac: false,
      confidence: "medium",
    });
  });

  it("returns null for addresses in neither the index nor the Bloom", async () => {
    await loadFull();
    expect(match.matchEntitySync(UNKNOWN)).toBeNull();
  });

  it("keeps ofac=true and uses the index name for sanctioned addresses", async () => {
    await loadFull();
    expect(match.matchEntitySync(OFAC_ADDR)).toMatchObject({
      entityName: "Zz Test Pool",
      category: "mining",
      ofac: true,
      confidence: "high",
    });
  });
});
