import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFirstDegreeCluster } from "../build-cluster";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { ApiClient } from "@/lib/api/client";

beforeEach(() => resetAddrCounter());

const TARGET = "bc1qtarget" + "0".repeat(33);
const ADDR_A = "bc1qaaaaa" + "0".repeat(34);
const ADDR_B = "bc1qbbbbb" + "0".repeat(34);

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getTransaction: vi.fn().mockRejectedValue(new Error("not mocked")),
    getTxHex: vi.fn().mockRejectedValue(new Error("not mocked")),
    getAddress: vi.fn().mockRejectedValue(new Error("not mocked")),
    getAddressTxs: vi.fn().mockResolvedValue([]),
    getAddressUtxos: vi.fn().mockRejectedValue(new Error("not mocked")),
    getHistoricalPrice: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeVinForAddr(addr: string, value = 100_000) {
  return makeVin({
    prevout: {
      scriptpubkey: "",
      scriptpubkey_asm: "",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: addr,
      value,
    },
  });
}

describe("buildFirstDegreeCluster", () => {
  it("includes the target address even with no transactions", async () => {
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, [], api);

    expect(result.addresses).toContain(TARGET);
    expect(result.size).toBe(1);
    expect(result.txsAnalyzed).toBe(0);
  });

  it("collects co-input addresses via CIOH", async () => {
    const tx = makeTx({
      vin: [makeVinForAddr(TARGET), makeVinForAddr(ADDR_A), makeVinForAddr(ADDR_B)],
      vout: [makeVout({ value: 250_000 })],
    });
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, [tx], api);

    expect(result.addresses).toContain(TARGET);
    expect(result.addresses).toContain(ADDR_A);
    expect(result.addresses).toContain(ADDR_B);
    expect(result.size).toBe(3);
  });

  it("skips transactions where target is not an input", async () => {
    const tx = makeTx({
      vin: [makeVinForAddr(ADDR_A)],
      vout: [makeVout({ scriptpubkey_address: TARGET, value: 50_000 })],
    });
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, [tx], api);

    // Target is only a receiver, CIOH should not apply
    expect(result.addresses).toEqual([TARGET]);
    expect(result.size).toBe(1);
  });

  it("skips CoinJoin transactions (5 equal outputs)", async () => {
    // Whirlpool-like: 5 equal outputs
    const denomValue = 5_000_000;
    const cjTx = makeTx({
      vin: [
        makeVinForAddr(TARGET, denomValue + 5000),
        makeVinForAddr(ADDR_A, denomValue + 5000),
        makeVinForAddr(ADDR_B, denomValue + 5000),
        makeVinForAddr("bc1qccccc" + "0".repeat(34), denomValue + 5000),
        makeVinForAddr("bc1qddddd" + "0".repeat(34), denomValue + 5000),
      ],
      vout: Array.from({ length: 5 }, () =>
        makeVout({ value: denomValue }),
      ),
    });
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, [cjTx], api);

    expect(result.coinJoinTxCount).toBe(1);
    // CoinJoin should be skipped, only target in cluster
    expect(result.size).toBe(1);
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const tx = makeTx({
      vin: [makeVinForAddr(TARGET), makeVinForAddr(ADDR_A)],
    });
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, [tx], api, controller.signal);

    // Should exit early due to abort
    expect(result.txsAnalyzed).toBe(0);
  });

  it("calls onProgress callback", async () => {
    const tx = makeTx({
      vin: [makeVinForAddr(TARGET), makeVinForAddr(ADDR_A)],
      vout: [makeVout({ value: 150_000 })],
    });
    const api = makeApi();
    const progress = vi.fn();
    await buildFirstDegreeCluster(TARGET, [tx], api, undefined, progress);

    expect(progress).toHaveBeenCalledWith({
      phase: "inputs",
      current: 1,
      total: 1,
    });
  });

  it("caps at 50 transactions", async () => {
    const txs = Array.from({ length: 60 }, () =>
      makeTx({
        vin: [makeVinForAddr(TARGET)],
        vout: [makeVout()],
      }),
    );
    const api = makeApi();
    const result = await buildFirstDegreeCluster(TARGET, txs, api);

    expect(result.txsAnalyzed).toBe(50);
  });

  it("handles API errors in change-follow gracefully", async () => {
    // 2-output tx where target is sender, one output matches sender type
    const changeAddr = "bc1qchange" + "0".repeat(33);
    const tx = makeTx({
      vin: [makeVinForAddr(TARGET, 200_000)],
      vout: [
        makeVout({ scriptpubkey_address: changeAddr, value: 150_000, scriptpubkey_type: "v0_p2wpkh" }),
        makeVout({ scriptpubkey_address: "3PaymentAddr" + "0".repeat(21), value: 48_000, scriptpubkey_type: "v0_p2wpkh" }),
      ],
    });

    const api = makeApi({
      getAddressTxs: vi.fn().mockRejectedValue(new Error("rate limited")),
    });

    // Should not throw even if API call fails
    const result = await buildFirstDegreeCluster(TARGET, [tx], api);
    expect(result.addresses).toContain(TARGET);
  });
});
