/**
 * Golden wallets: synthetic offline histories through the full wallet audit.
 * Pins grade, score and every finding with its impact (docs/spec-wallet-heuristics.md, Scoring).
 * A change here is a scoring change: justify it in the commit and in docs/testing-reference.md.
 */
import { describe, it, expect } from "vitest";
import { auditWallet } from "../wallet-audit";
import { goldenWallet, cleanWallet } from "./fixtures/wallet-history";

const pin = (r: ReturnType<typeof auditWallet>) => ({
  grade: r.grade,
  score: r.score,
  findings: r.findings.map((f) => `${f.id} ${f.scoreImpact}`).sort(),
});

describe("golden wallets", () => {
  it("golden wallet: C 52", () => {
    expect(pin(auditWallet(goldenWallet()))).toEqual({
      grade: "C",
      score: 52,
      findings: [
        "wallet-change-exposed -4",
        "wallet-change-merge -4",
        "wallet-no-reuse 5",
        "wallet-peel-chain -3",
        "wallet-postmix-merge -15",
        "wallet-uniform-script 3",
      ],
    });
  });

  it("clean wallet: B 81", () => {
    expect(pin(auditWallet(cleanWallet()))).toEqual({
      grade: "B",
      score: 81,
      findings: ["wallet-no-merge 3", "wallet-no-reuse 5", "wallet-uniform-script 3"],
    });
  });

  it("golden wallet coin origins", () => {
    const o = auditWallet(goldenWallet()).utxoOrigins;
    expect(o["coinjoin-change"]).toEqual({ count: 1, sats: 995_000 });
    expect(o.change).toEqual({ count: 1, sats: 2_547_000 });
  });
});
