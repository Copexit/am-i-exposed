import { describe, it, expect, vi, afterEach } from "vitest";
import { serviceUrl } from "../route";
import { grantLookupConsent, ConsentRequiredError } from "../consent";
import { serviceRpc, serviceGet } from "../client";

const TX = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const rpcOk = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
afterEach(() => vi.restoreAllMocks());

describe("serviceUrl", () => {
  it("worker on public, tor-proxy on Umbrel", () => {
    expect(serviceUrl("wabisator", "/api.php", { isUmbrel: false })).toBe("https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php");
    expect(serviceUrl("wabisator", "/api.php", { isUmbrel: true })).toBe("/tor-proxy/svc/wabisator/api.php");
  });
});

describe("serviceRpc consent", () => {
  it("refuses a lookup without consent and sends nothing", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false })).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses a forged consent object and a txid outside the consent", async () => {
    const forged = { serviceId: "wabisator", txids: new Set([TX]) };
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false, consent: forged })).rejects.toBeInstanceOf(ConsentRequiredError);
    const c = grantLookupConsent("wabisator", ["ab".repeat(32)]);
    await expect(serviceRpc("wabisator", "/api.php", "search", { query: TX }, { isUmbrel: false, consent: c })).rejects.toBeInstanceOf(ConsentRequiredError);
  });
  it("sends a consented lookup (normalizing case) to the proxied URL", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(rpcOk({ Matches: [] }));
    const c = grantLookupConsent("wabisator", [` ${TX.toUpperCase()} `]);
    await serviceRpc("wabisator", "/api.php", "search", { query: TX.toUpperCase() }, { isUmbrel: false, consent: c });
    expect(f.mock.calls[0]![0]).toBe("https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php");
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).params).toEqual({ query: TX });
  });
  it("lookup sends only declared keys; a missing declared key throws before fetch", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(rpcOk({ Matches: [] }));
    const c = grantLookupConsent("wabisator", [TX]);
    await serviceRpc("wabisator", "/api.php", "search", { query: TX, txId: "ab".repeat(32) }, { isUmbrel: false, consent: c });
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).params).toEqual({ query: TX });
    f.mockClear();
    await expect(serviceRpc("wabisator", "/api.php", "search", {}, { isUmbrel: false, consent: c })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("aggregate methods need no consent; unknown methods throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rpcOk({ ok: 1 }));
    await expect(serviceRpc("wabisator", "/api.php", "dashboard", {}, { isUmbrel: true })).resolves.toEqual({ ok: 1 });
    await expect(serviceRpc("wabisator", "/api.php", "graph", {}, { isUmbrel: true })).rejects.toThrow("Unknown service method");
  });
  it("serviceGet builds the query", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await serviceGet("whirlpoolstats", "/txs", { isUmbrel: true, query: { page: 2 } });
    expect(f.mock.calls[0]![0]).toBe("/tor-proxy/svc/whirlpoolstats/txs?page=2");
  });
});
