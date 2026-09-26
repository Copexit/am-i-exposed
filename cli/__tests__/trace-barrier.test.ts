/**
 * CLI chain tracing must stop at the same barrier as the web trace
 * (known entities, and CoinJoins/large clusters when enabled).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import type { MempoolClient } from "@/lib/api/mempool";

vi.mock("@/lib/analysis/chain/recursive-trace", async (orig) => {
  const real = await orig<typeof import("@/lib/analysis/chain/recursive-trace")>();
  return { ...real, traceBackward: vi.fn(real.traceBackward), traceForward: vi.fn(real.traceForward) };
});

import { traceBackward, traceForward } from "@/lib/analysis/chain/recursive-trace";
import { analyzeTxid } from "../src/commands/scan-tx";
import { chainTrace } from "../src/commands/chain-trace";

const parent = makeTx({ txid: "b".repeat(64), vin: [makeVin()], vout: [makeVout({ value: 100_000 })] });
const tx = makeTx({ txid: "a".repeat(64), vin: [makeVin({ txid: parent.txid })], vout: [makeVout({ value: 98_000 })] });

const client = {
  getTransaction: async (id: string) => (id === parent.txid ? parent : tx),
  getTxHex: async () => { throw new Error("no hex"); },
  getAddress: async () => { throw new Error("skip"); },
  getTxOutspends: async () => [{ spent: false }],
} as unknown as MempoolClient;

const barrierArg = (fn: unknown, index: number) =>
  (fn as { mock: { calls: unknown[][] } }).mock.calls[0]?.[index];

beforeEach(() => { vi.mocked(traceBackward).mockClear(); vi.mocked(traceForward).mockClear(); });

describe("CLI trace barrier", () => {
  it("scan tx --chain-depth traces with the shared entity barrier", async () => {
    await analyzeTxid(client, tx.txid, { chainDepth: 1 });
    expect(typeof barrierArg(traceBackward, 7)).toBe("function");
    expect(typeof barrierArg(traceForward, 8)).toBe("function");
  });

  it("chain-trace traces with the shared entity barrier", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      Response.json(url.includes("/outspends") ? [{ spent: false }] : url.includes(parent.txid) ? parent : tx)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await chainTrace(tx.txid, { json: true, network: "mainnet", entities: false, color: true, direction: "both", depth: "1" } as never);
    log.mockRestore();
    vi.unstubAllGlobals();
    expect(typeof barrierArg(traceBackward, 7)).toBe("function");
    expect(typeof barrierArg(traceForward, 8)).toBe("function");
  });
});
