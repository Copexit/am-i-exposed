import { describe, it, expect, beforeEach } from "vitest";
import { analyzeRoundAmounts } from "../round-amount";
import { makeTx, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const ids = (tx: ReturnType<typeof makeTx>, ctx: Parameters<typeof analyzeRoundAmounts>[2]) =>
  analyzeRoundAmounts(tx, undefined, ctx).findings.map((f) => f.id);

describe("analyzeRoundAmounts - fiat guards", () => {
  it("emits no fiat finding when every output is round in USD or EUR", () => {
    // out0 = $100 at 97,531 USD/BTC, out1 = EUR50 at 90,000 EUR/BTC.
    const tx = makeTx({ vout: [makeVout({ value: 102_532 }), makeVout({ value: 55_556 })] });
    const found = ids(tx, { usdPrice: 97_531, eurPrice: 90_000 });
    expect(found).not.toContain("h1-round-usd-amount");
    expect(found).not.toContain("h1-round-eur-amount");
  });

  it("does not count a BTC-round output again as a round USD output", () => {
    // out0 = 0.001 BTC (BTC-round) = $100 at 100,000 USD/BTC.
    const tx = makeTx({ vout: [makeVout({ value: 100_000 }), makeVout({ value: 48_723 })] });
    const found = ids(tx, { usdPrice: 100_000 });
    expect(found).toContain("h1-round-amount");
    expect(found).not.toContain("h1-round-usd-amount");
  });

  it("still flags a round USD output next to a non-round output", () => {
    const tx = makeTx({ vout: [makeVout({ value: 102_532 }), makeVout({ value: 48_723 })] });
    expect(ids(tx, { usdPrice: 97_531, eurPrice: 90_000 })).toContain("h1-round-usd-amount");
  });
});
