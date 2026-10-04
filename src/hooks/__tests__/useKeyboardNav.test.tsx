// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, fireEvent } from "@testing-library/react";
import { useKeyboardNav } from "../useKeyboardNav";

describe("useKeyboardNav", () => {
  it("Backspace goes back, except while a modal dialog is open", () => {
    const onBack = vi.fn();
    renderHook(() => useKeyboardNav({ onBack }));
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(onBack).toHaveBeenCalledTimes(1);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(onBack).toHaveBeenCalledTimes(1);
    modal.remove();
  });
});
