import { describe, it, expect, beforeEach } from "vitest";
import { analyzeCoinJoinPremix } from "../coinjoin-premix";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeCoinJoinPremix", () => {
  it("detects tx0 with equal outputs at Whirlpool denomination + fee + toxic change", () => {
    // 1 input, 3 outputs at 1M sats + coordinator fee + toxic change
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 3_500_000 } })],
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 50_000 }), // coordinator fee
        makeVout({ value: 448_500 }), // toxic change
      ],
      fee: 1_500,
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("tx0-premix");
    expect(findings[0].scoreImpact).toBe(5);
    expect(findings[0].severity).toBe("good");
    expect(findings[0].params?.denomCount).toBe(3);
    expect(findings[0].params?.hasToxicChange).toBe(1);
    expect(findings[0].params?.toxicChangeValue).toBe(448_500);
  });

  it("detects tx0 without toxic change (all funds allocated to denominations)", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 2_051_500 } })],
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 50_000 }), // coordinator fee only
      ],
      fee: 1_500,
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("tx0-premix");
    expect(findings[0].params?.hasToxicChange).toBe(0);
  });

  it("detects tx0 at 0.05 BTC denomination", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 10_500_000 } })],
      vout: [
        makeVout({ value: 5_000_000 }),
        makeVout({ value: 5_000_000 }),
        makeVout({ value: 175_000 }), // coordinator fee
        makeVout({ value: 323_500 }), // toxic change
      ],
      fee: 1_500,
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].params?.denomination).toBe("0.05");
  });

  it("rejects coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 1_000_000 }), makeVout({ value: 50_000 })],
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(0);
  });

  it("rejects transactions with no Whirlpool denomination outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 123_456 }),
        makeVout({ value: 123_456 }),
        makeVout({ value: 50_000 }),
      ],
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(0);
  });

  it("tags Samourai-era tx0 with era=samourai in title and params", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 2_051_500 } })],
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 50_000 }),
      ],
      fee: 1_500,
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings[0].params?.era).toBe("samourai");
    expect(findings[0].title).toContain("Samourai");
    expect(findings[0].description).toContain("Samourai");
  });

  it("detects Ashigaru tx0 at 0.025 BTC pool with 5% coordinator fee", () => {
    // 5 outputs at 2.5M sats + ~5% Anti-Sybil fee (125,000 sats)
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender0000000000000000000000000000001", value: 12_625_000 } })],
      vout: [
        makeVout({ value: 2_500_000 }),
        makeVout({ value: 2_500_000 }),
        makeVout({ value: 2_500_000 }),
        makeVout({ value: 2_500_000 }),
        makeVout({ value: 2_500_000 }),
        makeVout({ value: 125_000 }), // 5% coordinator fee
      ],
      fee: 1_500,
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("tx0-premix");
    expect(findings[0].params?.era).toBe("ashigaru");
    expect(findings[0].title).toContain("Ashigaru");
    expect(findings[0].description).toContain("Ashigaru");
  });

  it("rejects transactions with only 1 denomination output", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 1_000_000 }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 48_500 }),
      ],
    });
    const { findings } = analyzeCoinJoinPremix(tx);
    expect(findings).toHaveLength(0);
  });
});
