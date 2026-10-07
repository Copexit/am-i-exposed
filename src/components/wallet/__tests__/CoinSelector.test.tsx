// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { CoinSelectionInput } from "@/lib/analysis/coin-selection";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

import { CoinSelector } from "../CoinSelector";

afterEach(cleanup);

const coin = (value: number, txid: string, address: string, extra: Partial<CoinSelectionInput> = {}): CoinSelectionInput => ({
  utxo: { txid: txid.padEnd(64, "0"), vout: 0, value, status: { confirmed: true } },
  address,
  ...extra,
});

function run(utxos: CoinSelectionInput[], amount: string) {
  render(<CoinSelector utxos={utxos} />);
  fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("Fee (sat/vB)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
}

describe("CoinSelector", () => {
  it("keeps both inputs and the button in one end-aligned grid row", () => {
    render(<CoinSelector utxos={[]} />);
    const form = screen.getByRole("button", { name: "Suggest selection" }).closest("form")!;
    expect(form.className).toMatch(/\bgrid\b/);
    expect(form.className).toContain("items-end");
  });

  it("shows the best single coin as a summary with one clean row", () => {
    run([coin(100_000, "aa", "bc1qa"), coin(40_000, "bb", "bc1qb")], "20000");
    const plan = screen.getByTestId("coin-plan-single-coin");
    expect(within(plan).getByText("Best single coin")).toBeTruthy();
    expect(within(plan).getByText("40,000 sats")).toBeTruthy();
    expect(within(within(plan).getAllByRole("list")[0]!).getAllByRole("listitem")).toHaveLength(1);
    expect(plan.textContent).not.toContain("|");
  });

  it("offers same-origin and fewest-coins plans plus a Stonewall note when no coin pays alone", () => {
    run([
      coin(60_000, "c1", "bc1qx"),
      coin(50_000, "c2", "bc1qy"),
      coin(30_000, "s1", "bc1qshared"),
      coin(25_000, "s2", "bc1qshared"),
      coin(20_000, "s3", "bc1qshared", { reusedAddress: true }),
    ], "70000");
    expect(screen.queryByText(/Not enough funds/)).toBeNull();
    const same = screen.getByTestId("coin-plan-same-origin");
    expect(within(same).getByText("Recommended")).toBeTruthy();
    expect(within(same).getAllByText("Same address as #1").length).toBeGreaterThan(0);
    expect(within(same).getByText("Reused address")).toBeTruthy();
    const fewest = screen.getByTestId("coin-plan-fewest-coins");
    expect(within(fewest).getByText(/Joins 2 unrelated origins/)).toBeTruthy();
    expect(screen.getByText("Advanced: Stonewall")).toBeTruthy();
  });

  it("shows a recommended No change plan next to the single coin, with the trade-off", () => {
    run([coin(500_000, "big", "bc1qbig"), coin(41_000, "p1", "bc1qp1"), coin(20_000, "p2", "bc1qp2")], "60000");
    const noChange = screen.getByTestId("coin-plan-no-change");
    const single = screen.getByTestId("coin-plan-single-coin");
    expect(noChange.compareDocumentPosition(single) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(noChange).getByText("Recommended")).toBeTruthy();
    expect(within(noChange).getByText(/Leaves no change output to follow, but spending these coins together links them/)).toBeTruthy();
    expect(within(within(noChange).getAllByRole("list")[0]!).getAllByRole("listitem")).toHaveLength(2);
    expect(within(single).queryByText("Recommended")).toBeNull();
    expect(within(single).getByText(/leaves a change output that observers can follow/)).toBeTruthy();
  });

  it("says nothing new is revealed when the no-change coins share an address", () => {
    run([coin(150_000, "big", "bc1qbig"), coin(41_000, "p1", "bc1qsame"), coin(20_000, "p2", "bc1qsame")], "60000");
    expect(within(screen.getByTestId("coin-plan-no-change")).getByText(/already linked, so nothing new is revealed/)).toBeTruthy();
  });

  it("shows inline feedback for an invalid amount and drops the old advice", () => {
    run([coin(100_000, "aa", "bc1qa")], "20000");
    expect(screen.getByTestId("coin-plan-single-coin")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a whole amount");
    expect(screen.queryByTestId("coin-plan-single-coin")).toBeNull();
  });

  it("announces one short summary line instead of the whole result", () => {
    run([coin(100_000, "aa", "bc1qa")], "20000");
    expect(screen.getByRole("status").textContent).toBe("Options found: 1. Recommended: Best single coin.");
  });

  it("says insufficient only when the whole wallet cannot pay, with the shortfall", () => {
    run([coin(30_000, "aa", "bc1qa"), coin(20_000, "bb", "bc1qb")], "60000");
    expect(screen.getByRole("status").textContent).toContain("10,177 sats short");
  });
});
