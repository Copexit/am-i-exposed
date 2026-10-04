// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { base64, hex } from "@scure/base";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";

vi.setConfig({ testTimeout: 20_000 });
const { idbPut } = vi.hoisted(() => ({ idbPut: vi.fn() }));
vi.mock("@/lib/api/idb-cache", () => ({
  idbGet: vi.fn(), idbPut, idbDelete: vi.fn(), idbClear: vi.fn(),
  idbCount: vi.fn(), idbEvict: vi.fn(), _resetForTest: vi.fn(),
}));
vi.mock("@/lib/analysis/boltzmann-compute", () => ({ isAutoComputable: () => false, computeBoltzmann: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o: Record<string, unknown> = {}) =>
      (typeof o.defaultValue === "string" ? o.defaultValue : k)
        .replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw)),
    i18n: { language: "en" },
  }),
}));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet", setNetwork: vi.fn(),
    config: { mempoolBaseUrl: "https://mempool.space/api", explorerUrl: "https://mempool.space", label: "mainnet" },
    configFor: () => ({ mempoolBaseUrl: "https://mempool.space/api" }),
    customApiUrl: null, isUmbrel: false, isCustomApi: false,
  }),
}));

import { useScanner } from "../useScanner";

// A valid entry, so the load-time migration keeps it as is
const BOOKMARKS = JSON.stringify([{ input: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", type: "address", grade: "B", score: 80, savedAt: 1 }]);

function signedRawHex() {
  const tx = buildPsbt({ sign: true });
  tx.finalize();
  return hex.encode(tx.extract());
}

describe("local tx privacy", () => {
  // replaceState, not location.hash = "": the latter queues a hashchange that resets the scan
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("bookmarks", BOOKMARKS);
    history.replaceState(null, "", "/");
    idbPut.mockClear();
  });

  it.each([
    ["PSBT", () => base64.encode(buildPsbt({ sign: true, nonWitness: true }).toPSBT()), "cHNidP"],
    ["signed raw tx", signedRawHex, "0200"],
  ])("a %s scan writes nothing to localStorage, IndexedDB or the hash", async (_name, build, prefix) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const payload = build();
    const { result } = renderHook(() => useScanner());
    await act(async () => { result.current.handleSubmit(payload); });
    await vi.waitFor(() => expect(result.current.analysis.phase).toBe("complete"), { timeout: 15_000 });

    expect(result.current.analysis.localTx).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(localStorage.getItem("recent-scans")).toBeNull();
    expect(localStorage.getItem("bookmarks")).toBe(BOOKMARKS);
    expect(idbPut).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("mempool"))).toHaveLength(0);
    expect(result.current.analysis.query).not.toContain(prefix);
    expect(result.current.analysis.query).not.toContain(payload.slice(0, 16));
    fetchSpy.mockRestore();
  });
});
