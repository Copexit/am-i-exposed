import { describe, it, expect, beforeEach } from "vitest";
import { analyzeChangeDetection } from "../change-detection";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const wpkh = (address: string, value: number) => ({
  scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value,
});

function signalVote(tx: ReturnType<typeof makeTx>, key: string): number | undefined {
  const f = analyzeChangeDetection(tx).findings.find((f) => f.id === "h2-change-detected");
  if (!f) return undefined;
  const details = JSON.parse(f.params!.signalDetails as string) as { key: string; votedOutput: number }[];
  return details.find((d) => d.key === key)?.votedOutput;
}

describe("analyzeChangeDetection - degenerate 1-in/1-out", () => {
  it("does not throw when the only output is OP_RETURN", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ scriptpubkey: "6a04deadbeef", scriptpubkey_type: "op_return", scriptpubkey_address: undefined, value: 0 })],
    });
    const { findings } = analyzeChangeDetection(tx);
    expect(findings.find((f) => f.id === "h2-sweep")).toBeUndefined();
  });

  it("does not throw when the only output has no address (bare P2PK)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ scriptpubkey_type: "p2pk", scriptpubkey_address: undefined, value: 99_000 })],
    });
    expect(() => analyzeChangeDetection(tx)).not.toThrow();
  });
});

describe("unnecessary input change signal", () => {
  it("votes the output smaller than the smallest input as change (Bitcoin wiki example)", () => {
    // Inputs 2 + 3 BTC, outputs ~4 + ~1 BTC. Paying 1 BTC with 4 BTC change
    // would not have needed the 2 BTC input, so the ~1 BTC output is change.
    const tx = makeTx({
      vin: [
        makeVin({ prevout: wpkh("bc1qin1", 200_000_000) }),
        makeVin({ prevout: wpkh("bc1qin2", 300_000_000) }),
      ],
      vout: [
        makeVout({ value: 399_998_123, scriptpubkey_address: "bc1qouta" }),
        makeVout({ value: 100_000_377, scriptpubkey_address: "bc1qoutb" }),
      ],
      fee: 1500,
    });
    expect(signalVote(tx, "unnecessary_input")).toBe(1);
  });

  it("uses the smallest input, not the largest, with 3+ inputs", () => {
    // Inputs 3 + 1 + 1 BTC, outputs ~3.5 + ~1.5 BTC. Neither output is below
    // the smallest input, so both interpretations needed every input.
    const tx = makeTx({
      vin: [
        makeVin({ prevout: wpkh("bc1qin1", 300_000_000) }),
        makeVin({ prevout: wpkh("bc1qin2", 100_000_000) }),
        makeVin({ prevout: wpkh("bc1qin3", 100_000_000) }),
      ],
      vout: [
        makeVout({ value: 350_001_234, scriptpubkey_address: "bc1qouta" }),
        makeVout({ value: 149_997_266, scriptpubkey_address: "bc1qoutb" }),
      ],
      fee: 1500,
    });
    expect(signalVote(tx, "unnecessary_input")).toBeUndefined();
  });

  it("does not double-vote an output already counted as shadow change", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: wpkh("bc1qin1", 100_000_000) }),
        makeVin({ prevout: wpkh("bc1qin2", 100_000_000) }),
      ],
      vout: [
        makeVout({ value: 195_001_234, scriptpubkey_address: "bc1qouta" }),
        makeVout({ value: 4_997_266, scriptpubkey_address: "bc1qoutb" }),
      ],
      fee: 1500,
    });
    expect(signalVote(tx, "shadow_change")).toBe(1);
    expect(signalVote(tx, "unnecessary_input")).toBeUndefined();
  });

  it("does not fire when an input prevout is missing", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: wpkh("bc1qin1", 300_000_000) }),
        makeVin({ prevout: null }),
      ],
      vout: [
        makeVout({ value: 250_001_234, scriptpubkey_address: "bc1qouta" }),
        makeVout({ value: 49_997_266, scriptpubkey_address: "bc1qoutb" }),
      ],
      fee: 1500,
    });
    expect(signalVote(tx, "unnecessary_input")).toBeUndefined();
  });
});
