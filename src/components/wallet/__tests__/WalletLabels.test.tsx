// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { useState } from "react";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) => {
    const key = o.count !== undefined && o.count !== 1 && en[`${k}_other`] ? `${k}_other` : k;
    return (en[key] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
vi.mock("@/hooks/useChainTip", () => ({ useChainTip: () => 900_000 }));

import { WalletLabelsPanel } from "../WalletLabelsPanel";
import { WalletUtxoList } from "../WalletUtxoList";
import { CoinSelector } from "../CoinSelector";
import { WalletLabelsContext } from "../WalletLabels";
import { TxRefList } from "@/components/FindingCardTables";
import { History, recv, chg, ext } from "@/lib/analysis/__tests__/fixtures/wallet-history";
import { matchLabels, withLabels } from "@/lib/wallet/labels";
import { buildCoinInputs } from "@/lib/analysis/coin-selection";
import type { Bip329Record } from "@/lib/wallet/bip329";

afterEach(cleanup);

function wallet() {
  const h = new History();
  const kyc = h.receive(recv(0), 500_000, 100);
  const nokyc = h.receive(recv(1), 300_000, 101);
  const [, change] = h.tx([kyc], [{ address: ext(1), value: 200_000 }, { address: chg(0), value: 299_000 }], 102);
  const infos = h.infos([
    { address: recv(0), isChange: false, index: 0 },
    { address: recv(1), isChange: false, index: 1 },
    { address: chg(0), isChange: true, index: 0 },
  ]);
  return { kyc, nokyc, change: change!, infos };
}

const { kyc, nokyc, change, infos } = wallet();
const LINES = [
  `{"type":"output","ref":"${kyc.txid}:0","label":"[KYC] Bitstamp · withdrawal"}`,
  `{"type":"addr","ref":"${recv(1)}","label":"[noKYC] Bisq · trade 7"}`,
  `{"type":"output","ref":"${nokyc.txid}:0","spendable":false}`,
  `{"type":"tx","ref":"${change.txid}","label":"rent March"}`,
  `{"type":"tx","ref":"${"e".repeat(64)}","label":"elsewhere"}`,
  "garbage",
].join("\n");

function Harness() {
  const [records, setRecords] = useState<Bip329Record[]>([]);
  const labels = records.length ? matchLabels(records, infos) : null;
  return (
    <WalletLabelsContext.Provider value={labels}>
      <WalletLabelsPanel records={records} onChange={setRecords} addressInfos={infos} xpub="xpubTEST" />
      <WalletUtxoList addressInfos={infos} onScan={() => {}} />
      <TxRefList txidsJson={JSON.stringify([change.txid])} more={0} />
    </WalletLabelsContext.Provider>
  );
}

describe("wallet labels UI", () => {
  it("imports pasted labels, summarizes, shows chips, labels, inheritance and groups; clears", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("BIP329 JSON Lines, one record per line"), { target: { value: LINES } });
    fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
    expect(screen.getByTestId("labels-summary").textContent).toBe("4 labels applied, 1 not matching this wallet, 1 invalid");

    const rows = screen.getAllByTestId("utxo-row");
    const changeRow = rows.find(r => r.textContent!.includes("299,000"))!;
    // Rule 4: change inherits [KYC], shown dashed
    expect(within(changeRow).getByTestId("label-tag-kyc").className).toContain("border-dashed");
    const nokycRow = rows.find(r => r.textContent!.includes("300,000"))!;
    expect(within(nokycRow).getByText("[noKYC] Bisq · trade 7")).toBeTruthy();
    expect(within(nokycRow).getByText("Frozen")).toBeTruthy();
    expect(within(nokycRow).getByText("address label")).toBeTruthy();
    // Tx label on a finding's transaction reference
    expect(within(screen.getByTestId("finding-tx-refs")).getByText("rent March")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Group by label" }));
    const groups = screen.getAllByTestId("utxo-label-group");
    expect(groups.map(g => within(g).getAllByTestId("utxo-row").length)).toEqual([1, 1]);
    expect(groups[0]!.textContent).toContain("Bisq");
    // KYC change and Bitstamp share the kyc:bitstamp origin; the KYC coin was spent, so only the change remains.
    expect(groups[1]!.textContent).toContain("Bitstamp");

    fireEvent.click(screen.getByRole("button", { name: "Clear labels" }));
    expect(screen.queryAllByTestId("label-tag-kyc")).toHaveLength(0);
  });

  it("exports the merged file with the short-hash filename", async () => {
    const clicks: { download: string; href: string }[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = (b: Blob) => { blobs.push(b); return "blob:x"; };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push({ download: this.download, href: this.href }); });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("BIP329 JSON Lines, one record per line"), { target: { value: LINES } });
    fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
    fireEvent.click(screen.getByTestId("labels-export"));
    expect(clicks[0]!.download).toMatch(/^[0-9a-f]{8}-labels\.jsonl$/);
    const text = await act(() => blobs[0]!.text());
    const lines = text.trim().split("\n").map(l => JSON.parse(l) as Bip329Record);
    expect(lines.find(l => l.ref === `${kyc.txid}:0`)!.label).toBe("[KYC] Bitstamp · withdrawal");
    expect(lines.find(l => l.ref === `${change.txid}:1`)!.label).toMatch(/^aie: /);
    vi.restoreAllMocks();
  });

  it("coin selector: frozen coins left out unless included; KYC + noKYC merge shows the broken rule", () => {
    const labels = matchLabels([
      { type: "output", ref: `${change.txid}:1`, label: "[KYC] Bitstamp" },
      { type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Bisq", spendable: false },
    ], infos);
    render(<CoinSelector utxos={withLabels(buildCoinInputs(infos), labels)} />);
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText("Fee (sat/vB)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    expect(screen.getByText(/Not enough funds/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include the frozen coin (1)"));
    const plan = screen.getAllByTestId(/^coin-plan-/)[0]!;
    expect(within(plan).getByText(/Merges \[KYC\] coins with \[noKYC\] coins/)).toBeTruthy();
    expect(within(within(plan).getByTestId("plan-label-rules")).getByText("KYC kept apart from no-KYC")).toBeTruthy();
    expect(within(plan).getByText("Frozen")).toBeTruthy();
  });

  it("coin selector: new coins or labels clear the advice; the frozen toggle re-runs the submitted inputs", () => {
    const labels = matchLabels([{ type: "output", ref: `${nokyc.txid}:0`, spendable: false }], infos);
    const coins = withLabels(buildCoinInputs(infos), labels);
    const { rerender } = render(<CoinSelector utxos={coins} />);
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText("Fee (sat/vB)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    expect(screen.getByText(/Not enough funds/)).toBeTruthy();
    // An unsubmitted edit is not used by the toggle
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("Include the frozen coin (1)"));
    const plan = screen.getAllByTestId(/^coin-plan-/)[0]!;
    expect(plan.textContent).toContain("300,000");
    expect(plan.textContent).toContain("299,000");
    rerender(<CoinSelector utxos={withLabels(buildCoinInputs(infos), null)} />);
    expect(screen.queryAllByTestId(/^coin-plan-/)).toHaveLength(0);
  });
});
