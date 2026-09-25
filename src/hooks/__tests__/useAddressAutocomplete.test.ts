// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";

const net = vi.hoisted(() => ({
  network: "mainnet" as BitcoinNetwork,
  isUmbrel: false,
  customApiUrl: null as string | null,
}));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ ...net, config: NETWORK_CONFIG[net.network] }),
}));

const getAddressPrefix = vi.hoisted(() => vi.fn(async () => ["bc1qexampleaddress"]));
vi.mock("@/lib/api/client", () => ({ createApiClient: () => ({ getAddressPrefix }) }));

const searchEntitiesByPrefix = vi.hoisted(() =>
  vi.fn((q: string) => [{ address: "1Entity", entityName: q, category: "exchange" }]),
);
vi.mock("@/lib/analysis/entity-filter/entity-search", () => ({ searchEntitiesByPrefix }));

import { useAddressAutocomplete } from "../useAddressAutocomplete";

beforeEach(() => {
  vi.useFakeTimers();
  getAddressPrefix.mockClear();
  searchEntitiesByPrefix.mockClear();
  Object.assign(net, { network: "mainnet", isUmbrel: false, customApiUrl: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function type(input: string) {
  const hook = renderHook(() => useAddressAutocomplete());
  act(() => hook.result.current.fetchSuggestions(input));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  return hook.result.current;
}

describe("useAddressAutocomplete", () => {
  it("never sends partial addresses to third-party mempool.space", async () => {
    await type("bc1qxyz");
    expect(getAddressPrefix).not.toHaveBeenCalled();
  });

  it("queries address prefixes on the user's own node (Umbrel or custom API)", async () => {
    net.isUmbrel = true;
    const r = await type("bc1qxyz");
    expect(getAddressPrefix).toHaveBeenCalledWith("bc1qxyz");
    expect(r.suggestions[0]).toEqual({ type: "address", value: "bc1qexampleaddress" });

    getAddressPrefix.mockClear();
    Object.assign(net, { isUmbrel: false, customApiUrl: "http://node.local/api" });
    await type("3J98t1");
    expect(getAddressPrefix).toHaveBeenCalledWith("3J98t1");
  });

  it.each(["MEXC", "Mt. Gox", "Nexo", "mercado"])(
    "treats entity name %s as an entity search on mainnet, not an address prefix",
    async (name) => {
      net.isUmbrel = true;
      const r = await type(name);
      expect(getAddressPrefix).not.toHaveBeenCalled();
      expect(searchEntitiesByPrefix).toHaveBeenCalledWith(name, 10);
      expect(r.suggestions[0]?.type).toBe("entity");
    },
  );

  it("accepts testnet base58 prefixes only on test networks", async () => {
    Object.assign(net, { network: "testnet4", customApiUrl: "http://node.local/testnet4/api" });
    await type("mipcBb");
    expect(getAddressPrefix).toHaveBeenCalledWith("mipcBb");
  });
});
