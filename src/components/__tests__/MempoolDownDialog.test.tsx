// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
  }),
}));

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ isUmbrel: true, localApiStatus: "unavailable" }),
}));

import { MempoolDownDialog } from "../MempoolDownDialog";

afterEach(cleanup);

describe("MempoolDownDialog", () => {
  it("is a labelled modal alertdialog with initial focus inside", () => {
    render(<MempoolDownDialog />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId && document.getElementById(labelId)?.textContent).toBe("Mempool Unreachable");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: /Reload Page/ })).toBeTruthy();
  });

  it("closes on the Dismiss button", () => {
    render(<MempoolDownDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<MempoolDownDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("traps Tab inside the dialog", () => {
    render(<MempoolDownDialog />);
    const reload = screen.getByRole("button", { name: /Reload Page/ });
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    dismiss.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(reload);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dismiss);
  });

  it("returns focus to the previously focused element on dismiss", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render(<MempoolDownDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
