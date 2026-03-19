/**
 * Tests for the chain-trace command with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

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
  return new Response(JSON.stringify(data), { status: 200 });
}

function parseCaptured(): Record<string, unknown> {
  return JSON.parse(captured[captured.length - 1]);
}

describe("chain-trace command", () => {
  it("traces backward and forward at depth 1", async () => {
    const parentTxid = "b".repeat(64);
    const mainTxid = "a".repeat(64);

    const parentTx = makeTx({
      txid: parentTxid,
      vin: [makeVin()],
      vout: [makeVout({ value: 100000 })],
    });

    const mainTx = makeTx({
      txid: mainTxid,
      vin: [makeVin({ txid: parentTxid })],
      vout: [makeVout({ value: 98000 })],
    });

    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/outspends")) return jsonResponse([{ spent: false }]);
      if (urlStr.includes(parentTxid.slice(0, 10))) return jsonResponse(parentTx);
      if (urlStr.includes("/tx/")) return jsonResponse(mainTx);
      return new Response("Not Found", { status: 404 });
    });

    const { chainTrace } = await import("../src/commands/chain-trace");
    const promise = chainTrace(mainTxid, {
      json: true,
      network: "mainnet",
      entities: false,
      color: true,
      direction: "both",
      depth: "1",
      "min-sats": "1000",
    } as never);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const result = parseCaptured();
    expect(result).toHaveProperty("trace");
    const trace = result.trace as Record<string, unknown>;
    expect(trace).toHaveProperty("backward");
    expect(trace).toHaveProperty("forward");
    expect(trace).toHaveProperty("findings");
  });

  it("supports backward-only direction", async () => {
    const tx = makeTx({ txid: "a".repeat(64) });
    mockFetch.mockResolvedValue(jsonResponse(tx));

    const { chainTrace } = await import("../src/commands/chain-trace");
    const promise = chainTrace("a".repeat(64), {
      json: true,
      network: "mainnet",
      entities: false,
      color: true,
      direction: "backward",
      depth: "1",
      "min-sats": "1000",
    } as never);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const result = parseCaptured();
    const trace = result.trace as Record<string, unknown>;
    expect(trace.backward).not.toBeNull();
    expect(trace.forward).toBeNull();
  });

  it("rejects invalid txid", async () => {
    const { chainTrace } = await import("../src/commands/chain-trace");
    await expect(
      chainTrace("invalid", {
        json: true,
        network: "mainnet",
        entities: false,
        color: true,
        direction: "both",
        depth: "1",
      } as never),
    ).rejects.toThrow("Invalid txid");
  });
});
