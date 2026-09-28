// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => undefined }));

const boltzmann = vi.hoisted(() => ({ result: null as unknown, isSupported: true, tooComplex: false }));
vi.mock("@/hooks/useBoltzmann", () => ({
  useBoltzmann: () => ({
    state: boltzmann.isSupported ? { status: "complete", result: boltzmann.result } : { status: "idle", result: null },
    compute: vi.fn(),
    autoComputed: true,
    isSupported: boltzmann.isSupported,
    tooComplex: boltzmann.tooComplex,
  }),
}));

import { LinkabilityHeatmap } from "../LinkabilityHeatmap";

afterEach(() => {
  cleanup();
  boltzmann.isSupported = true;
  boltzmann.tooComplex = false;
});

const NOTE = /entropy finding merges UTXOs that share an address/;

function makeTx(inAddrs: string[], outAddrs: string[]): MempoolTransaction {
  return {
    txid: "t".repeat(64),
    vin: inAddrs.map((a, i) => ({
      txid: String(i).repeat(64),
      vout: 0,
      is_coinbase: false,
      prevout: { scriptpubkey_address: a, value: 10_000 * (i + 1), scriptpubkey_type: "v0_p2wpkh" },
    })),
    vout: outAddrs.map((a, i) => ({ scriptpubkey_address: a, value: 5_000 * (i + 1), scriptpubkey_type: "v0_p2wpkh" })),
    status: { confirmed: true },
  } as unknown as MempoolTransaction;
}

function result(nIn: number, nOut: number): BoltzmannWorkerResult {
  const mat = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 0.5));
  return {
    type: "result", id: "x", matLnkCombinations: mat, matLnkProbabilities: mat,
    nbCmbn: 3, entropy: 1.58, efficiency: 0.5, nbCmbnPrfctCj: 3, deterministicLinks: [],
    timedOut: false, elapsedMs: 10, nInputs: nIn, nOutputs: nOut, fees: 0,
    intraFeesMaker: 0, intraFeesTaker: 0,
  };
}

describe("LinkabilityHeatmap merged-address note", () => {
  it("explains the per-UTXO vs merged entropy gap when inputs share an address", () => {
    boltzmann.result = result(2, 2);
    render(<LinkabilityHeatmap tx={makeTx(["bc1qa", "bc1qa"], ["bc1qx", "bc1qy"])} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("stays hidden when every address is distinct", () => {
    boltzmann.result = result(2, 2);
    render(<LinkabilityHeatmap tx={makeTx(["bc1qa", "bc1qb"], ["bc1qx", "bc1qy"])} />);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("LinkabilityHeatmap JoinMarket model results", () => {
  // Shape of the 6cb2433f result: links forced by the maker model come back as
  // modelLinks (never deterministicLinks) and cells are clamped to [1%, 99%].
  function jmResult(): BoltzmannWorkerResult {
    const mat = [[0.99, 0.01], [0.2, 0.2]];
    return {
      ...result(2, 2), matLnkProbabilities: mat, matLnkCombinations: [[99, 1], [20, 20]],
      nbCmbn: 9_085_194_458, entropy: 33.08, method: "joinmarket",
      deterministicLinks: [], modelLinks: [[0, 0]],
    };
  }

  it("shows model links as likely, never as the critical deterministic pill", () => {
    boltzmann.result = jmResult();
    render(<LinkabilityHeatmap tx={makeTx(["bc1qa", "bc1qb"], ["bc1qx", "bc1qy"])} />);
    expect(screen.queryByText(/deterministic link/)).toBeNull();
    const pill = screen.getByTestId("model-links");
    expect(pill.textContent).toMatch(/likely under the JoinMarket maker model/);
    expect(pill.className).not.toMatch(/critical/);
  });

  it("labels the entropy a model estimate, not an upper bound, and never shows 0% or 100%", () => {
    boltzmann.result = jmResult();
    render(<LinkabilityHeatmap tx={makeTx(["bc1qa", "bc1qb"], ["bc1qx", "bc1qy"])} />);
    expect(screen.getAllByText(/\(model estimate\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/upper bound/)).toBeNull();
    // Only the color legend says 0% / 100%; no cell does ("-" is a 0% cell)
    expect(screen.getAllByText("100%")).toHaveLength(1);
    expect(screen.getAllByText("0%")).toHaveLength(1);
    expect(screen.queryAllByText("-")).toHaveLength(0);
    expect(screen.getByText("99%")).toBeTruthy();
    expect(screen.getByText("1%")).toBeTruthy();
  });
});

describe("LinkabilityHeatmap beyond the engine", () => {
  it("explains a too-complex transaction instead of hiding the panel", () => {
    boltzmann.isSupported = false;
    boltzmann.tooComplex = true;
    render(<LinkabilityHeatmap tx={makeTx(["bc1qa", "bc1qb"], ["bc1qx", "bc1qy"])} />);
    expect(screen.getByText(/Too complex to compute in the browser/)).toBeTruthy();
    expect(screen.queryByText("Compute Boltzmann LPM")).toBeNull();
  });
});
