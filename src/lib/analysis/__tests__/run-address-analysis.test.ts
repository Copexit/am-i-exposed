import { describe, it, expect, vi } from "vitest";
import { runAddressAnalysis } from "../run-address-analysis";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { makeAddress, makeTx } from "../heuristics/__tests__/fixtures/tx-factory";
import type { ApiClient } from "@/lib/api/client";

const ADDRESS = "bc1q" + "a".repeat(38);

function deps(api: Partial<ApiClient>) {
  return {
    api: api as ApiClient,
    controller: new AbortController(),
    onStep: () => {},
    setState: vi.fn(),
    t: (key: string) => key,
  };
}

describe("runAddressAnalysis", () => {
  it("rejects instead of scoring an empty history when getAddressTxs fails", async () => {
    const api = {
      getAddress: async () => makeAddress({ address: ADDRESS }),
      getAddressUtxos: async () => [],
      getAddressTxs: async () => { throw new ApiError("RATE_LIMITED"); },
    };
    await expect(runAddressAnalysis(ADDRESS, deps(api))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("flags the result when UTXOs could not be fetched", async () => {
    const api = {
      getAddress: async () => makeAddress({ address: ADDRESS }),
      getAddressUtxos: async () => { throw new ApiError("API_UNAVAILABLE"); },
      getAddressTxs: async () => [makeTx()],
    };
    const res = await runAddressAnalysis(ADDRESS, deps(api));
    expect(res.result?.findings.map((f) => f.id)).toContain("address-utxos-unavailable");
  });
});
