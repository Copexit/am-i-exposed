// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { summarize, type TxAttribution } from "@/lib/services/wabisabi-attribution";
import type { ServiceCheck as HookState } from "@/hooks/useServiceCheck";

vi.mock("react-i18next", () => {
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (typeof o.defaultValue === "string" ? o.defaultValue : k).replace(/\{\{(\w+)\}\}/g, (raw, n: string) => (n in o ? String(o[n]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ isUmbrel: false }) }));
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
const renderCard = (mode: "tx" | "wallet-like" = "tx", onScan = vi.fn()) =>
  render(<ServiceCheck txids={[A, R1, R2]} mode={mode} totalAvailable={80} isLocalCoinJoin={() => false} onScan={onScan} />);

const coinjoin = (isBlame: boolean): TxAttribution => ({
  kind: "coinjoin", txid: A, coordinator: { key: "kruw", name: "Kruw" }, roundId: "r", time: 1_700_000_000, isBlame,
  feeRate: 3, inputs: 200, outputs: 250, anonsetIn: 4.2, anonsetOut: 9.1, freshBtc: 0.5,
  inputOrigins: { fresh: 10, remix: 5, other: 1 }, remixFrom: [], remixedFromRounds: [], remixedIntoRounds: [], nonStandardOutputs: 0,
});
const coin = (roundTxid: string, index: number) => ({ roundTxid, coordinator: "kruw", name: "Kruw", time: 1_700_000_000, index, sats: 5000 });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ServiceCheck", () => {
  it("idle shows the privacy line with the count, the cap note and the button", () => {
    setState("idle");
    renderCard("wallet-like");
    expect(screen.getByText(/Sends 3 transaction ID\(s\) to Wabisator/)).toBeTruthy();
    expect(screen.getByText("Checks the 3 most recent of 80 transactions.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check CoinJoin services" }));
    expect(start).toHaveBeenCalledOnce();
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
    expect(screen.getByText("1 coins came out of recorded CoinJoins")).toBeTruthy();
    expect(screen.getByText("1 coins went into recorded CoinJoins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Scan ${R2}` }));
    expect(onScan).toHaveBeenCalledWith(R2);
  });
  it("wallet-like done with post-mix merges shows the warning", () => {
    setState("done", [{ kind: "linked", txid: A, outOf: [coin(R1, 0), coin(R2, 1)], into: [] }]);
    renderCard("wallet-like");
    expect(screen.getByText(/1 transactions spent coins from different CoinJoin outputs together/)).toBeTruthy();
  });
  it("error shows Retry, which calls retryFailed", () => {
    setState("done", [{ kind: "error", txid: A, message: "x" }]);
    renderCard();
    expect(screen.getByText(/Wabisator could not be reached/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryFailed).toHaveBeenCalledOnce();
  });
});
