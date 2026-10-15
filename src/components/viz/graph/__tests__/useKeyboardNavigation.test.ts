// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardNavigation } from "../useKeyboardNavigation";
import type { LayoutNode } from "../types";

const N = { txid: "n1", depth: 0 } as LayoutNode;

function press(key: string, opts: { shiftKey?: boolean; selectMode?: boolean } = {}) {
  const onToggleSelect = vi.fn();
  const onToggleExpand = vi.fn();
  const { result } = renderHook(() => useKeyboardNavigation({
    focusedNode: "n1", setFocusedNode: vi.fn(), layoutNodes: [N], nodes: new Map(), rootTxid: "r",
    atCapacity: false, onExpandInput: vi.fn(), onExpandOutput: vi.fn(), onCollapse: vi.fn(),
    onToggleExpand, onToggleSelect, selectMode: opts.selectMode,
  }));
  result.current({ key, shiftKey: !!opts.shiftKey, target: document.body, preventDefault: () => {} } as unknown as React.KeyboardEvent);
  return { onToggleSelect, onToggleExpand };
}

describe("keyboard selection", () => {
  it("Shift+Enter and Shift+Space toggle the focused node's selection, not the sidebar", () => {
    for (const key of ["Enter", " "]) {
      const { onToggleSelect, onToggleExpand } = press(key, { shiftKey: true });
      expect(onToggleSelect).toHaveBeenCalledWith("n1");
      expect(onToggleExpand).not.toHaveBeenCalled();
    }
  });

  it("Enter selects in select mode, and opens the node otherwise", () => {
    expect(press("Enter", { selectMode: true }).onToggleSelect).toHaveBeenCalledWith("n1");
    const plain = press("Enter");
    expect(plain.onToggleExpand).toHaveBeenCalledWith("n1");
    expect(plain.onToggleSelect).not.toHaveBeenCalled();
  });
});
