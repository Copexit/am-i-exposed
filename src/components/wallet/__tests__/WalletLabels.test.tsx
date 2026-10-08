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
  const labels = records.length ? matchLabels(records, infos, "xpubTEST") : null;
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
    expect(screen.getByTestId("labels-summary").textContent).toBe("5 labels read: 3 on current coins, 1 on past transactions and addresses, 1 for other wallets, 1 invalid");

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

  it("tag chips explain themselves on focus, with a link to the guide; inherited ones say so", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("BIP329 JSON Lines, one record per line"), { target: { value: LINES } });
    fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
    const changeRow = screen.getAllByTestId("utxo-row").find(r => r.textContent!.includes("299,000"))!;
    const chip = within(changeRow).getByTestId("label-tag-kyc");
    expect(chip.tagName).toBe("BUTTON");
    expect(screen.queryByTestId("label-tag-tip")).toBeNull();
    fireEvent.focus(chip);
    const tip = screen.getByTestId("label-tag-tip");
    expect(chip.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toContain("Bought or withdrawn with your identity");
    expect(tip.textContent).toContain("Inherited from the coins it came from.");
    expect(within(tip).getByRole("link", { name: "Labeling recommendations" }).getAttribute("href")).toBe("/guide/#labeling-coins");
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByTestId("label-tag-tip")).toBeNull();
  });

  it("a label warning names and links its rule", () => {
    const labels = matchLabels([
      { type: "output", ref: `${change.txid}:1`, label: "[KYC] Bitstamp" },
      { type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Bisq" },
    ], infos);
    render(<CoinSelector utxos={withLabels(buildCoinInputs(infos), labels)} />);
    fireEvent.change(screen.getByLabelText("Amount (sats)"), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText("Fee (sat/vB)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest selection" }));
    const link = screen.getByRole("link", { name: "Rule 1: never merge KYC with no-KYC" });
    expect(link.getAttribute("href")).toBe("/guide/#labeling-rule-1");
  });

  it("lists label checks in the panel and marks the affected coins", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    // The noKYC coin is a receipt: [change] on it is wrong, and Sparrow's "(change)" on a receive address too
    fireEvent.change(screen.getByLabelText("BIP329 JSON Lines, one record per line"), {
      target: { value: `{"type":"output","ref":"${nokyc.txid}:0","label":"[change] Bisq (change)"}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
    const checks = screen.getByTestId("label-checks");
    expect(within(checks).getByText(/Labeled \[change\], but the coin was received from someone else/)).toBeTruthy();
    expect(within(checks).getByText(/does not match the address chain/)).toBeTruthy();
    const marked = screen.getAllByTestId("label-check-marker");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest("[data-testid='utxo-row']")!.textContent).toContain("300,000");
  });
});

describe("labels panel: summary, wallet origin, grouping", () => {
  it("says only the positive counts when nothing is for another wallet or invalid", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("BIP329 JSON Lines, one record per line"), { target: { value: LINES.split("\n").slice(0, 4).join("\n") } });
    fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
    expect(screen.getByTestId("labels-summary").textContent).toBe("4 labels read: 3 on current coins, 1 on past transactions and addresses");
  });

  it("sets the wallet-level origin on the xpub record: unlabeled coins take it", () => {
    render(<Harness />);
    expect(screen.queryAllByTestId("label-tag-nokyc")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("This wallet holds"), { target: { value: "nokyc" } });
    // Every unlabeled coin now counts as no-KYC, and the note says so
    expect(screen.getAllByTestId("label-tag-nokyc").length).toBe(screen.getAllByTestId("utxo-row").length);
    expect(screen.getByText(/Coins with no origin prefix of their own count as no-KYC/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("This wallet holds"), { target: { value: "" } });
    expect(screen.queryAllByTestId("label-tag-nokyc")).toHaveLength(0);
  });

  it("groups by origin and observer, not by the whole label, and hints when no label has a prefix", () => {
    const l = matchLabels([
      { type: "output", ref: `${change.txid}:1`, label: "[noKYC] Juan · RoboSats compra · 250 EUR" },
      { type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Juan · Bisq venta" },
    ], infos);
    const { unmount } = render(<WalletLabelsContext.Provider value={l}><WalletUtxoList addressInfos={infos} onScan={() => {}} /></WalletLabelsContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Group by label" }));
    const groups = screen.getAllByTestId("utxo-label-group");
    expect(within(groups[0]!).getAllByTestId("utxo-row")).toHaveLength(2);
    expect(screen.queryByTestId("no-prefix-hint")).toBeNull();
    unmount();
    const plain = matchLabels([{ type: "output", ref: `${change.txid}:1`, label: "e (change)" }], infos);
    render(<WalletLabelsContext.Provider value={plain}><WalletUtxoList addressInfos={infos} onScan={() => {}} /></WalletLabelsContext.Provider>);
    expect(screen.getByTestId("no-prefix-hint").textContent).toMatch(/None of your labels use origin prefixes/);
    // Shown without Sparrow's suffix
    expect(screen.getByTestId("label-text").textContent).toBe("e");
  });
});

describe("labels hint (no labels loaded)", () => {
  it("shows a quiet hint with both links, and remembers its dismissal", () => {
    localStorage.clear();
    const onImport = vi.fn();
    const { unmount } = render(<WalletUtxoList addressInfos={infos} onScan={() => {}} onImportLabels={onImport} />);
    const hint = screen.getByTestId("labels-hint");
    expect(within(hint).getByRole("link", { name: "Labeling recommendations" }).getAttribute("href")).toBe("/guide/#labeling-coins");
    fireEvent.click(within(hint).getByRole("button", { name: "Import labels" }));
    expect(onImport).toHaveBeenCalled();
    fireEvent.click(within(hint).getByRole("button", { name: "Dismiss the labeling tip" }));
    expect(screen.queryByTestId("labels-hint")).toBeNull();
    unmount();
    render(<WalletUtxoList addressInfos={infos} onScan={() => {}} />);
    expect(screen.queryByTestId("labels-hint")).toBeNull();
    localStorage.clear();
  });

  it("is not shown while labels are loaded", () => {
    localStorage.clear();
    render(
      <WalletLabelsContext.Provider value={matchLabels([{ type: "tx", ref: change.txid, label: "rent" }], infos)}>
        <WalletUtxoList addressInfos={infos} onScan={() => {}} />
      </WalletLabelsContext.Provider>,
    );
    expect(screen.queryByTestId("labels-hint")).toBeNull();
  });
});
