// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useMemo } from "react";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) => {
    const key = o.count !== undefined && o.count !== 1 && en[`${k}_other`] ? `${k}_other` : k;
    return (en[key] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => 900_000 }));

import { WalletUtxoList } from "../WalletUtxoList";
import { CoinSelector } from "../CoinSelector";
import { WalletLabelsContext } from "../WalletLabels";
import { useCoinControl } from "../useCoinControl";
import { testerHistory, TESTER_CJ_CHANGE } from "@/lib/analysis/__tests__/fixtures/wallet-history";
import { buildCoinInputs, outpointOf, evaluateSelection } from "@/lib/analysis/coin-selection";
import { matchLabels, withLabels } from "@/lib/wallet/labels";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";

const { h, addresses } = testerHistory();
const infos = h.infos(addresses);
const coins = buildCoinInputs(infos);
const op = (value: number) => outpointOf(coins.find(c => c.utxo.value === value)!);
const XPUB = "xpubTESTWALLET";

function Workspace({ infos: i = infos, xpub = XPUB, labels = null }: { infos?: WalletAddressInfo[]; xpub?: string; labels?: ReturnType<typeof matchLabels> | null }) {
  const utxos = useMemo(() => withLabels(buildCoinInputs(i), labels), [i, labels]);
  const c = useCoinControl(xpub, utxos);
  return (
    <WalletLabelsContext.Provider value={labels}>
      <WalletUtxoList addressInfos={i} onScan={() => {}} control={c} />
      <CoinSelector utxos={utxos} control={c} />
    </WalletLabelsContext.Provider>
  );
}

const box = (value: number) => screen.getByRole("checkbox", { name: new RegExp(`\\(${value.toLocaleString("en-US")} sats\\)`) });
const bar = () => screen.getByTestId("coin-control-bar");

beforeEach(() => {
  window.history.replaceState(null, "", `/#xpub=${XPUB}`);
  Element.prototype.scrollIntoView = vi.fn(); // not in jsdom
});
afterEach(cleanup);

describe("manual coin control", () => {
  it("ticks coins and sums them; the bar shows fee, change, links and warnings from the advisor's plan", () => {
    render(<Workspace />);
    expect(screen.queryByTestId("coin-control-bar")).toBeNull();
    fireEvent.click(box(591_429));
    fireEvent.click(box(TESTER_CJ_CHANGE));
    expect(within(bar()).getByRole("status").textContent).toBe(`2 coins selected · ${(591_429 + TESTER_CJ_CHANGE).toLocaleString("en-US")} sats`);
    expect(within(bar()).getByText(/Enter the amount to pay/)).toBeTruthy();
    fireEvent.change(within(bar()).getByLabelText("Amount (sats)"), { target: { value: "600000" } });
    const e = evaluateSelection(coins, new Set([op(591_429), op(TESTER_CJ_CHANGE)]), 600_000, 5);
    if (e.kind !== "plan") throw new Error(e.kind);
    expect(within(bar()).getByText(`${e.plan.fee.toLocaleString("en-US")} sats`)).toBeTruthy();
    expect(within(bar()).getByText(`${e.plan.change.toLocaleString("en-US")} sats`)).toBeTruthy();
    // Probably linked already (same payments), so the link is a probable one
    expect(within(bar()).getByText("1 probable")).toBeTruthy();
    expect(within(bar()).getByText(/Spends CoinJoin change, which is not mixed/)).toBeTruthy();
    // Not enough
    fireEvent.click(box(TESTER_CJ_CHANGE));
    expect(within(bar()).getByText(/sats short of the amount plus fee/)).toBeTruthy();
    fireEvent.click(within(bar()).getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("coin-control-bar")).toBeNull();
  });

  it("compares the manual set with the suggestions, ranked under the current criterion", () => {
    render(<Workspace />);
    fireEvent.click(box(99_000_000));
    fireEvent.click(box(591_429));
    fireEvent.change(within(bar()).getByLabelText("Amount (sats)"), { target: { value: "600000" } });
    fireEvent.click(within(bar()).getByRole("button", { name: "Compare with suggestions" }));
    // The selector shares the amount and runs with it
    expect((screen.getAllByLabelText("Amount (sats)")[0] as HTMLInputElement).value).toBe("600000");
    const manual = screen.getByTestId("coin-plan-manual");
    expect(within(manual).getByText("Your selection")).toBeTruthy();
    // 99M + 591k costs 25 (half a link, change, 165x big change): after the pair (10) and the 99M coin (19),
    // before the CoinJoin coin (27.65)
    expect(within(manual).getByTestId("manual-rank").textContent).toBe("3 of 4 · Privacy first");
    // Fewest coins: both single coins, then the pairs by privacy cost
    fireEvent.click(screen.getByRole("button", { name: "Fewest coins" }));
    expect(within(screen.getByTestId("coin-plan-manual")).getByTestId("manual-rank").textContent).toBe("4 of 4 · Fewest coins");
    // Recommended only under Privacy first
    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("marks a suggestion as the user's own when it holds the same coins", () => {
    render(<Workspace />);
    fireEvent.click(box(591_429));
    fireEvent.click(box(134_361));
    fireEvent.change(within(bar()).getByLabelText("Amount (sats)"), { target: { value: "600000" } });
    fireEvent.click(within(bar()).getByRole("button", { name: "Compare with suggestions" }));
    const plans = screen.getAllByTestId(/^coin-plan-/);
    expect(plans).toHaveLength(3);
    expect(plans[0]!.dataset.testid).toBe("coin-plan-manual");
    expect(within(plans[0]!).getByText("Recommended")).toBeTruthy();
    expect(within(plans[0]!).getByTestId("manual-rank").textContent).toBe("1 of 3 · Privacy first");
  });

  it("asks before selecting a frozen coin", () => {
    const labels = matchLabels([{ type: "output", ref: op(591_429), spendable: false }], infos);
    render(<Workspace labels={labels} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(box(591_429));
    expect((box(591_429) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box(591_429));
    expect((box(591_429) as HTMLInputElement).checked).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    // Unfrozen coins: no question
    fireEvent.click(box(134_361));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});

describe("manual coin control: small change", () => {
  it("offers to pay small change to miners and shows no change", () => {
    render(<Workspace />);
    fireEvent.click(box(591_429));
    fireEvent.click(box(134_361));
    fireEvent.change(within(bar()).getByLabelText("Amount (sats)"), { target: { value: "720000" } });
    expect(within(bar()).getByText("4,750 sats")).toBeTruthy();
    fireEvent.click(within(bar()).getByLabelText("Pay the 4,750 sats of change to miners (no change)"));
    expect(within(bar()).getByText("No change")).toBeTruthy();
    expect(within(bar()).getByText("5,790 sats")).toBeTruthy();
  });
});

describe("coin control URL state", () => {
  it("keeps the max extra fee in the hash when not the default", () => {
    window.history.replaceState(null, "", `/#xpub=${XPUB}&absorb=0`);
    render(<Workspace />);
    expect((screen.getByLabelText("Max extra fee to avoid change") as HTMLInputElement).value).toBe("0");
    fireEvent.change(screen.getByLabelText("Max extra fee to avoid change"), { target: { value: "5000" } });
    expect(window.location.hash).toBe(`#xpub=${XPUB}`);
    fireEvent.change(screen.getByLabelText("Max extra fee to avoid change"), { target: { value: "8000" } });
    expect(window.location.hash).toBe(`#xpub=${XPUB}&absorb=8000`);
  });

  it("restores the criterion and the coins of this wallet from the hash, and writes changes back", () => {
    window.history.replaceState(null, "", `/#xpub=${XPUB}&rank=least-change&coins=${op(134_361)},${"f".repeat(64)}:9`);
    render(<Workspace />);
    expect((box(134_361) as HTMLInputElement).checked).toBe(true);
    // An outpoint not in this wallet is dropped
    expect(within(bar()).getByRole("status").textContent).toMatch(/^1 coin selected/);
    fireEvent.click(box(591_429));
    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get("xpub")).toBe(XPUB);
    expect(params.get("rank")).toBe("least-change");
    expect(params.get("coins")!.split(",").sort()).toEqual([op(134_361), op(591_429)].sort());
    fireEvent.click(within(bar()).getByRole("button", { name: "Clear" }));
    expect(window.location.hash).toBe(`#xpub=${XPUB}&rank=least-change`);
  });

  it("keeps the recipient in the hash only (to=), restores it, and drops it when cleared", () => {
    const to = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    window.history.replaceState(null, "", `/#xpub=${XPUB}&to=${to}`);
    render(<Workspace />);
    const field = screen.getByLabelText("Recipient address (optional)") as HTMLInputElement;
    expect(field.value).toBe(to);
    fireEvent.change(field, { target: { value: "" } });
    expect(window.location.hash).toBe(`#xpub=${XPUB}`);
    fireEvent.change(field, { target: { value: ` ${to} ` } });
    expect(window.location.hash).toBe(`#xpub=${XPUB}&to=${to}`);
    // Not address characters: never written
    fireEvent.change(field, { target: { value: "<script>" } });
    expect(window.location.hash).toBe(`#xpub=${XPUB}`);
  });

  it("ignores and never writes the keys when the hash holds another wallet", () => {
    window.history.replaceState(null, "", `/#xpub=xpubOTHER&coins=${op(134_361)}`);
    render(<Workspace />);
    expect((box(134_361) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box(591_429));
    expect(window.location.hash).toBe(`#xpub=xpubOTHER&coins=${op(134_361)}`);
  });

  it("drops the selection when another wallet is loaded", () => {
    const { rerender } = render(<Workspace />);
    fireEvent.click(box(591_429));
    expect(screen.getByTestId("coin-control-bar")).toBeTruthy();
    rerender(<Workspace xpub="xpubSECOND" />);
    expect(screen.queryByTestId("coin-control-bar")).toBeNull();
  });
});
