import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectTxidNetwork } from "../detect-network";

const VALID_TXID = "a".repeat(64);

function mockFetchByHost(matrix: Record<string, number>): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [host, status] of Object.entries(matrix)) {
      if (url.includes(host)) {
        return new Response(null, { status });
      }
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("detectTxidNetwork", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for a malformed txid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await detectTxidNetwork("not-a-txid", "mainnet")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the network that responds OK when the user's network 404s", async () => {
    mockFetchByHost({
      "mempool.space/testnet4/api": 200,
    });

    const result = await detectTxidNetwork(VALID_TXID, "mainnet");
    expect(result).toBe("testnet4");
  });

  it("never probes the network the caller is already on", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://mempool.space/api/")) {
        throw new Error("must not probe fromNetwork");
      }
      if (url.includes("mempool.space/signet/api")) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectTxidNetwork(VALID_TXID, "mainnet");
    expect(result).toBe("signet");
  });

  it("returns null when no network has the txid", async () => {
    mockFetchByHost({});
    const result = await detectTxidNetwork(VALID_TXID, "mainnet");
    expect(result).toBeNull();
  });

  it("propagates abort signals to the underlying fetches", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await detectTxidNetwork(VALID_TXID, "mainnet", controller.signal);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses /tx/{txid}/hex (not /status) - regression: /status returns 200 for missing txs", async () => {
    // Live mempool.space behavior, observed during PR #91 verification:
    // - GET /api/tx/{unknownTxid}/status     -> HTTP 200 {"confirmed":false}
    // - GET /api/tx/{unknownTxid}/hex        -> HTTP 404
    // - GET /api/tx/{unknownTxid}            -> HTTP 404
    // Using /status would make every probe spuriously succeed and pick
    // whichever network responded fastest - mainnet wins by latency.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return new Response(null, { status: url.includes("/hex") ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await detectTxidNetwork(VALID_TXID, "mainnet");
    for (const call of fetchMock.mock.calls) {
      const url = typeof call[0] === "string" ? call[0] : call[0].toString();
      expect(url.endsWith("/hex"), `must probe /hex, got ${url}`).toBe(true);
    }
  });
});
