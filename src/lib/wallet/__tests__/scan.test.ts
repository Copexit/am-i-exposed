import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolAddress, MempoolTransaction } from "@/lib/api/types";
import type { ParsedXpub } from "@/lib/bitcoin/descriptor";
import { ApiError } from "@/lib/api/fetch-with-retry";

vi.mock("@/lib/bitcoin/descriptor", () => ({
  deriveOneAddress: (_p: unknown, chain: number, index: number) => ({
    path: `${chain}/${index}`,
    address: `addr${index}`,
    isChange: chain === 1,
    index,
  }),
}));

import { scanChain, traceWalletTxs } from "../scan";

const parsed = {} as ParsedXpub;

function addressData(address: string, txCount: number): MempoolAddress {
  const stats = { funded_txo_count: txCount, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: txCount };
  return { address, chain_stats: stats, mempool_stats: { ...stats, tx_count: 0, funded_txo_count: 0 } };
}

/** Fake API: `used` indices have 1 tx; `failing(index, attempt)` decides whether getAddressTxs rejects. */
function fakeApi(used: Set<number>, failing: (index: number, attempt: number) => boolean) {
  const attempts = new Map<number, number>();
  const idx = (a: string) => Number(a.slice(4));
  return {
    getAddress: async (a: string) => addressData(a, used.has(idx(a)) ? 1 : 0),
    getAddressUtxos: async () => [],
    getAddressTxs: async (a: string) => {
      const i = idx(a);
      const n = attempts.get(i) ?? 0;
      attempts.set(i, n + 1);
      if (failing(i, n)) throw new ApiError("RATE_LIMITED");
      return used.has(i) ? [{ txid: `tx${i}` } as MempoolTransaction] : [];
    },
  } as unknown as MempoolClient;
}

function settle<T>(p: Promise<T>) {
  return p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("scanChain", () => {
  it("does not count failed fetches toward the gap limit and reports them", async () => {
    const api = fakeApi(new Set([0, 6]), (i) => i === 1 || i === 2);
    const p = scanChain(parsed, 0, api, new AbortController().signal, true, 5, () => {});
    await vi.runAllTimersAsync();
    const { infos, failed } = await p;

    expect(failed).toEqual(["addr1", "addr2"]);
    expect(infos.map((i) => i.derived.address)).not.toContain("addr1");
    // Without the fix, 1-5 look unused and the scan stops before the used index 6
    expect(infos.some((i) => i.derived.address === "addr6" && i.txs.length === 1)).toBe(true);
  });

  it("retries a transient failure before giving up on an address", async () => {
    const api = fakeApi(new Set([0]), (i, attempt) => i === 0 && attempt === 0);
    const p = scanChain(parsed, 0, api, new AbortController().signal, true, 2, () => {});
    await vi.runAllTimersAsync();
    const { infos, failed } = await p;

    expect(failed).toEqual([]);
    expect(infos[0].txs).toHaveLength(1);
  });

  it("aborts the scan with the API error when the backend keeps failing", async () => {
    const api = fakeApi(new Set(), () => true);
    const p = settle(scanChain(parsed, 0, api, new AbortController().signal, true, 5, () => {}));
    await vi.runAllTimersAsync();
    const r = await p;

    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as ApiError).code).toBe("RATE_LIMITED");
  });
});

describe("traceWalletTxs", () => {
  it("bounds how many UTXO traces run at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = <T>(value: T) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<T>((resolve) => setTimeout(() => { inFlight--; resolve(value); }, 10));
    };
    const tx = (id: string) => ({
      txid: id,
      vin: [{ txid: `parent-${id}`, vout: 0, is_coinbase: false, prevout: { value: 100_000 } }],
      vout: [{ value: 100_000 }],
    }) as unknown as MempoolTransaction;
    const api = {
      getTransaction: (id: string) => slow({ ...tx(id), vin: [] }),
      getTxOutspends: () => slow([]),
    } as unknown as MempoolClient;
    const txs = new Map(["a", "b", "c", "d", "e"].map((id) => [id, tx(id)]));

    const p = traceWalletTxs(txs, api, new AbortController().signal, { depth: 1, minSats: 0, concurrency: 1 }, () => {});
    await vi.runAllTimersAsync();
    const traces = await p;

    expect(traces.size).toBe(5);
    // One trace = backward + forward + outspends in parallel; 5 unbounded traces would be 15
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("passes the trace barrier to both trace directions", async () => {
    const parent = { txid: "p", vin: [], vout: [{ value: 100_000 }] } as unknown as MempoolTransaction;
    const root = {
      txid: "r",
      vin: [{ txid: "p", vout: 0, is_coinbase: false, prevout: { value: 100_000 } }],
      vout: [{ value: 90_000 }],
    } as unknown as MempoolTransaction;
    const api = {
      getTransaction: async () => parent,
      getTxOutspends: async () => [],
    } as unknown as MempoolClient;
    const barrier = vi.fn(() => true);

    await traceWalletTxs(new Map([["r", root]]), api, new AbortController().signal, { depth: 2, minSats: 0, concurrency: 1, barrier }, () => {});

    expect(barrier).toHaveBeenCalledWith(parent);
  });
});
