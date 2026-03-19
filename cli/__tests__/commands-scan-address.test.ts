/**
 * Integration tests for the scan address command.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fixtures
import satoshiAddr from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/satoshi-genesis-address.json";
import satoshiUtxos from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/satoshi-genesis-utxos.json";
import satoshiTxs from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/satoshi-genesis-txs.json";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

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

async function runScanAddress(addr: string, opts: Record<string, unknown> = {}) {
  const { scanAddress } = await import("../src/commands/scan-address");
  const promise = scanAddress(addr, {
    json: true,
    network: "mainnet",
    entities: false,
    color: true,
    ...opts,
  } as never);
  await vi.advanceTimersByTimeAsync(5000);
  return promise;
}

function parseCaptured(): Record<string, unknown> {
  return JSON.parse(captured[captured.length - 1]);
}

describe("scan address - Satoshi genesis", () => {
  beforeEach(() => {
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/address/") && urlStr.includes("/txs")) {
        return jsonResponse(satoshiTxs);
      }
      if (urlStr.includes("/address/") && urlStr.includes("/utxo")) {
        return jsonResponse(satoshiUtxos);
      }
      if (urlStr.includes("/address/")) {
        return jsonResponse(satoshiAddr);
      }
      return new Response("Not Found", { status: 404 });
    });
  });

  it("grades Satoshi genesis address as F", async () => {
    await runScanAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    const result = parseCaptured();
    expect(result.grade).toBe("F");
    expect(result.score).toBe(0);
  });

  it("includes address info in JSON", async () => {
    await runScanAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    const result = parseCaptured();
    expect(result.input).toEqual({ type: "address", value: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" });
    expect(result).toHaveProperty("addressInfo");
    const info = result.addressInfo as Record<string, unknown>;
    expect(info.type).toBe("p2pkh");
  });

  it("detects critical address reuse", async () => {
    await runScanAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    const result = parseCaptured();
    const findings = result.findings as Record<string, unknown>[];
    const reuseFinding = findings.find((f) => (f.id as string).includes("reuse"));
    expect(reuseFinding).toBeDefined();
    expect(reuseFinding?.severity).toBe("critical");
  });
});

describe("scan address - input validation", () => {
  it("rejects invalid addresses", async () => {
    const { scanAddress } = await import("../src/commands/scan-address");
    await expect(
      scanAddress("xyz123invalidaddr", { json: true, network: "mainnet", entities: false, color: true } as never),
    ).rejects.toThrow("Invalid Bitcoin address");
  });

  it("rejects testnet address on mainnet", async () => {
    const { scanAddress } = await import("../src/commands/scan-address");
    await expect(
      scanAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", { json: true, network: "mainnet", entities: false, color: true } as never),
    ).rejects.toThrow("testnet");
  });
});

describe("scan address - JSON schema", () => {
  beforeEach(() => {
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/txs")) return jsonResponse([]);
      if (urlStr.includes("/utxo")) return jsonResponse([]);
      if (urlStr.includes("/address/")) {
        return jsonResponse({
          address: "bc1qtest",
          chain_stats: { funded_txo_count: 1, funded_txo_sum: 50000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
          mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
        });
      }
      return new Response("Not Found", { status: 404 });
    });
  });

  it("produces valid JSON envelope", async () => {
    await runScanAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    const result = parseCaptured();
    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("input");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("recommendation");
  });
});
