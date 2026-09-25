// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { TorStatus } from "../useTorDetection";
import type { LocalApiStatus } from "../useLocalApi";

const net = vi.hoisted(() => ({
  torStatus: "checking" as TorStatus,
  localApiStatus: "unavailable" as LocalApiStatus,
}));
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
  it("holds the initial hash scan until Tor detection settles too", () => {
    window.history.replaceState(null, "", `/#tx=${TXID}`);
    const callbacks = makeCallbacks();
    const { analyze } = callbacks;
    net.torStatus = "checking";
    net.localApiStatus = "unavailable";
    const { rerender } = renderHook(() => useHashRouting(callbacks));
    expect(analyze).not.toHaveBeenCalled();

    net.torStatus = "tor";
    rerender();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(TXID);
  });

  it("holds the initial hash scan until the local API probe settles", () => {
    window.history.replaceState(null, "", `/#tx=${TXID}`);
    const callbacks = makeCallbacks();
    net.torStatus = "clearnet";
    net.localApiStatus = "checking";
    const { rerender } = renderHook(() => useHashRouting(callbacks));
    expect(callbacks.analyze).not.toHaveBeenCalled();

    net.localApiStatus = "available";
    rerender();
    expect(callbacks.analyze).toHaveBeenCalledWith(TXID);
  });
});
