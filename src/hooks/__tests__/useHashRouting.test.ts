// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { TorStatus } from "../useTorDetection";

const net = vi.hoisted(() => ({ torStatus: "checking" as TorStatus }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => net }));

import { useHashRouting } from "../useHashRouting";

const TXID = "a".repeat(64);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("useHashRouting", () => {
  it("holds the initial hash scan until Tor detection settles too", () => {
    window.history.replaceState(null, "", `/#tx=${TXID}`);
    const analyze = vi.fn();
    const callbacks = {
      analyze, walletAnalyze: vi.fn(), reset: vi.fn(), walletReset: vi.fn(),
      isThirdPartyApi: true, setPendingXpub: vi.fn(),
    };
    net.torStatus = "checking";
    const { rerender } = renderHook(() => useHashRouting(callbacks, "unavailable"));
    expect(analyze).not.toHaveBeenCalled();

    net.torStatus = "tor";
    rerender();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(TXID);
  });
});
