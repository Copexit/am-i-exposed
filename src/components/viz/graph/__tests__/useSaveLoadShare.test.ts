// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

import { useSaveLoadShare } from "../useSaveLoadShare";

describe("useSaveLoadShare - handleShare", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    // Plain-HTTP self-hosted node (Umbrel/StartOS): no secure context, no Clipboard API
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
  });

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    const txid = "a".repeat(64);
    const nodes = new Map([[txid, { txid, depth: 0 }]]) as never;
    const { result } = renderHook(() =>
      useSaveLoadShare({ nodes, rootTxid: txid, rootTxids: new Set([txid]), network: "mainnet" }),
    );

    await act(async () => {
      result.current.handleShare();
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(result.current.toast).toBe("Link copied to clipboard");
  });
});

describe("useSaveLoadShare - storage failures", () => {
  const txid = "b".repeat(64);
  const nodes = new Map([[txid, { txid, depth: 0 }]]) as never;
  const render = (currentGraphId: string | null = null) =>
    renderHook(() =>
      useSaveLoadShare({ nodes, rootTxid: txid, rootTxids: new Set([txid]), network: "mainnet", currentGraphId }),
    );
  const quotaExceeded = () =>
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  const STORAGE_FULL = "Browser storage is full. Delete some bookmarks or saved graphs and try again.";

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reports full storage (not the 50-graph limit) when the write fails", () => {
    quotaExceeded();
    const { result } = render();

    act(() => { result.current.handleSave(); });

    expect(result.current.toast).toBe(STORAGE_FULL);
  });

  it("reports the 50-graph limit when it is reached", () => {
    const saved = Array.from({ length: 50 }, (_, i) => ({
      id: `g${i}`, name: `g${i}`, network: "mainnet", savedAt: i, rootTxid: txid, rootTxids: [txid],
      nodes: [{ txid, depth: 0 }],
    }));
    localStorage.setItem("ami-saved-graphs", JSON.stringify(saved));
    const { result } = render();

    act(() => { result.current.handleSave(); });

    expect(result.current.toast).toBe("Max 50 saved graphs reached");
  });

  it("does not claim success when updating a graph fails to write", () => {
    const { result } = render("some-id");
    quotaExceeded();

    act(() => { result.current.handleUpdate(); });

    expect(result.current.toast).toBe(STORAGE_FULL);
  });
});
