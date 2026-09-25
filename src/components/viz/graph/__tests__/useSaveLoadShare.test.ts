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
