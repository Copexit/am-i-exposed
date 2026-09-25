// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useFullscreen } from "../useFullscreen";

describe("useFullscreen", () => {
  it("expands with a body scroll lock and collapses via collapse()", () => {
    const onExit = vi.fn();
    const { result } = renderHook(() => useFullscreen(onExit));
    act(() => result.current.expand());
    expect(result.current.isExpanded).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => result.current.collapse());
    expect(result.current.isExpanded).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("collapses on Escape only while expanded", () => {
    const onExit = vi.fn();
    const { result } = renderHook(() => useFullscreen(onExit));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onExit).not.toHaveBeenCalled();

    act(() => result.current.expand());
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(result.current.isExpanded).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
