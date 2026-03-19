/**
 * Integration tests for the scan tx command.
 * Uses real API response fixtures with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";

// --- Fixtures ---
import whirlpoolTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json";
import wabisabiTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json";
import joinmarketTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/joinmarket-coinjoin.json";
import simpleLegacyTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/simple-legacy-p2pkh.json";
import dustAttackTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/dust-attack-555.json";

// Mock fetch globally
const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

// Capture console output
let captured: string[] = [];
const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  captured = [];
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  console.error = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  console.log = originalLog;
  console.error = originalError;
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(data: string) {
  return new Response(data, { status: 200 });
}

function mockAddressResponse() {
  return jsonResponse({
    address: "bc1qtest",
    chain_stats: { funded_txo_count: 1, funded_txo_sum: 100000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
  });
}

/**
 * Set up fetch mock to return a transaction fixture.
 * Handles: /tx/{txid}, /tx/{txid}/hex, /tx/{parent_txid}, /address/{addr}
 */
function setupTxMock(tx: MempoolTransaction) {
  mockFetch.mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // Tx hex
    if (urlStr.endsWith("/hex")) return textResponse("0200000001" + "0".repeat(100));
    // Address lookups (for output tx counts)
    if (urlStr.includes("/address/")) return mockAddressResponse();
    // Any /tx/ request returns the fixture
    if (urlStr.includes("/tx/")) return jsonResponse(tx);

    return new Response("Not Found", { status: 404 });
  });
}

async function runScanTx(txid: string, opts: Record<string, unknown> = {}) {
  const { scanTx } = await import("../src/commands/scan-tx");
  const promise = scanTx(txid, {
    json: true,
    network: "mainnet",
    entities: false,
    color: true,
    ...opts,
  } as never);
  await vi.advanceTimersByTimeAsync(15000);
  return promise;
}

function parseCaptured(): Record<string, unknown> {
  return JSON.parse(captured[captured.length - 1]);
}

describe("scan tx - golden cases", () => {
  it("Whirlpool CoinJoin -> A+ (100)", async () => {
    setupTxMock(whirlpoolTx as unknown as MempoolTransaction);
    await runScanTx(whirlpoolTx.txid);
    const result = parseCaptured();
    expect(result.grade).toBe("A+");
    expect(result.score).toBe(100);
    expect(result.txType).toBe("whirlpool-coinjoin");
  });

  it("WabiSabi CoinJoin -> A+ (100)", async () => {
    setupTxMock(wabisabiTx as unknown as MempoolTransaction);
    await runScanTx(wabisabiTx.txid);
    const result = parseCaptured();
    expect(result.grade).toBe("A+");
    expect(result.score).toBe(100);
    expect(result.txType).toBe("wabisabi-coinjoin");
  });

  it("JoinMarket CoinJoin -> B (87)", async () => {
    setupTxMock(joinmarketTx as unknown as MempoolTransaction);
    await runScanTx(joinmarketTx.txid);
    const result = parseCaptured();
    expect(result.grade).toBe("B");
    expect(result.score).toBe(87);
  });

  it("Simple legacy P2PKH -> C (52)", async () => {
    setupTxMock(simpleLegacyTx as unknown as MempoolTransaction);
    await runScanTx(simpleLegacyTx.txid);
    const result = parseCaptured();
    expect(result.grade).toBe("C");
    expect(result.score).toBe(52);
  });

  it("Dust attack 555 sats -> F (24)", async () => {
    setupTxMock(dustAttackTx as unknown as MempoolTransaction);
    await runScanTx(dustAttackTx.txid);
    const result = parseCaptured();
    expect(result.grade).toBe("F");
    expect(result.score).toBe(24);
  });
});

describe("scan tx - JSON envelope schema", () => {
  it("includes all required fields", async () => {
    setupTxMock(whirlpoolTx as unknown as MempoolTransaction);
    await runScanTx(whirlpoolTx.txid);
    const result = parseCaptured();

    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("input");
    expect(result).toHaveProperty("network");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("txType");
    expect(result).toHaveProperty("txInfo");
    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("recommendation");
  });

  it("txInfo contains correct tx metadata", async () => {
    setupTxMock(whirlpoolTx as unknown as MempoolTransaction);
    await runScanTx(whirlpoolTx.txid);
    const result = parseCaptured();
    const txInfo = result.txInfo as Record<string, unknown>;

    expect(txInfo.inputs).toBe(5);
    expect(txInfo.outputs).toBe(5);
    expect(typeof txInfo.fee).toBe("number");
    expect(typeof txInfo.size).toBe("number");
    expect(typeof txInfo.weight).toBe("number");
    expect(txInfo.confirmed).toBe(true);
  });

  it("findings have valid structure", async () => {
    setupTxMock(whirlpoolTx as unknown as MempoolTransaction);
    await runScanTx(whirlpoolTx.txid);
    const result = parseCaptured();
    const findings = result.findings as Record<string, unknown>[];

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f).toHaveProperty("id");
      expect(f).toHaveProperty("severity");
      expect(f).toHaveProperty("title");
      expect(f).toHaveProperty("scoreImpact");
      expect(["critical", "high", "medium", "low", "good"]).toContain(f.severity);
    }
  });
});

describe("scan tx - input validation", () => {
  it("rejects invalid txid (too short)", async () => {
    const { scanTx } = await import("../src/commands/scan-tx");
    await expect(
      scanTx("abc123", { json: true, network: "mainnet", entities: false, color: true } as never),
    ).rejects.toThrow("Invalid txid");
  });

  it("rejects invalid txid (non-hex)", async () => {
    const { scanTx } = await import("../src/commands/scan-tx");
    await expect(
      scanTx("g".repeat(64), { json: true, network: "mainnet", entities: false, color: true } as never),
    ).rejects.toThrow("Invalid txid");
  });

  it("accepts valid 64-char hex txid", async () => {
    const txid = "a".repeat(64);
    setupTxMock(whirlpoolTx as unknown as MempoolTransaction);
    await runScanTx(txid);
    expect(captured.length).toBeGreaterThan(0);
  });
});
