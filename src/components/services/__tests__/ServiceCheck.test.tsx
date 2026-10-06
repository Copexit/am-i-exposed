// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { summarize, type TxAttribution } from "@/lib/services/wabisabi-attribution";
import postmix from "@/lib/services/__tests__/fixtures/wabisator-search-postmix.json";
import type { ServiceCheck as HookState } from "@/hooks/useServiceCheck";

vi.mock("react-i18next", () => {
  const t = (k: string, o: Record<string, unknown> = {}) => {
    const d = o.count !== 1 && typeof o.defaultValue_other === "string" ? o.defaultValue_other : o.defaultValue;
    return (typeof d === "string" ? d : k).replace(/\{\{(\w+)\}\}/g, (raw, n: string) => (n in o ? String(o[n]) : raw));
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
const net = vi.hoisted(() => ({ network: "mainnet" }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false, network: net.network }) }));
const hook = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@/hooks/useServiceCheck", () => ({ useServiceCheck: () => hook.state }));
import { ServiceCheck } from "../ServiceCheck";

const A = "a".repeat(64), R1 = "1".repeat(64), R2 = "2".repeat(64);
const start = vi.fn(), retryFailed = vi.fn();
function setState(phase: HookState["phase"], results: TxAttribution[] = []) {
  hook.state = {
    phase, done: results.length, total: results.length, results, start, retryFailed,
    summary: phase === "done" ? summarize(results, () => false) : null,
  } satisfies HookState;
}
const renderCard = (mode: "tx" | "wallet-like" = "tx", onScan = vi.fn(), isLocal: (txid: string) => boolean = () => false, txids = [A, R1, R2]) =>
  render(<ServiceCheck txids={txids} mode={mode} totalAvailable={80} isLocalCoinJoin={isLocal} onScan={onScan} />);

const coinjoin = (isBlame: boolean): TxAttribution => ({
  kind: "coinjoin", txid: A, coordinator: { key: "kruw", name: "Kruw" }, roundId: "r", time: 1_700_000_000, isBlame,
  feeRate: 3, inputs: 200, outputs: 250, anonsetIn: 4.2, anonsetOut: 9.1, freshBtc: 0.5,
  inputOrigins: { fresh: 10, remix: 5, other: 1 }, remixFrom: [], remixedFromRounds: [], remixedIntoRounds: [], nonStandardOutputs: 0,
});
const coin = (roundTxid: string, index: number) => ({ roundTxid, coordinator: "kruw", name: "Kruw", time: 1_700_000_000, index, sats: 5000 });

afterEach(() => { cleanup(); vi.clearAllMocks(); net.network = "mainnet"; });

describe("ServiceCheck", () => {
  it("idle shows the privacy line with the count, the cap note and the button", () => {
    setState("idle");
    renderCard("wallet-like");
    expect(screen.getByText(/Sends 3 transaction IDs to Wabisator/)).toBeTruthy();
    expect(screen.getByText("Checks the 3 most recent of 80 transactions.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check CoinJoin services" }));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByText(/lets Wabisator see that they belong to one wallet/)).toBeTruthy();
    expect(screen.getByText(/these transactions took part in WabiSabi CoinJoins/)).toBeTruthy();
  });
  it("renders nothing off mainnet (Wabisator only covers mainnet)", () => {
    net.network = "signet";
    setState("idle");
    const { container } = renderCard("wallet-like");
    expect(container.innerHTML).toBe("");
  });
  it("tx idle keeps the single-transaction wording and no cluster sentence", () => {
    setState("idle");
    renderCard("tx");
    expect(screen.getByText(/whether this was part of a WabiSabi CoinJoin/)).toBeTruthy();
    expect(screen.queryByText(/belong to one wallet/)).toBeNull();
    cleanup();
    renderCard("tx", vi.fn(), () => false, [A]);
    expect(screen.getByText(/Sends 1 transaction ID to Wabisator/)).toBeTruthy();
  });
  it("wallet-like done lists rounds and linked txs, each expandable to its tx view with a scan button", () => {
    setState("done", [coinjoin(false), { kind: "linked", txid: R1, outOf: [coin(R2, 0)], into: [] }]);
    const onScan = vi.fn();
    const { container } = renderCard("wallet-like", onScan);
    expect(screen.getByText("Transactions with recorded CoinJoin activity")).toBeTruthy();
    const items = [...container.querySelectorAll("li > details")];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Kruw");
    expect(items[0]?.textContent).toContain("Avg. input anonset");
    expect(items[1]?.textContent).toContain("5,000 sats");
    expect(items[1]?.textContent).toContain("1 coin came out of recorded CoinJoins");
    fireEvent.click(screen.getByRole("button", { name: `Scan ${A}` }));
    expect(onScan).toHaveBeenCalledWith(A);
    fireEvent.click(screen.getAllByRole("button", { name: `Scan ${R1}` })[0]!);
    expect(onScan).toHaveBeenCalledWith(R1);
  });
  it("wallet-like done with nothing found shows the many-tx none text and coverage, no tiles", () => {
    setState("done", [{ kind: "none", txid: A }, { kind: "none", txid: R1 }]);
    renderCard("wallet-like");
    expect(screen.getByText("No recorded WabiSabi CoinJoin activity for these transactions.")).toBeTruthy();
    expect(screen.getByText(/No record here does not rule out Whirlpool/)).toBeTruthy();
    expect(screen.queryByText("CoinJoin rounds")).toBeNull();
  });
  it("tx coinjoin shows the coordinator, and the blame tag only for blame rounds", () => {
    setState("done", [coinjoin(false)]);
    renderCard();
    expect(screen.getByText("Kruw")).toBeTruthy();
    expect(screen.queryByText("Blame round")).toBeNull();
    cleanup();
    setState("done", [coinjoin(true)]);
    renderCard();
    expect(screen.getByText("Blame round")).toBeTruthy();
  });
  it("linked view lists rows and a row's scan button scans that round", () => {
    setState("done", [{ kind: "linked", txid: A, outOf: [coin(R1, 0)], into: [coin(R2, 3)] }]);
    const onScan = vi.fn();
    renderCard("tx", onScan);
    expect(screen.getByText("1 coin came out of recorded CoinJoins")).toBeTruthy();
    expect(screen.getByText("1 coin went into recorded CoinJoins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Scan ${R2}` }));
    expect(onScan).toHaveBeenCalledWith(R2);
  });
  it("wallet-like done with post-mix merges shows the warning", () => {
    setState("done", [{ kind: "linked", txid: A, outOf: [coin(R1, 0), coin(R2, 1)], into: [] }]);
    renderCard("wallet-like");
    expect(screen.getByText(/1 transaction spent coins from different CoinJoin outputs together/)).toBeTruthy();
    expect(screen.getByText("2 coins · 2 rounds")).toBeTruthy();
  });
  const postmixResult: TxAttribution = {
    kind: "linked", txid: A, into: [],
    outOf: postmix.result.Transaction.OutOf.map((c) => ({ roundTxid: c.CoinjoinTxId, coordinator: c.Coordinator, name: c.Name, time: c.Time, index: c.Vin, sats: c.Value })),
  };
  it("tx linked view groups 45 post-mix coins into 13 rounds, 5 shown until Show all", () => {
    setState("done", [postmixResult]);
    const { container } = renderCard("tx");
    expect(screen.getByText("45 coins came out of recorded CoinJoins")).toBeTruthy();
    expect(screen.getByText("from 13 rounds")).toBeTruthy();
    const rows = () => [...container.querySelectorAll("ul > li")];
    expect(rows()).toHaveLength(5);
    const sats = rows().map((li) => Number(/([\d,]+) sats/.exec(li.textContent ?? "")![1]!.replace(/,/g, "")));
    expect(sats).toEqual([...sats].sort((a, b) => b - a));
    fireEvent.click(screen.getByRole("button", { name: "Show all 13 rounds" }));
    expect(rows()).toHaveLength(13);
    const counts = screen.getAllByText(/^\d+ coins?$/).map((e) => parseInt(e.textContent ?? "", 10));
    expect(counts).toHaveLength(13);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(45);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
  it("tx post-mix warning shows unless the engine already calls the tx a CoinJoin", () => {
    setState("done", [postmixResult]);
    renderCard("tx");
    expect(screen.getByText("This transaction spent 45 coins from 13 CoinJoin rounds together, which links them again.")).toBeTruthy();
    cleanup();
    renderCard("tx", vi.fn(), (txid) => txid === A);
    expect(screen.queryByText(/This transaction spent/)).toBeNull();
    cleanup();
    setState("done", [{ kind: "linked", txid: A, outOf: [coin(R1, 0)], into: [] }]);
    renderCard("tx");
    expect(screen.queryByText(/This transaction spent/)).toBeNull();
  });
  it("error shows Retry, which calls retryFailed", () => {
    setState("done", [{ kind: "error", txid: A, message: "x" }]);
    renderCard();
    expect(screen.getByText(/Wabisator could not be reached/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryFailed).toHaveBeenCalledOnce();
  });
});
