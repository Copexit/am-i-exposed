// @vitest-environment jsdom
// R5: a local (not broadcast) tx must not reach the graph explorer (fetches, bookmarks)
// or the exchange screening (Chainalysis), while txid scans keep both.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";
import type { ResultViewModel } from "@/lib/view/tx-view-model";

vi.mock("@/components/GraphExplorerPanel", () => ({ GraphExplorerPanel: () => <div data-testid="graph-explorer" /> }));
vi.mock("@/components/results/DeepAnalysisTxid", () => ({ DeepAnalysisTxid: () => null }));
vi.mock("@/components/results/DeepAnalysisAddress", () => ({ DeepAnalysisAddress: () => null }));
vi.mock("@/components/CexRiskPanel", () => ({ CexRiskPanel: () => <div data-testid="cex-risk" /> }));
vi.mock("@/components/CommonMistakes", () => ({ CommonMistakes: () => null }));
vi.mock("@/components/AnalystView", () => ({ AnalystView: () => null }));

import { AnalystWorkspace } from "../AnalystWorkspace";
import { ContextSection } from "../ContextSection";

beforeAll(() => {
  // jsdom has no matchMedia; report a wide screen so the explorer renders inline
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const txData = { txid: "psbt-preview", vin: [], vout: [] } as unknown as MempoolTransaction;
const result = { findings: [] } as unknown as ScoringResult;
const vm = { isCoinJoin: false, all: [], grade: "B" } as unknown as ResultViewModel;

describe("local tx exposure (R5)", () => {
  it("graph explorer: hidden for a local tx, shown for a txid scan", async () => {
    const base = { query: "PSBT · 1 in · 2 out", inputType: "txid" as const, result, txData, addressData: null, addressTxs: null, txBreakdown: null, onScan: () => {} };
    // txid first: resolves the lazy chunk, so the local assertion is not just "not loaded yet"
    const { unmount } = render(<AnalystWorkspace {...base} />);
    expect(await screen.findByTestId("graph-explorer")).toBeTruthy();
    unmount();
    render(<AnalystWorkspace {...base} local />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("graph-explorer")).toBeNull();
  });

  it("exchange screening: hidden for a local tx, shown for a txid scan", () => {
    const base = { query: "PSBT · 1 in · 2 out", inputType: "txid" as const, vm, txData, devMode: false };
    const { unmount } = render(<ContextSection {...base} local />);
    expect(screen.queryByTestId("cex-risk")).toBeNull();
    unmount();
    render(<ContextSection {...base} />);
    expect(screen.getByTestId("cex-risk")).toBeTruthy();
  });
});
