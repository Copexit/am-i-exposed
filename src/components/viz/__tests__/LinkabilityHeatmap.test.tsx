// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key,
  }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => undefined }));

const boltzmann = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/hooks/useBoltzmann", () => ({
  useBoltzmann: () => ({
    state: { status: "complete", result: boltzmann.result },
    compute: vi.fn(),
    autoComputed: true,
    isSupported: true,
  }),
}));

import { LinkabilityHeatmap } from "../LinkabilityHeatmap";

afterEach(cleanup);

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
