import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICES, getService, findRpc, findGetRoute, validateParam } from "../registry";

describe("service registry", () => {
  it("sidecar copy is identical to the canonical registry", () => {
    const root = join(__dirname, "../../../..");
    expect(readFileSync(join(root, "umbrel/tor-proxy/services.json"), "utf8"))
      .toBe(readFileSync(join(root, "src/lib/services/registry.json"), "utf8"));
  });

  it("every service is well formed and every lookup declares param validators", () => {
    const ids = new Set<string>();
    for (const s of SERVICES) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.base).toMatch(/^https:\/\//);
      for (const r of s.routes) {
        expect(r.path.startsWith("/")).toBe(true);
        if (r.http === "POST") expect(r.rpc).toBeDefined();
        for (const spec of Object.values(r.rpc ?? {})) {
          if (spec.class === "lookup") {
            expect(spec.params && Object.keys(spec.params).length).toBeGreaterThan(0);
            expect(spec.ttl).toBeUndefined();
          }
        }
      }
    }
  });

  it("finds RPC methods and GET routes", () => {
    expect(getService("wabisator")?.name).toBe("Wabisator");
    expect(findRpc("wabisator", "/api.php", "search")?.class).toBe("lookup");
    expect(findRpc("wabisator", "/api.php", "dashboard")?.class).toBe("aggregate");
    expect(findRpc("wabisator", "/api.php", "graph")).toBeUndefined();
    expect(findRpc("nope", "/api.php", "search")).toBeUndefined();
    expect(findGetRoute("whirlpoolstats", "/txs")?.query).toEqual({ page: "page" });
    expect(findGetRoute("whirlpoolstats", "/admin")).toBeUndefined();
  });

  it("validates and normalizes params", () => {
    const tx = "AB".repeat(32);
    expect(validateParam("txid", ` ${tx} `)).toBe("ab".repeat(32));
    expect(validateParam("txid", "ab".repeat(31))).toBeNull();
    expect(validateParam("txid", 42)).toBeNull();
    expect(validateParam("page", "3")).toBe("3");
    expect(validateParam("page", "0")).toBe("1");
    expect(validateParam("page", "99999")).toBe("10000");
    expect(validateParam("page", "x")).toBe("1");
  });
});
