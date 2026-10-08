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
    expect(within(plan).getByText("Single coin")).toBeTruthy();
    expect(within(plan).getByText("40,000 sats")).toBeTruthy();
    expect(within(within(plan).getAllByRole("list")[0]!).getAllByRole("listitem")).toHaveLength(1);
    expect(plan.textContent).not.toContain("|");
  });

  it("offers already-linked and several-coins plans plus a Stonewall note when no coin pays alone", () => {
    run([
      coin(60_000, "c1", "bc1qx"),
      coin(50_000, "c2", "bc1qy"),
      coin(30_000, "s1", "bc1qshared"),
      coin(25_000, "s2", "bc1qshared"),
      coin(20_000, "s3", "bc1qshared", { reusedAddress: true }),
    ], "70000");
    expect(screen.queryByText(/Not enough funds/)).toBeNull();
    // The same-address coins leave under 5,000 sats of change: first comes their no-change version
    const same = screen.getAllByTestId(/^coin-plan-/)[0]!;
    expect(within(same).getByTestId("plan-absorbs").textContent).toBe("No change: +4,755 sats to miners");
    expect(within(same).getByText("Recommended")).toBeTruthy();
    expect(within(screen.getByTestId("coin-plan-same-origin")).getByText(/Leaves only/)).toBeTruthy();
    expect(within(same).getAllByText("Same address as #1").length).toBeGreaterThan(0);
    expect(within(same).getByText("Reused address")).toBeTruthy();
    const fewest = screen.getAllByTestId("coin-plan-multi-coin")[0]!;
    expect(within(fewest).getByText(/Joins 2 unrelated origins/)).toBeTruthy();
    expect(screen.getByText("Advanced: Stonewall")).toBeTruthy();
  });

  it("shows a recommended No change plan next to the single coin, with the trade-off", () => {
    run([coin(500_000, "big", "bc1qbig"), coin(41_000, "p1", "bc1qp1"), coin(20_000, "p2", "bc1qp2")], "60000");
    const noChange = screen.getByTestId("coin-plan-no-change");
    const single = screen.getByTestId("coin-plan-single-coin");
    expect(noChange.compareDocumentPosition(single) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(noChange).getByText("Recommended")).toBeTruthy();
    expect(within(noChange).getByText("Coins whose total equals the payment plus fee, so no change output is created that anyone can follow.")).toBeTruthy();
    expect(within(noChange).getByTestId("plan-reason").textContent).toMatch(/^Links 2 group/);
    expect(within(within(noChange).getAllByRole("list")[0]!).getAllByRole("listitem")).toHaveLength(2);
    expect(within(noChange).getByText("The fee includes 823 sats of leftover, too small to be worth a change output.")).toBeTruthy();
    expect(within(single).queryByText("Recommended")).toBeNull();
    expect(within(single).getByText(/leaves a change output that observers can follow/)).toBeTruthy();
  });

  it("shows a no-change set on one address first: it links nothing new", () => {
    run([coin(150_000, "big", "bc1qbig"), coin(41_000, "p1", "bc1qsame"), coin(20_000, "p2", "bc1qsame")], "60000");
    expect(screen.getAllByTestId(/^coin-plan-/)[0]!.dataset.testid).toBe("coin-plan-no-change");
    expect(within(screen.getByTestId("coin-plan-no-change")).getByTestId("plan-reason").textContent).toBe("Links nothing new and leaves no change.");
  });

  it("uses the same copy for linked coins of one tx", () => {
    run([
      coin(150_000, "big", "bc1qbig"),
      { ...coin(41_000, "self", "bc1qc1", { cluster: "self" }) },
      { ...coin(20_000, "self", "bc1qc2", { cluster: "self" }), utxo: { txid: "self".padEnd(64, "0"), vout: 1, value: 20_000, status: { confirmed: true } } },
    ], "60000");
    const plan = screen.getByTestId("coin-plan-no-change");
    expect(within(plan).getByText("Links nothing new and leaves no change.")).toBeTruthy();
    expect(within(plan).getByText("Same tx as #2")).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toBe("Options found: 1. Recommended: Single coin.");
  });

  it("says insufficient only when the whole wallet cannot pay, with the shortfall", () => {
    run([coin(30_000, "aa", "bc1qa"), coin(20_000, "bb", "bc1qb")], "60000");
    expect(screen.getByRole("status").textContent).toContain("10,177 sats short");
  });

  it("ranks by a criterion without dropping warnings; Recommended only under Privacy first; 3 shown, then all", () => {
    render(<CoinSelector utxos={[
      coin(900_000, "a1", "bc1qa1"), coin(260_000, "a2", "bc1qa2"), coin(130_000, "a3", "bc1qa3", { origin: "coinjoin-change" }),
      coin(70_000, "k1", "bc1qk1", { cluster: "k" }), coin(45_000, "k2", "bc1qk2", { cluster: "k" }), coin(30_000, "k3", "bc1qk3", { cluster: "k" }),
      coin(61_000, "p1", "bc1qp1"), coin(40_500, "p2", "bc1qp2"), coin(25_000, "p3", "bc1qp3"), coin(12_000, "p4", "bc1qp4"),
    ]} />);
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "100800" } });
    fireEvent.change(screen.getByLabelText("Fee (sat/vB)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    const cards = () => screen.getAllByTestId(/^coin-plan-/);
    expect(cards()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Privacy first" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(cards()[0]!).getByText("Recommended")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Show all \d+ options$/ }));
    const all = cards().length;
    expect(all).toBeGreaterThan(3);
    const warnings = cards().map(c => within(c).queryAllByRole("listitem").length).reduce((a, b) => a + b, 0);

    fireEvent.click(screen.getByRole("button", { name: "No change if possible" }));
    expect(cards()).toHaveLength(all);
    expect(cards()[0]!.dataset.testid).toBe("coin-plan-no-change");
    expect(screen.queryByText("Recommended")).toBeNull();
    // Same plans, same warnings and coin rows, another order
    expect(cards().map(c => within(c).queryAllByRole("listitem").length).reduce((a, b) => a + b, 0)).toBe(warnings);
    fireEvent.click(screen.getByRole("button", { name: "Lowest fee" }));
    const fees = cards().map(c => Number(within(c).getByText("Fee").nextElementSibling!.textContent!.replace(/\D/g, "")));
    expect(fees).toEqual([...fees].sort((a, b) => a - b));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer options" }));
    expect(cards()).toHaveLength(3);
  });

  it("offers small change to miners: a no-change card with the extra fee, recommended in the tester's case", () => {
    render(<CoinSelector utxos={[
      coin(165_519_188, "big", "bc1qbig", { origin: "change" }),
      coin(3_296_321, "pay", "bc1qpay1", { origin: "change", cluster: "p1", group: "pay" }),
      { ...coin(2_399_400, "pay", "bc1qpay2", { origin: "change", cluster: "p2", group: "pay" }), utxo: { txid: "pay".padEnd(64, "0"), vout: 1, value: 2_399_400, status: { confirmed: true } } },
      coin(64_332, "r1", "bc1qr1", { origin: "received" }),
      coin(38_625, "r2", "bc1qr2", { origin: "received" }),
    ]} />);
    expect((screen.getByLabelText("Max extra fee to avoid change") as HTMLInputElement).value).toBe("5000");
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    const first = screen.getAllByTestId(/^coin-plan-/)[0]!;
    expect(within(first).getByTestId("plan-absorbs").textContent).toBe("No change: +2,072 sats to miners");
    expect(within(first).getByText("Recommended")).toBeTruthy();
    expect(within(first).getByTestId("plan-reason").textContent).toContain("Pays 2,072 sats more fee so no change is left.");
    // Turned off: no variant
    fireEvent.change(screen.getByLabelText("Max extra fee to avoid change"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    expect(screen.queryByTestId("plan-absorbs")).toBeNull();
  });
});

