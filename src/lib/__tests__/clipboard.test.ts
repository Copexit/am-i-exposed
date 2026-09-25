// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "../clipboard";

describe("copyToClipboard (no Clipboard API, e.g. plain-HTTP self-hosted node)", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("returns true when the execCommand fallback succeeds", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => true), configurable: true });
    await expect(copyToClipboard("abc")).resolves.toBe(true);
  });

  it("returns false when execCommand reports failure without throwing", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => false), configurable: true });
    await expect(copyToClipboard("abc")).resolves.toBe(false);
  });

  it("removes the temporary textarea", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => true), configurable: true });
    await copyToClipboard("abc");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});
