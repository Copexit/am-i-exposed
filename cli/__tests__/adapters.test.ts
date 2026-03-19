/**
 * Tests for CLI adapters - entity loader, settings, API utilities.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { resolveApiUrl } from "../src/util/api";
import { getCliSettings, setCliSettings } from "../src/adapters/settings";
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

describe("CLI settings", () => {
  it("returns defaults initially", () => {
    const settings = getCliSettings();
    expect(settings.maxDepth).toBe(3);
    expect(settings.minSats).toBe(1000);
    expect(settings.enableCache).toBe(false);
    expect(settings.boltzmannTimeout).toBe(300);
  });

  it("merges overrides", () => {
    setCliSettings({ maxDepth: 5, minSats: 5000 });
    const settings = getCliSettings();
    expect(settings.maxDepth).toBe(5);
    expect(settings.minSats).toBe(5000);
    // Other defaults preserved
    expect(settings.enableCache).toBe(false);
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
