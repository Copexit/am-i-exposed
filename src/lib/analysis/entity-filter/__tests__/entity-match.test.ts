import { describe, it, expect } from "vitest";
import { detectEntityBehavior, matchEntitySync } from "../entity-match";
import { makeTx, makeVin, makeVout } from "../../heuristics/__tests__/fixtures/tx-factory";

describe("detectEntityBehavior", () => {
  it("detects exchange batch withdrawal pattern", () => {
    // 1 input, 12 outputs with mixed script types
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "v0_p2wpkh" }),
        ),
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "p2pkh" }),
        ),
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "v1_p2tr" }),
        ),
      ],
    });

    const result = detectEntityBehavior(tx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("exchange-batch");
    expect(result!.confidence).toBe("medium");
  });

  it("detects coinbase spend as mining", () => {
    const tx = makeTx({
      vin: [makeVin({ is_coinbase: true })],
      vout: [makeVout()],
    });

    const result = detectEntityBehavior(tx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("mining");
    expect(result!.confidence).toBe("high");
  });

  it("returns null for normal transaction", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });

    const result = detectEntityBehavior(tx);
    expect(result).toBeNull();
  });

  it("does NOT flag batch with uniform script types", () => {
    // 1 input, 12 outputs but all same type - not exchange batch
    const tx = makeTx({
      vin: [makeVin()],
      vout: Array.from({ length: 12 }, () =>
        makeVout({ scriptpubkey_type: "v0_p2wpkh" }),
      ),
    });

    // Only 1 script type, so not flagged as exchange
    const result = detectEntityBehavior(tx);
    expect(result).toBeNull();
  });

  it("flags 2-input batch as exchange batch", () => {
    // 2 inputs (at the limit), 12 outputs, 3+ script types
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "v0_p2wpkh" }),
        ),
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "p2pkh" }),
        ),
        ...Array.from({ length: 4 }, () =>
          makeVout({ scriptpubkey_type: "v1_p2tr" }),
        ),
      ],
    });

    const result = detectEntityBehavior(tx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("exchange-batch");
  });

  it("does NOT flag multi-input tx as exchange batch", () => {
    // 5 inputs, 15 outputs - too many inputs for exchange batch
    const tx = makeTx({
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: [
        ...Array.from({ length: 5 }, () =>
          makeVout({ scriptpubkey_type: "v0_p2wpkh" }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeVout({ scriptpubkey_type: "p2pkh" }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeVout({ scriptpubkey_type: "v1_p2tr" }),
        ),
      ],
    });

    const result = detectEntityBehavior(tx);
    expect(result).toBeNull();
  });
});

describe("matchEntitySync", () => {
  it("returns null for unknown address", () => {
    const result = matchEntitySync("bc1qunknownaddress123");
    expect(result).toBeNull();
  });

  it("matches known OFAC address", () => {
    // From ofac-addresses.json - Hydra market address
    const result = matchEntitySync("12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h");
    expect(result).not.toBeNull();
    expect(result!.ofac).toBe(true);
    expect(result!.confidence).toBe("high");
  });
});
