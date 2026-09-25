import { describe, it, expect, beforeEach, vi } from "vitest";
import { enrichBip47Finding, enrichRicochetFinding } from "../enrichment";
import type { ApiClient } from "@/lib/api/client";
import type { Finding } from "@/lib/types";
import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import { makeTx, makeVin, makeVout, makeAddress, makeOutspend, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

function api(methods: Partial<Record<"getAddress" | "getTxOutspends" | "getTransaction", unknown>>): ApiClient {
  return methods as unknown as ApiClient;
}
const live = () => new AbortController().signal;

describe("enrichBip47Finding", () => {
  const bip47 = (params: Finding["params"]): Finding => ({
    id: "bip47-notification", severity: "medium", title: "t", description: "d", recommendation: "r", scoreImpact: -1, params,
  });

  it("adds tx count (chain + mempool) and multi-channel info", async () => {
    const f = bip47({ notificationAddress: "bc1qnotif" });
    const getAddress = vi.fn().mockResolvedValue(makeAddress({
      chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 4 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    }));
    await enrichBip47Finding([f], api({ getAddress }), live());
    expect(getAddress).toHaveBeenCalledWith("bc1qnotif");
    expect(f.params?.notificationTxCount).toBe(5);
    expect(f.params?.notificationAddress).toBe("bc1qnotif");
    expect(f.params?.channelInfo).toContain("5 BIP47 payment channels");
  });

  it("uses first-notification wording for a single tx", async () => {
    const f = bip47({ notificationAddress: "bc1qnotif" });
    await enrichBip47Finding([f], api({ getAddress: vi.fn().mockResolvedValue(makeAddress()) }), live());
    expect(f.params?.notificationTxCount).toBe(1);
    expect(f.params?.channelInfo).toContain("first notification");
  });

  it("does not fetch without a finding or a usable address", async () => {
    const getAddress = vi.fn();
    await enrichBip47Finding([], api({ getAddress }), live());
    await enrichBip47Finding([bip47({ notificationAddress: "" })], api({ getAddress }), live());
    await enrichBip47Finding([bip47({ notificationAddress: 5 })], api({ getAddress }), live());
    expect(getAddress).not.toHaveBeenCalled();
  });

  it("leaves the finding untouched when the fetch fails", async () => {
    const f = bip47({ notificationAddress: "bc1qnotif" });
    await enrichBip47Finding([f], api({ getAddress: vi.fn().mockRejectedValue(new Error("429")) }), live());
    expect(f.params).toEqual({ notificationAddress: "bc1qnotif" });
  });

  it("discards the result when aborted during the fetch", async () => {
    const f = bip47({ notificationAddress: "bc1qnotif" });
    const ctrl = new AbortController();
    const getAddress = vi.fn(() => { ctrl.abort(); return Promise.resolve(makeAddress()); });
    await enrichBip47Finding([f], api({ getAddress }), ctrl.signal);
    expect(f.params?.notificationTxCount).toBeUndefined();
  });
});

describe("enrichRicochetFinding", () => {
  const id = (n: number) => n.toString(16).padStart(64, "0");
  const hop0Finding = (params: Finding["params"] = { ricochetOutputIndex: 1 }): Finding => ({
    id: "ricochet-hop0", severity: "good", title: "t", description: "orig", recommendation: "orig", scoreImpact: 0, params,
  });
  // hop 0: output 0 = 100k Ricochet fee, output 1 = ricochet amount
  const hop0Tx = (height?: number) => makeTx({
    txid: id(0),
    vout: [makeVout({ value: 100_000 }), makeVout({ value: 900_000 })],
    status: height ? { confirmed: true, block_height: height } : { confirmed: false },
  });

  function hopTx(n: number, height: number | undefined, values: number[], nIn = 1): MempoolTransaction {
    return makeTx({
      txid: id(n),
      vin: Array.from({ length: nIn }, () => makeVin({ txid: id(n - 1) })),
      vout: values.map((value) => makeVout({ value })),
      status: height ? { confirmed: true, block_height: height } : { confirmed: false },
    });
  }

  /** Mock api: hops[k] spends output `spentVout[k]` of hop k-1. */
  function chainApi(hops: MempoolTransaction[], spentVout: number[]) {
    const all = [hop0Tx(800_000), ...hops];
    const getTxOutspends = vi.fn((txid: string): Promise<MempoolOutspend[]> => {
      const idx = all.findIndex((t) => t.txid === txid);
      const next = hops[idx];
      const cur = all[idx]!;
      return Promise.resolve(cur.vout.map((_, i) =>
        next && i === spentVout[idx] ? makeOutspend({ spent: true, txid: next.txid, vin: 0 }) : makeOutspend()));
    });
    const getTransaction = vi.fn((txid: string) => {
      const t = hops.find((h) => h.txid === txid);
      return t ? Promise.resolve(t) : Promise.reject(new Error("404"));
    });
    return { getTxOutspends, getTransaction };
  }

  it("traces 4 consecutive-block hops as classic", async () => {
    const hops = [1, 2, 3, 4].map((n) => hopTx(n, 800_000 + n, [900_000 - n * 1_000]));
    const m = chainApi(hops, [1, 0, 0, 0]);
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(m), hop0Tx(800_000), live());

    expect(f.params?.hopCount).toBe(5);
    expect(f.params?.variant).toBe("classic");
    expect(f.params?.destinationTxid).toBe(id(4));
    const parsed = JSON.parse(String(f.params?.hops)) as { hop: number; value: number; blockHeight: number }[];
    expect(parsed.map((h) => h.hop)).toEqual([0, 1, 2, 3, 4]);
    expect(parsed[0]?.value).toBe(900_000);
    expect(parsed[4]?.value).toBe(896_000);
    expect(f.description).toContain("5 hops (classic (consecutive blocks))");
    expect(f.description).toContain("4 forward hops");
    // Stops after 4 hops: outspends not fetched for the final hop
    expect(m.getTxOutspends).toHaveBeenCalledTimes(4);
  });

  it("follows the larger output of a 2-output hop and labels gaps as staggered", async () => {
    const h1 = hopTx(1, 800_003, [5_000, 890_000]); // chain continues on vout 1
    const h2 = hopTx(2, 800_010, [880_000]);
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(chainApi([h1, h2], [1, 1])), hop0Tx(800_000), live());
    expect(f.params?.hopCount).toBe(3);
    expect(f.params?.variant).toBe("staggered");
    expect(f.description).toContain("2 forward hops");
  });

  it("labels chains with an unconfirmed hop as partial and uses singular wording", async () => {
    const h1 = hopTx(1, undefined, [890_000]);
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(chainApi([h1], [1])), hop0Tx(800_000), live());
    expect(f.params?.hopCount).toBe(2);
    expect(f.params?.variant).toBe("partial");
    expect(f.description).toContain("1 forward hop to");
  });

  it("stops at a hop with more than one input", async () => {
    const h1 = hopTx(1, 800_001, [890_000]);
    const h2 = hopTx(2, 800_002, [880_000], 2);
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(chainApi([h1, h2], [1, 0])), hop0Tx(800_000), live());
    expect(f.params?.hopCount).toBe(2);
    expect(f.params?.destinationTxid).toBe(id(1));
  });

  it("stops at a hop with more than two outputs", async () => {
    const h1 = hopTx(1, 800_001, [300_000, 300_000, 290_000]);
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(chainApi([h1], [1])), hop0Tx(800_000), live());
    expect(f.description).toBe("orig");
    expect(f.params?.hopCount).toBeUndefined();
  });

  it("leaves the finding untouched when the ricochet output is unspent", async () => {
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(chainApi([], [])), hop0Tx(800_000), live());
    expect(f.description).toBe("orig");
    expect(f.params).toEqual({ ricochetOutputIndex: 1 });
  });

  it("swallows a mid-chain fetch failure without partial mutation", async () => {
    const h1 = hopTx(1, 800_001, [890_000]);
    const m = chainApi([h1], [1]);
    m.getTxOutspends.mockImplementation((txid: string) =>
      txid === id(0)
        ? Promise.resolve([makeOutspend(), makeOutspend({ spent: true, txid: id(1) })])
        : Promise.reject(new Error("rate limited")));
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(m), hop0Tx(800_000), live());
    expect(f.params).toEqual({ ricochetOutputIndex: 1 });
    expect(f.recommendation).toBe("orig");
  });

  it("stops and does not mutate when aborted mid-trace", async () => {
    const hops = [1, 2, 3, 4].map((n) => hopTx(n, 800_000 + n, [890_000]));
    const m = chainApi(hops, [1, 0, 0, 0]);
    const ctrl = new AbortController();
    const inner = m.getTransaction.getMockImplementation()!;
    m.getTransaction.mockImplementation((txid: string) => {
      if (txid === id(2)) ctrl.abort();
      return inner(txid);
    });
    const f = hop0Finding();
    await enrichRicochetFinding([f], api(m), hop0Tx(800_000), ctrl.signal);
    expect(f.params).toEqual({ ricochetOutputIndex: 1 });
    expect(m.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a valid ricochet output index", async () => {
    const m = chainApi([], []);
    const { params: _unused, ...noParams } = hop0Finding();
    await enrichRicochetFinding([noParams], api(m), hop0Tx(800_000), live());
    const invalid: Finding["params"][] = [{}, { ricochetOutputIndex: -1 }, { ricochetOutputIndex: "1" }];
    for (const params of invalid) {
      await enrichRicochetFinding([hop0Finding(params)], api(m), hop0Tx(800_000), live());
    }
    await enrichRicochetFinding([], api(m), hop0Tx(800_000), live());
    expect(m.getTxOutspends).not.toHaveBeenCalled();
  });
});
