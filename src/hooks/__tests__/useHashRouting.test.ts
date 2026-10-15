// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const net = vi.hoisted(() => ({ apiReady: false }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => net }));

import { useHashRouting } from "../useHashRouting";
import { bookmarkStore } from "../useBookmarks";
import { enableLock, lockNow, vaultStore } from "../walletVault";
import { placeholderFor } from "@/lib/backup/wallet-vault";
import { ZPUB } from "@/lib/wallet/__tests__/fake-chain";

const TXID = "a".repeat(64);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function makeCallbacks() {
  return {
    analyze: vi.fn(), walletAnalyze: vi.fn(), reset: vi.fn(), walletReset: vi.fn(),
    isThirdPartyApi: true, setPendingXpub: vi.fn(), setPendingLocked: vi.fn(),
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

  it("a locked wallet's placeholder hash asks for the password, never scans the placeholder, and scans the key once unlocked", async () => {
    localStorage.clear(); bookmarkStore.remove(); vaultStore.remove(); lockNow();
    bookmarkStore.set([{ input: ZPUB, type: "wallet", grade: "C", score: 50, savedAt: 1, scriptType: "p2wpkh", network: "mainnet" }]);
    expect(await enableLock("correct horse battery")).toBe(true);
    const ph = placeholderFor(ZPUB);
    net.apiReady = true;

    lockNow();
    window.history.replaceState(null, "", `/#xpub=${ph}`);
    const locked = { ...makeCallbacks(), isThirdPartyApi: false };
    renderHook(() => useHashRouting(locked));
    expect(locked.setPendingLocked).toHaveBeenCalledWith(ph);
    expect(locked.walletAnalyze).not.toHaveBeenCalled();
    cleanup();

    // Unlocked in this tab (enable leaves it unlocked): the key from the vault is scanned
    vaultStore.remove(); bookmarkStore.set([{ input: ZPUB, type: "wallet", grade: "C", score: 50, savedAt: 1, scriptType: "p2wpkh", network: "mainnet" }]);
    await enableLock("correct horse battery");
    const open = { ...makeCallbacks(), isThirdPartyApi: false };
    renderHook(() => useHashRouting(open));
    expect(open.walletAnalyze).toHaveBeenCalledWith(ZPUB);
    expect(open.setPendingLocked).not.toHaveBeenCalled();
  }, 30_000);
});
