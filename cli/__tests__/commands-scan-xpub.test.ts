/**
 * scanWalletAddresses (scan xpub command + MCP scan_wallet): gap-limit scan semantics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ParsedXpub } from "@/lib/bitcoin/descriptor";
import { ApiError } from "@/lib/api/fetch-with-retry";

vi.mock("@/lib/bitcoin/descriptor", () => ({
  deriveOneAddress: (_p: unknown, chain: number, index: number) => ({
    path: `${chain}/${index}`,
    address: `c${chain}i${index}`,
    isChange: chain === 1,
    index,
  }),
}));

import { scanWalletAddresses } from "../src/commands/scan-xpub";

/** Receive chain: indices 0 and 3 are used; index 1 always fails to fetch. */
function fakeClient(): MempoolClient {
  const used = (a: string) => a === "c0i0" || a === "c0i3";
  const stats = (n: number) => ({ funded_txo_count: n, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: n });
  return {
    getAddress: async (a: string) => {
      if (a === "c0i1") throw new ApiError("RATE_LIMITED");
      return { address: a, chain_stats: stats(used(a) ? 1 : 0), mempool_stats: stats(0) };
    },
    getAddressUtxos: async () => [],
    getAddressTxs: async (a: string) => (used(a) ? [{ txid: `tx-${a}` } as MempoolTransaction] : []),
  } as unknown as MempoolClient;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("scanWalletAddresses", () => {
  it("does not count a failed address fetch as an unused address", async () => {
    const p = scanWalletAddresses(fakeClient(), {} as ParsedXpub, 2, { isLocal: true });
    await vi.runAllTimersAsync();
    const { addresses, failed } = await p;

    expect(failed).toEqual(["c0i1"]);
    expect(addresses.map((a) => a.derived.address)).not.toContain("c0i1");
    // Counting c0i1 as empty would end the gap scan at c0i2, before the used c0i3
    expect(addresses.some((a) => a.derived.address === "c0i3" && a.txs.length === 1)).toBe(true);
    // The change chain is scanned too
    expect(addresses.some((a) => a.derived.address === "c1i0")).toBe(true);
  });

  it("stops scanning when the caller's signal aborts (MCP request cancelled)", async () => {
    const client = fakeClient();
    const getAddress = vi.spyOn(client, "getAddress");
    const ac = new AbortController();
    const p = scanWalletAddresses(client, {} as ParsedXpub, 20, { isLocal: false, signal: ac.signal });
    const settled = expect(p).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await vi.runAllTimersAsync();
    await settled;
    const callsAtAbort = getAddress.mock.calls.length;
    expect(callsAtAbort).toBeLessThan(10);
  });
});

