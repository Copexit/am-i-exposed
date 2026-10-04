// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

vi.mock("../../viz/LinkabilityHeatmap", () => ({ LinkabilityHeatmap: () => <div data-testid="heatmap" /> }));
vi.mock("../../viz/TaintPathDiagram", () => ({ TaintPathDiagram: () => null }));

import { DeepAnalysisTxid } from "../DeepAnalysisTxid";

afterEach(cleanup);
// Resolve the lazy chunks up front so a negative assertion is not just "not loaded yet"
beforeAll(async () => { await import("../../viz/LinkabilityHeatmap"); await import("../../viz/TaintPathDiagram"); });

const prevout = { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "", value: 1_000 };
const tx = (known: boolean) => ({
  txid: "psbt-preview",
  vin: [{ txid: "a".repeat(64), vout: 0, prevout }, { txid: "b".repeat(64), vout: 0, prevout: known ? prevout : null }],
  vout: [{ value: 1_500 }],
}) as unknown as MempoolTransaction;
const result = { findings: [] } as unknown as ScoringResult;

describe("DeepAnalysisTxid matrix gating", () => {
  it("hides the matrix (no compute) for a local tx with a missing input amount", async () => {
    render(<DeepAnalysisTxid result={result} txData={tx(false)} local />);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.queryByTestId("heatmap")).toBeNull();
  });

  it("shows it for a local tx once every amount is known", async () => {
    render(<DeepAnalysisTxid result={result} txData={tx(true)} local />);
    expect(await screen.findByTestId("heatmap")).toBeTruthy();
  });

  it("leaves txid scans unchanged", async () => {
    render(<DeepAnalysisTxid result={result} txData={tx(false)} />);
    expect(await screen.findByTestId("heatmap")).toBeTruthy();
  });
});
