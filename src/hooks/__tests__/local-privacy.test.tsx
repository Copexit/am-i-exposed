// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { base64 } from "@scure/base";
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

describe("local tx privacy", () => {
  // replaceState, not location.hash = "": the latter queues a hashchange that resets the scan
  beforeEach(() => { localStorage.clear(); history.replaceState(null, "", "/"); });

  it("a PSBT scan writes nothing to localStorage, IndexedDB or the hash", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const psbt = base64.encode(buildPsbt({ sign: true, nonWitness: true }).toPSBT());
    const { result } = renderHook(() => useScanner());
    await act(async () => { result.current.handleSubmit(psbt); });
    await vi.waitFor(() => expect(result.current.analysis.phase).toBe("complete"), { timeout: 15_000 });

    expect(window.location.hash).toBe("");
    expect(localStorage.getItem("recent-scans")).toBeNull();
    expect(idbPut).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("mempool"))).toHaveLength(0);
    expect(result.current.analysis.query).not.toContain("cHNidP");
  });
});
