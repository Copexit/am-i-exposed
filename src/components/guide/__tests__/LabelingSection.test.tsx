// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

import { LabelingSection, SpendingChecklist } from "../LabelingSection";
import { parseBip329 } from "@/lib/wallet/bip329";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("LabelingSection", () => {
  it("has an anchor per spending rule, for the warnings' links", () => {
    const { container } = render(<LabelingSection />);
    for (const n of [1, 2, 3, 4, 5]) expect(container.querySelector(`#labeling-rule-${n}`)).toBeTruthy();
    expect(container.querySelector("#labeling-rule-1")!.textContent).toContain("Never merge [KYC] coins with [noKYC] coins.");
  });

  it("has the Sparrow how-to and downloads a valid example labels file", async () => {
    render(<LabelingSection />);
    expect(screen.getByText(/double-click the Label column of a transaction/)).toBeTruthy();
    expect(screen.getByText(/choose Freeze UTXO/)).toBeTruthy();
    const blobs: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = (b: Blob) => { blobs.push(b); return "blob:x"; };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    fireEvent.click(screen.getByRole("button", { name: "Download an example labels file" }));
    expect(names).toEqual(["example-labels.jsonl"]);
    const parsed = parseBip329(await act(() => blobs[0]!.text()))!;
    expect(parsed.invalid).toBe(0);
    expect(parsed.records.length).toBeGreaterThan(5);
  });

  it("spending checklist: nine ordered rules, rule 9 never calls a CoinJoin merge good", () => {
    const { container } = render(<SpendingChecklist />);
    expect(container.querySelector("#spending-checklist")!.textContent).toBe("Spending checklist");
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(9);
    expect(items[0]!.id).toBe("spending-rule-1");
    expect(items[0]!.textContent).toMatch(/already knows one of your coins/);
    expect(items[5]!.textContent).toBe("Never send to an address that was used before. Ask for a new one.");
    expect(items[8]!.textContent).toMatch(/least bad.*never good/);
  });
});
