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

describe("useSaveLoadShare - layout mode", () => {
  const txid = "d".repeat(64);
  const nodes = new Map([[txid, { txid, depth: 0 }]]) as never;
  const stored = () => JSON.parse(localStorage.getItem("ami-saved-graphs") ?? "[]") as { id: string; layoutMode?: string }[];
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("saves the time layout, and Update rewrites it when the mode changes", () => {
    const { result, rerender } = renderHook(
      ({ layoutMode, currentGraphId }: { layoutMode: "hops" | "time"; currentGraphId: string | null }) =>
        useSaveLoadShare({ nodes, rootTxid: txid, rootTxids: new Set([txid]), network: "mainnet", currentGraphId, layoutMode }),
      { initialProps: { layoutMode: "time", currentGraphId: null } },
    );
    act(() => { result.current.handleSave(); });
    const [saved] = stored();
    expect(saved?.layoutMode).toBe("time");

    rerender({ layoutMode: "hops", currentGraphId: saved!.id });
    act(() => { result.current.handleUpdate(); });
    expect(stored()[0]?.layoutMode).toBeUndefined();

    rerender({ layoutMode: "time", currentGraphId: saved!.id });
    act(() => { result.current.handleUpdate(); });
    expect(stored()[0]?.layoutMode).toBe("time");
  });
});

describe("useSaveLoadShare - hidden nodes", () => {
  const root = "e".repeat(64), kid = "f".repeat(64);
  const nodes = new Map([[root, { txid: root, depth: 0 }], [kid, { txid: kid, depth: 1 }]]) as never;
  const stored = () => JSON.parse(localStorage.getItem("ami-saved-graphs") ?? "[]") as { id: string; hiddenTxids?: string[] }[];
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("saves the hidden txids, and Update rewrites them", () => {
    const { result, rerender } = renderHook(
      ({ hiddenTxids, currentGraphId }: { hiddenTxids: Set<string>; currentGraphId: string | null }) =>
        useSaveLoadShare({ nodes, rootTxid: root, rootTxids: new Set([root]), network: "mainnet", currentGraphId, hiddenTxids }),
      { initialProps: { hiddenTxids: new Set([kid, "a".repeat(64)]), currentGraphId: null as string | null } },
    );
    act(() => { result.current.handleSave(); });
    const [saved] = stored();
    // A hidden txid no longer in the graph is not saved
    expect(saved?.hiddenTxids).toEqual([kid]);

    rerender({ hiddenTxids: new Set(), currentGraphId: saved!.id });
    act(() => { result.current.handleUpdate(); });
    expect(stored()[0]?.hiddenTxids).toBeUndefined();

    rerender({ hiddenTxids: new Set([kid]), currentGraphId: saved!.id });
    act(() => { result.current.handleUpdate(); });
    expect(stored()[0]?.hiddenTxids).toEqual([kid]);
  });
});
