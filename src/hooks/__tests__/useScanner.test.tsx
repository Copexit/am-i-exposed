// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const m = vi.hoisted(() => ({
  analyze: vi.fn(),
  walletReset: vi.fn(),
  setHash: vi.fn(),
  skip: { current: false },
}));

vi.mock("@/hooks/useAnalysis", () => ({
  useAnalysis: () => ({ phase: "idle", query: null, inputType: null, result: null, preSendResult: null, error: null, analyze: m.analyze, reset: vi.fn() }),
}));
vi.mock("@/hooks/useWalletAnalysis", () => ({ useWalletAnalysis: () => ({ phase: "idle", reset: m.walletReset, analyze: vi.fn() }) }));
vi.mock("@/hooks/useRecentScans", () => ({ useRecentScans: () => ({ addScan: vi.fn() }) }));
vi.mock("@/hooks/useBookmarks", () => ({ useBookmarks: () => ({}) }));
vi.mock("@/hooks/useKeyboardNav", () => ({ useKeyboardNav: vi.fn() }));
vi.mock("@/hooks/useHashRouting", () => ({
  useHashRouting: () => ({ pendingHash: null, dismissPendingHash: vi.fn(), skipNextHashChangeRef: m.skip }),
}));
vi.mock("@/lib/hash-nav", () => ({ setHash: m.setHash }));
vi.mock("@/components/wallet/XpubPrivacyWarning", () => ({ isXpubPrivacyAcked: () => true }));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ network: "mainnet", customApiUrl: null, isUmbrel: false, config: { mempoolBaseUrl: "https://mempool.space/api" } }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }) }));

import { useScanner } from "../useScanner";

const TXID = "b".repeat(64);

beforeEach(() => { vi.clearAllMocks(); m.skip.current = false; window.location.hash = ""; });

describe("useScanner.handleBroadcastSuccess", () => {
  it("sets the tx hash and starts an awaitIndexing scan", () => {
    const { result } = renderHook(() => useScanner());
    act(() => { result.current.handleBroadcastSuccess(TXID); });
    expect(m.setHash).toHaveBeenCalledWith(`tx=${TXID}`);
    expect(m.skip.current).toBe(true);
    expect(m.walletReset).toHaveBeenCalled();
    expect(m.analyze).toHaveBeenCalledWith(TXID, { awaitIndexing: true });
  });

  it("does not arm the hashchange skip when the hash is already the tx", () => {
    window.location.hash = `#tx=${TXID}`;
    const { result } = renderHook(() => useScanner());
    act(() => { result.current.handleBroadcastSuccess(TXID); });
    expect(m.skip.current).toBe(false);
    expect(m.analyze).toHaveBeenCalledWith(TXID, { awaitIndexing: true });
  });
});
