// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";

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

afterEach(cleanup);

const TXID = (c: string) => c.repeat(64);
type U = { txid: string; vout?: number; value: number; height?: number };

function info(address: string, path: string, utxos: U[], funded = utxos.length): WalletAddressInfo {
  return {
    derived: { address, path, isChange: path.startsWith("1/"), index: Number(path.split("/")[1]) },
    addressData: { chain_stats: { funded_txo_count: funded }, mempool_stats: { funded_txo_count: 0 } },
    txs: [],
    utxos: utxos.map(u => ({
      txid: u.txid, vout: u.vout ?? 0, value: u.value,
      status: u.height ? { confirmed: true, block_height: u.height } : { confirmed: false },
    })),
  } as unknown as WalletAddressInfo;
}

const amounts = () => screen.getAllByTestId("utxo-amount").map(a => a.textContent!.replace(" sats", ""));

describe("WalletUtxoList", () => {
  const wallet = [
    info("bc1qreceiveaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0/12", [
      { txid: TXID("a"), value: 50_000, height: 899_000 },
      { txid: TXID("b"), vout: 1, value: 300, height: 899_990 },
    ]),
    info("bc1qchangebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "1/3", [
      { txid: TXID("a"), vout: 2, value: 120_000, height: 899_000 },
      { txid: "not-a-txid", value: 1_000 },
    ]),
  ];

  it("lists every coin by amount, with badges, ages, hints and a total", () => {
    render(<WalletUtxoList addressInfos={wallet} onScan={() => {}} />);
    expect(amounts()).toEqual(["120,000", "50,000", "1,000", "300"]);
    const [top, second, third, last] = screen.getAllByTestId("utxo-row");
    expect(within(top!).getByText("change")).toBeTruthy();
    expect(within(top!).getByText("1/3")).toBeTruthy();
    expect(within(top!).getByText("1,001 confirmations")).toBeTruthy();
    expect(within(top!).getByText("Same tx as #2")).toBeTruthy();
    expect(within(second!).getByText("receive")).toBeTruthy();
    expect(within(second!).getByText("0/12")).toBeTruthy();
    expect(within(third!).getByText("Unconfirmed")).toBeTruthy();
    expect(within(third!).getByText("Uneconomical at 20 sat/vB")).toBeTruthy();
    expect(within(last!).getByText("Dust")).toBeTruthy();
    expect(within(last!).getByText("Same address as #2")).toBeTruthy();
    expect(screen.getByTestId("utxo-total").textContent).toContain("171,300 sats");
    expect(screen.getByTestId("utxo-total").textContent).toContain("4 UTXOs");
  });

  it("scans only valid txids through onScan, with the full outpoint on title, and labels the copy button", () => {
    const onScan = vi.fn();
    render(<WalletUtxoList addressInfos={wallet} onScan={onScan} />);
    const scans = screen.getAllByRole("button", { name: /^Scan the funding transaction of / });
    expect(scans).toHaveLength(3);
    expect(scans[0]!.getAttribute("title")).toBe(`${TXID("a")}:2`);
    expect(scans[0]!.textContent).toBe("aaaaaaaa...aaaa:2");
    fireEvent.click(scans[0]!);
    expect(onScan).toHaveBeenCalledWith(TXID("a"));
    const third = screen.getAllByTestId("utxo-row")[2]!;
    expect(within(third).queryByRole("button", { name: /^Scan/ })).toBeNull();
    expect(within(third).getByRole("button", { name: "Copy not-a-txid:0" }).getAttribute("type")).toBe("button");
  });

  it("exposes column labels to screen readers as a table", () => {
    render(<WalletUtxoList addressInfos={wallet} onScan={() => {}} />);
    const table = screen.getByRole("table", { name: "Coins (UTXOs)" });
    expect(within(table).getAllByRole("columnheader").map(h => h.textContent)).toEqual(["#", "Coin", "Amount", "Address", "Age", "Origin"]);
    expect(within(within(table).getAllByRole("row")[1]!).getAllByRole("cell")).toHaveLength(6);
  });

  it("sorts by amount both ways and by age", () => {
    render(<WalletUtxoList addressInfos={wallet} onScan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Amount, largest first" }));
    expect(amounts()).toEqual(["300", "1,000", "50,000", "120,000"]);
    expect(screen.getByRole("button", { name: "Amount, smallest first" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Age" }));
    // Oldest first, ties by amount; unconfirmed last
    expect(amounts()).toEqual(["120,000", "50,000", "300", "1,000"]);
    fireEvent.click(screen.getByRole("button", { name: "Age, oldest first" }));
    expect(amounts()).toEqual(["1,000", "300", "120,000", "50,000"]);
  });

  it("collapses to 20 rows with Show all N", () => {
    const many = [info("bc1qmanyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0/0", Array.from({ length: 25 }, (_, i) => ({ txid: TXID("c"), vout: i, value: 10_000 + i, height: 899_500 })))];
    render(<WalletUtxoList addressInfos={many} onScan={() => {}} />);
    expect(screen.getAllByTestId("utxo-row")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show all 25" }));
    expect(screen.getAllByTestId("utxo-row")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByTestId("utxo-row")).toHaveLength(20);
    expect(screen.getByTestId("utxo-total").textContent).toContain(`${(25 * 10_000 + 300).toLocaleString("en-US")} sats`);
  });
});
