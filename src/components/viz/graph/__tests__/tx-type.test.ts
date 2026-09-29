import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { MempoolTransaction } from "@/lib/api/types";
import { txTypeOf } from "../tx-type";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, makeOpReturnVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src/lib/analysis/heuristics/__tests__/fixtures/api-responses", `${name}.json`), "utf8")) as MempoolTransaction;

describe("txTypeOf (graph node label)", () => {
  it("labels coinbase 6c7edc23 (1 in, 4 out) as coinbase, not batch", () => {
    expect(txTypeOf(fixture("coinbase-6c7edc23"))).toBe("coinbase");
  });

  it("labels a coinbase of any shape as coinbase", () => {
    for (const n of [1, 2]) {
      expect(txTypeOf(makeTx({ vin: [makeCoinbaseVin()], vout: Array.from({ length: n }, () => makeVout()) }))).toBe("coinbase");
    }
  });

  it("labels the example set by shape", () => {
    expect(txTypeOf(fixture("sweep-1in1out"))).toBe("sweep");
    expect(txTypeOf(fixture("consolidation-5in1out"))).toBe("consolidation");
    expect(txTypeOf(fixture("address-reuse-change"))).toBe("simpleSend");
    expect(txTypeOf(fixture("batch-payment"))).toBe("batch");
  });

  it("labels 1-in-3-out as batch (2 payments + change, or 3 payments)", () => {
    expect(txTypeOf(makeTx({ vin: [makeVin()], vout: [makeVout(), makeVout(), makeVout()] }))).toBe("batch");
  });

  it("counts spendable outputs only: 1 in, 1 out + OP_RETURN is a sweep", () => {
    expect(txTypeOf(fixture("op-return-charley"))).toBe("sweep");
    expect(txTypeOf(makeTx({ vin: [makeVin()], vout: [makeOpReturnVout(), makeVout(), makeVout()] }))).toBe("simpleSend");
  });
});
