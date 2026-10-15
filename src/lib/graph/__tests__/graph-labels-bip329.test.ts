import { describe, it, expect } from "vitest";
import { bip329ToGraphLabels, edgesFromNodes, graphLabelsToBip329 } from "../graph-labels-bip329";

const tx = (n: number) => n.toString(16).padStart(64, "0");
const node = (n: number, vin: Array<[number, number]>) => ({ txid: tx(n), tx: { vin: vin.map(([t, v]) => ({ txid: tx(t), vout: v })) } });

describe("graph labels as BIP329", () => {
  const nodes = new Map([node(1, []), node(2, [[1, 0], [1, 3]]), node(3, [[2, 1]])].map((n) => [n.txid, n]));
  const edges = edgesFromNodes(nodes);

  it("derives one edge per linked pair with its vouts", () => {
    expect(edges).toEqual([
      { fromTxid: tx(1), toTxid: tx(2), outputIndices: [0, 3] },
      { fromTxid: tx(2), toTxid: tx(3), outputIndices: [1] },
    ]);
  });

  it("round-trips node and bundled edge labels", () => {
    const recs = graphLabelsToBip329(new Map([[tx(1), "root"]]), new Map([[`${tx(1)}->${tx(2)}`, "pay"]]), edges);
    expect(recs).toEqual([
      { type: "tx", ref: tx(1), label: "root" },
      { type: "output", ref: `${tx(1)}:0`, label: "pay" },
      { type: "output", ref: `${tx(1)}:3`, label: "pay" },
    ]);
    const back = bip329ToGraphLabels(recs, new Set(nodes.keys()), edges);
    expect([...back.nodeLabels]).toEqual([[tx(1), "root"]]);
    expect([...back.edgeLabels]).toEqual([[`${tx(1)}->${tx(2)}`, "pay"]]);
    expect(back.unmatched).toBe(0);
  });

  it("skips edges without known outputs, joins differing output labels, counts unmatched", () => {
    expect(graphLabelsToBip329(new Map(), new Map([["a->b", "x"]]), [{ fromTxid: "a", toTxid: "b" }])).toEqual([]);
    const back = bip329ToGraphLabels([
      { type: "output", ref: `${tx(1)}:0`, label: "one" },
      { type: "output", ref: `${tx(1)}:3`, label: "two | aie: x" },
      { type: "output", ref: `${tx(1)}:9`, label: "no edge" },
      { type: "tx", ref: tx(9), label: "not here" },
      { type: "addr", ref: "bc1qxyz", label: "addr" },
    ], new Set(nodes.keys()), edges);
    expect(back.edgeLabels.get(`${tx(1)}->${tx(2)}`)).toBe("one / two");
    expect(back.unmatched).toBe(3);
  });
});
