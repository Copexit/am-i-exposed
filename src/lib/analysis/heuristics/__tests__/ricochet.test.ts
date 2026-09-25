import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRicochet } from "../ricochet";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

const ASHIGARU_FEE_ADDRESS = "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2";
const ASHIGARU_FEE_SATS = 100_000;

beforeEach(() => resetAddrCounter());

describe("analyzeRicochet", () => {
  it("detects Ricochet hop 0 with Ashigaru fee output", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender000000000000000000000000000001", value: 500_000 } })],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }),
        makeVout({ value: 300_000 }), // ricochet amount
        makeVout({ value: 98_500 }),   // change
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.id).toBe("ricochet-hop0");
    expect(f!.severity).toBe("good");
    expect(f!.confidence).toBe("deterministic");
    expect(f!.scoreImpact).toBe(5);
  });

  it("returns no findings for coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }),
        makeVout({ value: 300_000 }),
        makeVout({ value: 98_500 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when fewer than 3 outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }),
        makeVout({ value: 300_000 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when fee address matches but amount differs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: 50_000 }),
        makeVout({ value: 300_000 }),
        makeVout({ value: 148_500 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when amount matches but address differs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: ASHIGARU_FEE_SATS }), // different address
        makeVout({ value: 300_000 }),
        makeVout({ value: 98_500 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for a normal 3-output transaction without fee address", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }),
        makeVout({ value: 18_500 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(0);
  });

  it("detects Ricochet even when fee output is not the first output", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 300_000 }),
        makeVout({ value: 98_500 }),
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.id).toBe("ricochet-hop0");
  });

  it("detects Ricochet with more than 3 outputs", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }),
        makeVout({ value: 200_000 }),
        makeVout({ value: 150_000 }),
        makeVout({ value: 48_000 }),
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.id).toBe("ricochet-hop0");
  });

  it("includes ricochetOutputIndex param pointing to the largest non-fee output", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender000000000000000000000000000001", value: 500_000 } })],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }), // vout 0 = fee
        makeVout({ value: 300_000 }), // vout 1 = ricochet amount (largest non-fee)
        makeVout({ value: 98_500 }),  // vout 2 = change
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.params).toBeDefined();
    expect(f!.params!.ricochetOutputIndex).toBe(1);
    expect(f!.params!.hop0Txid).toBe(tx.txid);
  });

  it("identifies correct ricochet output when fee is last", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ value: 300_000 }), // vout 0 = ricochet amount (largest non-fee)
        makeVout({ value: 98_500 }),   // vout 1 = change
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }), // vout 2 = fee
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.params!.ricochetOutputIndex).toBe(0);
  });

  it("identifies correct ricochet output with 4+ outputs", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [
        makeVout({ scriptpubkey_address: ASHIGARU_FEE_ADDRESS, value: ASHIGARU_FEE_SATS }), // vout 0 = fee
        makeVout({ value: 48_000 }),   // vout 1 = small change
        makeVout({ value: 200_000 }),  // vout 2 = ricochet amount (largest non-fee)
        makeVout({ value: 150_000 }),  // vout 3 = another output
      ],
    });

    const { findings } = analyzeRicochet(tx);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.params!.ricochetOutputIndex).toBe(2);
  });
});
