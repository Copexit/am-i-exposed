/**
 * Tests for CLI adapters - entity loader, API utilities.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { networkForApi, resolveApiUrl } from "../src/util/api";
import { DATA_DIR, WASM_DIR } from "../src/util/data-dir";
import type { GlobalOpts } from "../src/index";

describe("resolveApiUrl", () => {
  const baseOpts: GlobalOpts = {
    network: "mainnet",
    entities: true,
    color: true,
  };

  it("defaults to mainnet mempool.space", () => {
    expect(resolveApiUrl(baseOpts)).toBe("https://mempool.space/api");
  });

  it("resolves testnet4 URL", () => {
    expect(resolveApiUrl({ ...baseOpts, network: "testnet4" })).toBe(
      "https://mempool.space/testnet4/api",
    );
  });

  it("resolves signet URL", () => {
    expect(resolveApiUrl({ ...baseOpts, network: "signet" })).toBe(
      "https://mempool.space/signet/api",
    );
  });

  it("uses custom API URL when provided", () => {
    expect(
      resolveApiUrl({ ...baseOpts, api: "http://localhost:8999/api" }),
    ).toBe("http://localhost:8999/api");
  });

  it("custom API takes precedence over network", () => {
    expect(
      resolveApiUrl({
        ...baseOpts,
        network: "testnet4",
        api: "http://mynode:8080/api",
      }),
    ).toBe("http://mynode:8080/api");
  });
});

describe("data directory paths", () => {
  it("DATA_DIR resolves to a directory containing entity files", () => {
    // DATA_DIR should point to cli/data/ (symlink to public/data/)
    expect(existsSync(DATA_DIR)).toBe(true);
    expect(existsSync(join(DATA_DIR, "entity-index.bin"))).toBe(true);
  });

  it("WASM_DIR resolves to directory with WASM bindings", () => {
    // WASM_DIR should point to cli/wasm/ (built by wasm-pack)
    expect(existsSync(WASM_DIR)).toBe(true);
    expect(existsSync(join(WASM_DIR, "boltzmann_rs.js"))).toBe(true);
  });
});

describe("entity filter - filesystem loading", () => {
  it("loads core entity index from disk", async () => {
    const { configureDataLoader, loadEntityFilter } =
      await import("@/lib/analysis/entity-filter/filter-loader");
    const { readFileSync } = await import("fs");

    // Configure filesystem-based loading
    configureDataLoader({
      fetchFn: async (path: string) => {
        const filename = path.replace(/^\/data\//, "");
        const filePath = join(DATA_DIR, filename);
        if (!existsSync(filePath)) return null;
        const buf = readFileSync(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
    });

    const filter = await loadEntityFilter();
    expect(filter).not.toBeNull();

    // Check a known address (Silk Road)
    // The entity index should be able to look up known entities
    if (filter) {
      expect(typeof filter.has).toBe("function");
      expect(filter.meta.addressCount).toBeGreaterThan(0);
    }
  });
});

describe("networkForApi", () => {
  const SIGNET = "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6";
  const REGTEST = "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206";
  afterEach(() => vi.unstubAllGlobals());
  const serve = (body: string, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

  it("uses the chain the custom API reports when --network was not given", async () => {
    serve(SIGNET);
    expect(await networkForApi("http://signet-a.local/api", { explicit: false, fallback: "mainnet" })).toBe("signet");
  });

  it("rejects an explicit --network that does not match the API", async () => {
    serve(SIGNET);
    await expect(networkForApi("http://signet-b.local/api", { explicit: true, fallback: "mainnet" }))
      .rejects.toThrow(/serves signet/);
  });

  it("asks the backend on every call (no chain cache): a node that switched chains is caught", async () => {
    serve(SIGNET);
    expect(await networkForApi("http://switch.local/api", { explicit: false, fallback: "mainnet" })).toBe("signet");
    serve("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
    expect(await networkForApi("http://switch.local/api", { explicit: false, fallback: "signet" })).toBe("mainnet");
  });

  it("rejects an unsupported chain, and keeps --network when the API cannot be asked", async () => {
    serve(REGTEST);
    await expect(networkForApi("http://regtest.local/api", { explicit: false, fallback: "mainnet" }))
      .rejects.toThrow(/Regtest/);
    serve("not found", 404);
    expect(await networkForApi("http://old.local/api", { explicit: true, fallback: "testnet4" })).toBe("testnet4");
  });
});
