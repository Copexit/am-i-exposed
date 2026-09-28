import { describe, it, expect } from "vitest";
import { traceBackward, traceForward, type TraceLayer } from "../recursive-trace";
import { makeTx, makeVin, makeVout } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

// Synthetic graph: every tx has 6 parents and 6 spent outputs drawn from a
// pool of 400 ids, so layers overlap (visited dedupe) and hit the 50 cap.
const id = (n: number) => n.toString(16).padStart(64, "0");
const links = (n: number, salt: number) => Array.from({ length: 6 }, (_, k) => ((n * 31 + k * 97 + salt) % 400) + 1);
const failing = (n: number) => n % 13 === 0;

function graphTx(n: number): MempoolTransaction {
  return makeTx({
    txid: id(n),
    vin: links(n, 7).map((p) => makeVin({ txid: id(p) })),
    vout: links(n, 11).map(() => makeVout({ value: 50_000 })),
  });
}

function fetcher() {
  let inFlight = 0;
  let maxInFlight = 0;
  const run = async <T>(n: number, value: () => T): Promise<T> => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Uneven latency so responses complete out of request order
    await new Promise((r) => setTimeout(r, (n * 7) % 5));
    inFlight--;
    if (failing(n)) throw new Error("429");
    return value();
  };
  return {
    api: {
      getTransaction: (txid: string) => run(parseInt(txid, 16), () => graphTx(parseInt(txid, 16))),
      getTxOutspends: (txid: string) =>
        run(parseInt(txid, 16) + 1, (): MempoolOutspend[] =>
          links(parseInt(txid, 16), 11).map((c) => ({ spent: true, txid: id(c), vin: 0 }))),
    },
    maxInFlight: () => maxInFlight,
  };
}

const shape = (layers: TraceLayer[]) => layers.map((l) => [...l.txs.keys()]);

describe("recursive trace concurrency", () => {
  const root = graphTx(1);
  const existing = new Map([[id(links(1, 7)[2]!), graphTx(links(1, 7)[2]!)]]);

  it("traces the same backward layers at concurrency 4 as one at a time", async () => {
    const seq = fetcher();
    const par = fetcher();
    const a = await traceBackward(root, 4, 1000, seq.api, undefined, undefined, existing);
    const b = await traceBackward(root, 4, 1000, par.api, undefined, undefined, existing, undefined, 4);
    expect(shape(b.layers)).toEqual(shape(a.layers));
    expect(b.layers.some((l) => l.txs.size === 50)).toBe(true);
    expect([b.fetchCount, b.failedFetches]).toEqual([a.fetchCount, a.failedFetches]);
    expect(seq.maxInFlight()).toBe(1);
    expect(par.maxInFlight()).toBe(4);
  });

  it("traces the same forward layers at concurrency 4 as one at a time", async () => {
    const seq = fetcher();
    const par = fetcher();
    const a = await traceForward(root, 4, 1000, seq.api, undefined, undefined, existing);
    const b = await traceForward(root, 4, 1000, par.api, undefined, undefined, existing, undefined, undefined, 4);
    expect(shape(b.layers)).toEqual(shape(a.layers));
    expect(b.layers.some((l) => l.txs.size === 50)).toBe(true);
    expect([b.fetchCount, b.failedFetches]).toEqual([a.fetchCount, a.failedFetches]);
    expect(par.maxInFlight()).toBe(4);
  });
});
