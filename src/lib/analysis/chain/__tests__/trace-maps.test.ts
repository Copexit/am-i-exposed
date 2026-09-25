import { describe, it, expect, beforeEach } from "vitest";
import { buildParentTxsByIdx, buildChildTxsByIdx, buildTxsByAddress } from "../trace-maps";
import type { TraceLayer } from "../recursive-trace";
import type { MempoolTransaction } from "@/lib/api/types";
import {
  makeTx, makeVin, makeVout, makeCoinbaseVin, makeOpReturnVout, makeOutspend, resetAddrCounter,
} from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const id = (n: number) => n.toString(16).padStart(64, "0");
const layer = (depth: number, ...txs: MempoolTransaction[]): TraceLayer => ({
  depth, txs: new Map(txs.map((t) => [t.txid, t])),
});

describe("buildParentTxsByIdx", () => {
  it("maps each input index to its depth-1 parent, skipping coinbase and unknown parents", () => {
    const p1 = makeTx({ txid: id(1) });
    const p2 = makeTx({ txid: id(2) });
    const deeper = makeTx({ txid: id(3) });
    const tx = makeTx({
      vin: [
        makeVin({ txid: id(1) }),
        makeCoinbaseVin(),
        makeVin({ txid: id(2) }),
        makeVin({ txid: id(3) }), // only present at depth 2
        makeVin({ txid: id(1), vout: 1 }), // same parent, second output
      ],
    });
    const map = buildParentTxsByIdx(tx, [layer(1, p1, p2), layer(2, deeper)], null);
    expect([...map.entries()]).toEqual([[0, p1], [2, p2], [4, p1]]);
  });

  it("falls back to the pre-fetched parent for single-input txs", () => {
    const parent = makeTx({ txid: id(4) });
    const tx = makeTx({ vin: [makeVin({ txid: id(4) })] });
    expect(buildParentTxsByIdx(tx, [], parent).get(0)).toBe(parent);
  });

  it("prefers the layer parent over the pre-fetched one", () => {
    const fromLayer = makeTx({ txid: id(5) });
    const prefetched = makeTx({ txid: id(5), fee: 1 });
    const tx = makeTx({ vin: [makeVin({ txid: id(5) })] });
    expect(buildParentTxsByIdx(tx, [layer(1, fromLayer)], prefetched).get(0)).toBe(fromLayer);
  });

  it("ignores the pre-fetched parent for multi-input txs", () => {
    const tx = makeTx({ vin: [makeVin(), makeVin()] });
    expect(buildParentTxsByIdx(tx, [], makeTx()).size).toBe(0);
  });
});

describe("buildChildTxsByIdx", () => {
  it("maps spent outputs to depth-1 children", () => {
    const c1 = makeTx({ txid: id(11) });
    const outspends = [
      makeOutspend({ spent: true, txid: id(11), vin: 0 }),
      makeOutspend(),
      makeOutspend({ spent: true, txid: id(12), vin: 0 }), // child not traced
      makeOutspend({ spent: true, txid: id(11), vin: 1 }),
    ];
    const map = buildChildTxsByIdx(outspends, [layer(1, c1)], null);
    expect([...map.entries()]).toEqual([[0, c1], [3, c1]]);
  });

  it("fills gaps from the pre-fetched child by txid", () => {
    const layerChild = makeTx({ txid: id(13) });
    const prefetched = makeTx({ txid: id(14) });
    const outspends = [
      makeOutspend({ spent: true, txid: id(13) }),
      makeOutspend({ spent: true, txid: id(14) }),
    ];
    const map = buildChildTxsByIdx(outspends, [layer(1, layerChild)], prefetched);
    expect(map.get(0)).toBe(layerChild);
    expect(map.get(1)).toBe(prefetched);
  });

  it("uses the pre-fetched child even with no forward layers", () => {
    const child = makeTx({ txid: id(15) });
    const map = buildChildTxsByIdx([makeOutspend(), makeOutspend({ spent: true, txid: id(15) })], [], child);
    expect([...map.keys()]).toEqual([1]);
  });

  it("returns empty without outspends", () => {
    expect(buildChildTxsByIdx(null, [layer(1, makeTx())], makeTx()).size).toBe(0);
  });
});

describe("buildTxsByAddress", () => {
  it("indexes input and output addresses of the target and every layer tx, skipping OP_RETURN", () => {
    const shared = "bc1qshared";
    const tx = makeTx({
      txid: id(20),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: shared, value: 1 } })],
      vout: [makeVout({ scriptpubkey_address: "bc1qpay" }), makeOpReturnVout()],
    });
    const parent = makeTx({ txid: id(21), vin: [makeCoinbaseVin()], vout: [makeVout({ scriptpubkey_address: shared })] });
    const child = makeTx({ txid: id(22), vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpay", value: 1 } })], vout: [makeVout({ scriptpubkey_address: "bc1qdest" })] });

    const map = buildTxsByAddress(tx, [layer(1, parent)], [layer(1, child)]);
    expect(map.get(shared)?.map((t) => t.txid)).toEqual([id(20), id(21)]);
    expect(map.get("bc1qpay")?.map((t) => t.txid)).toEqual([id(20), id(22)]);
    expect(map.get("bc1qdest")?.map((t) => t.txid)).toEqual([id(22)]);
    // Only real addresses are keys (no OP_RETURN / coinbase entries)
    expect(map.size).toBe(3);
  });

  it("lists a tx once per address even when the address repeats or the tx appears in several layers", () => {
    const addr = "bc1qreused";
    const pv = { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 1 };
    const tx = makeTx({
      txid: id(30),
      vin: [makeVin({ prevout: pv }), makeVin({ prevout: pv })],
      vout: [makeVout({ scriptpubkey_address: addr })],
    });
    const map = buildTxsByAddress(tx, [layer(1, tx)], [layer(1, tx)]);
    expect(map.get(addr)?.map((t) => t.txid)).toEqual([id(30)]);
  });
});
