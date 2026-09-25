// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const net = vi.hoisted(() => ({ apiReady: false }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => net }));

import { useHashRouting } from "../useHashRouting";

const TXID = "a".repeat(64);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function makeCallbacks() {
  return {
    analyze: vi.fn(), walletAnalyze: vi.fn(), reset: vi.fn(), walletReset: vi.fn(),
    isThirdPartyApi: true, setPendingXpub: vi.fn(),
  };
}

describe("useHashRouting", () => {
  it("holds the initial hash scan until the network config settles (local probe and Tor)", () => {
    window.history.replaceState(null, "", `/#tx=${TXID}`);
    const callbacks = makeCallbacks();
    net.apiReady = false;
    const { rerender } = renderHook(() => useHashRouting(callbacks));
    expect(callbacks.analyze).not.toHaveBeenCalled();

    net.apiReady = true;
    rerender();
    expect(callbacks.analyze).toHaveBeenCalledTimes(1);
    expect(callbacks.analyze).toHaveBeenCalledWith(TXID);
  });
});
