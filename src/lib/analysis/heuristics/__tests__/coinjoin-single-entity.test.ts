/**
 * CoinJoins that may have one owner: the JoinMarket participant gate, the
 * single-entity hint on JoinMarket labels, the post-hoc co-spend of equal
 * outputs, and that real Whirlpool / WabiSabi / JoinMarket rounds keep their
 * exact score.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import { analyzeCoinJoin, isCoinJoinTx } from "../coinjoin";
import { analyzeTransaction } from "../../orchestrator";
import { runTxHeuristics, finalizeTxResult } from "../../tx-pipeline";
import { analyzeForward } from "../../chain/forward";
import type { TxContext } from "../types";
import { makeTx, makeVin, makeVout, makeOutspend, makeWabiSabiRound, resetAddrCounter } from "./fixtures/tx-factory";
import whirlpoolTx from "./fixtures/api-responses/whirlpool-coinjoin.json";
import wabisabiTx from "./fixtures/api-responses/wabisabi-coinjoin.json";
import joinmarketTx from "./fixtures/api-responses/joinmarket-coinjoin.json";

beforeEach(() => resetAddrCounter());

const DENOM = 1_000_000;
const JM_SEQUENCE = 0xfffffffe;

/** P2WPKH input at `address` (unique per index unless given), JoinMarket nSequence. */
function vin(value: number, i: number, opts: { address?: string; txid?: string; sequence?: number } = {}) {
  return makeVin({
    txid: opts.txid ?? i.toString(16).padStart(64, "1"),
    vout: i,
    sequence: opts.sequence ?? JM_SEQUENCE,
    prevout: {
      scriptpubkey: "",
      scriptpubkey_asm: "",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: opts.address ?? `bc1qinput${String(i).padStart(30, "0")}`,
      value,
    },
  });
}

/** A JoinMarket round: 4 makers earn ~1,000 sats each, the taker pays fees and keeps change. */
function realJoinMarket(sequence = JM_SEQUENCE): MempoolTransaction {
  const inputs = [1_500_000, 2_000_000, 1_700_000, 3_000_000, 1_800_000];
  const changes = [500_500, 1_000_400, 700_300, 2_000_600, 796_200];
  return makeTx({
    txid: "c".repeat(64),
    vin: inputs.map((v, i) => vin(v, i, { sequence })),
    vout: [...inputs.map(() => makeVout({ value: DENOM })), ...changes.map((value) => makeVout({ value }))],
  });
}

/** Run every tx heuristic plus forward analysis, then score (the main scan pipeline minus I/O). */
function score(tx: MempoolTransaction, ctx?: TxContext, children?: Map<number, MempoolTransaction>) {
  const findings = runTxHeuristics(tx, undefined, ctx);
  if (children) {
    const outspends = tx.vout.map((_, i) => makeOutspend(children.has(i) ? { spent: true, txid: children.get(i)!.txid } : {}));
    findings.push(...analyzeForward(tx, outspends, children).findings);
  }
  return finalizeTxResult(findings);
}

/** A plain 2-input, 1-output tx spending `indices` of `parent` together. */
function cospend(parent: MempoolTransaction, indices: number[]) {
  const child = makeTx({
    txid: "d".repeat(64),
    vin: indices.map((i) => makeVin({ txid: parent.txid, vout: i })),
    vout: [makeVout({ value: 1_900_000 })],
  });
  return new Map(indices.map((i) => [i, child]));
}

describe("real CoinJoin fixtures keep their exact score", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["Whirlpool", whirlpoolTx, 100],
    ["WabiSabi", wabisabiTx, 100],
    ["JoinMarket", joinmarketTx, 89],
  ] as const)("%s -> %i", async (_name, fixture, expected) => {
    const tx = fixture as unknown as MempoolTransaction;
    const promise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.score).toBe(expected);
    expect(result.findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
    expect(isCoinJoinTx(tx)).toBe(true);
  });
});

describe("JoinMarket participant gate", () => {
  it("a 2-input, 8-output tx with 5 equal outputs is not JoinMarket (nor any CoinJoin)", () => {
    const tx = makeTx({
      vin: [vin(15_000_000, 0), vin(15_000_000, 1)],
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: DENOM })),
        makeVout({ value: 3_348_583 }), makeVout({ value: 11_251_595 }), makeVout({ value: 10_300_000 }),
      ],
    });
    expect(analyzeCoinJoin(tx).findings).toEqual([]);
    expect(isCoinJoinTx(tx)).toBe(false);
    const result = score(tx);
    expect(result.txType).not.toBe("joinmarket-coinjoin");
    // Single-wallet findings are no longer suppressed
    expect(result.findings.find((f) => f.id === "h3-cioh")!.scoreImpact).toBeLessThan(0);
  });

  it("a batch payout with one repeated amount (outputs > 2x equal) is not JoinMarket", () => {
    const tx = makeTx({
      vin: Array.from({ length: 6 }, (_, i) => vin(5_000_000, i)),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: 250_000 })),
        ...Array.from({ length: 8 }, (_, i) => makeVout({ value: 300_000 + i * 12_345 })),
      ],
    });
    expect(analyzeCoinJoin(tx).findings).toEqual([]);
    expect(isCoinJoinTx(tx)).toBe(false);
  });

  it("small path: 2 inputs cannot host 3 equal outputs", () => {
    const tx = makeTx({
      vin: [vin(900_000, 0), vin(900_000, 1)],
      vout: [...Array.from({ length: 3 }, () => makeVout({ value: 400_000 })), makeVout({ value: 590_000 })],
    });
    expect(analyzeCoinJoin(tx).findings).toEqual([]);
    expect(isCoinJoinTx(tx)).toBe(false);
  });

  it("a real-shaped round passes (n equal <= inputs, outputs <= 2n)", () => {
    const { findings } = analyzeCoinJoin(realJoinMarket());
    expect(findings.find((f) => f.id === "h4-joinmarket")!.scoreImpact).toBe(20);
    expect(findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
  });
});

describe("single-entity hint on a JoinMarket label", () => {
  it("RBF signalling: label kept, bonus offset exactly, suppressions stay", () => {
    const result = score(realJoinMarket(0xfffffffd));
    const jm = result.findings.find((f) => f.id === "h4-joinmarket")!;
    const hint = result.findings.find((f) => f.id === "h4-coinjoin-single-entity")!;
    expect(result.txType).toBe("joinmarket-coinjoin");
    expect(hint.params?._variant).toBe("rbf");
    expect(hint.severity).toBe("medium");
    expect(hint.scoreImpact).toBe(-jm.scoreImpact);
    expect(hint.description).toContain("may");
    expect(result.findings.find((f) => f.id === "h3-cioh")!.scoreImpact).toBe(0);
    expect(result.findings.find((f) => f.id === "h6-rbf-signaled")?.scoreImpact ?? 0).toBe(0);
  });

  // 6 inputs, 2 from one address (5 distinct), 5 equal outputs, 3 changes that
  // no input subset explains as a maker's change
  const linkedTx = (opts: { reuse: boolean; txids?: string[] }) => {
    const inputs = [1_300_000, 1_450_000, 1_610_000, 1_770_000, 1_930_000, 2_090_000];
    return makeTx({
      vin: inputs.map((v, i) => vin(v, i, {
        ...(opts.reuse && i === 5 ? { address: `bc1qinput${"0".repeat(30)}` } : {}),
        ...(opts.txids?.[i] ? { txid: opts.txids[i] } : {}),
      })),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: DENOM })),
        makeVout({ value: 2_000_000 }), makeVout({ value: 1_500_000 }), makeVout({ value: 1_640_000 }),
      ],
    });
  };

  it("LINK (reused input address) and G (no maker change): hint fires", () => {
    const { findings } = analyzeCoinJoin(linkedTx({ reuse: true }));
    const jm = findings.find((f) => f.id === "h4-joinmarket")!;
    const hint = findings.find((f) => f.id === "h4-coinjoin-single-entity")!;
    expect(hint.params?._variant).toBe("linked");
    expect(hint.scoreImpact).toBe(-jm.scoreImpact);
  });

  it("G alone (inputs not linked) does not fire", () => {
    expect(analyzeCoinJoin(linkedTx({ reuse: false })).findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
  });

  it("LINK alone (makers' changes fit) does not fire", () => {
    const tx = realJoinMarket();
    tx.vin.push(vin(10_000, 9, { address: tx.vin[0]!.prevout!.scriptpubkey_address }));
    expect(analyzeCoinJoin(tx).findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
  });

  it("LINK via two inputs from the same non-CoinJoin parent, only when the parent is known", () => {
    const parentTxid = "e".repeat(64);
    const tx = linkedTx({ reuse: false, txids: [parentTxid, parentTxid] });
    const parent = makeTx({ txid: parentTxid, vin: [makeVin()], vout: [makeVout({ value: 1_300_000 }), makeVout({ value: 1_450_000 })] });
    const ctx: TxContext = { parentTxs: new Map([[parentTxid, parent]]) };
    expect(analyzeCoinJoin(tx, undefined, ctx).findings.find((f) => f.id === "h4-coinjoin-single-entity")?.params?._variant).toBe("linked");
    expect(analyzeCoinJoin(tx).findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
  });
});

describe("equal outputs spent together after the fact", () => {
  it("JoinMarket: consolidation -15 stays and the JoinMarket bonus is offset", () => {
    const tx = realJoinMarket();
    const result = score(tx, undefined, cospend(tx, [0, 1]));
    const jm = result.findings.find((f) => f.id === "h4-joinmarket")!;
    expect(result.findings.find((f) => f.id === "chain-post-coinjoin-consolidation")!.scoreImpact).toBe(-15);
    const cancel = result.findings.find((f) => f.id === "h4-coinjoin-single-entity")!;
    expect(cancel.params?._variant).toBe("cospent");
    expect(cancel.scoreImpact).toBe(-jm.scoreImpact);
    expect(result.txType).toBe("joinmarket-coinjoin");
  });

  it("JoinMarket: an equal output spent with a change is not hard evidence", () => {
    const tx = realJoinMarket();
    const result = score(tx, undefined, cospend(tx, [0, 5]));
    expect(result.findings.some((f) => f.id === "chain-post-coinjoin-consolidation")).toBe(true);
    expect(result.findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
  });

  it("WabiSabi: only the existing -15, the bonus stays", () => {
    const round = makeWabiSabiRound(
      Array.from({ length: 12 }, (_, i) => 6_000_000 - i * 10_000),
      [
        ...Array(4).fill(8_388_608), ...Array(3).fill(4_782_969), ...Array(3).fill(1_062_882),
        ...Array(4).fill(1_000_000), ...Array(3).fill(531_441), ...Array(2).fill(262_144), 123_457, 98_765,
      ],
    );
    const before = score(round);
    const after = score(round, undefined, cospend(round, [0, 1]));
    expect(after.findings.find((f) => f.id === "chain-post-coinjoin-consolidation")!.scoreImpact).toBe(-15);
    expect(after.findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
    expect(after.findings.find((f) => f.id === "h4-coinjoin")!.scoreImpact)
      .toBe(before.findings.find((f) => f.id === "h4-coinjoin")!.scoreImpact);
  });
});

describe("participants note", () => {
  it("is in the JoinMarket and generic descriptions, not in WabiSabi or Whirlpool", () => {
    const note = "cannot be verified on chain";
    expect(analyzeCoinJoin(realJoinMarket()).findings[0]!.description).toContain(note);
    const generic = makeTx({
      vin: Array.from({ length: 8 }, (_, i) => vin(2_000_000, i)),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: DENOM })),
        ...Array.from({ length: 3 }, () => makeVout({ value: 700_000 })),
      ],
    });
    const genericFinding = analyzeCoinJoin(generic).findings[0]!;
    expect(genericFinding.title).toContain("Likely CoinJoin");
    expect(genericFinding.description).toContain(note);
    const whirlpool = analyzeCoinJoin(whirlpoolTx as unknown as MempoolTransaction).findings[0]!;
    const wabisabi = analyzeCoinJoin(wabisabiTx as unknown as MempoolTransaction).findings[0]!;
    expect(whirlpool.description).not.toContain(note);
    expect(wabisabi.description).not.toContain(note);
  });
});

describe("isolated: no CoinJoin parent, no spent equal output remixed", () => {
  /** A plain 1-in, 2-out payment (not a CoinJoin), optionally with a fixed txid. */
  const plain = (txid: string) => makeTx({ txid, vin: [makeVin()], vout: [makeVout({ value: 600_000 }), makeVout({ value: 400_000 })] });
  /** A CoinJoin-shaped tx (Whirlpool fixture) under another txid. */
  const coinJoin = (txid: string) => ({ ...(whirlpoolTx as unknown as MempoolTransaction), txid });

  /**
   * Chain context: every parent known and plain, the equal outputs at `spent`
   * spent one by one into plain txs. `cjParent` / `remix` swap one parent /
   * child for a CoinJoin; `missingParent` / `missingChild` leave one out.
   */
  function chainCtx(
    tx: MempoolTransaction,
    spent: number[],
    opts: { cjParent?: boolean; remix?: boolean; missingParent?: boolean; missingChild?: boolean } = {},
  ): TxContext {
    const parentTxs = new Map(tx.vin.map((v, i) => [v.txid, i === 0 && opts.cjParent ? coinJoin(v.txid) : plain(v.txid)]));
    if (opts.missingParent) parentTxs.delete(tx.vin[0]!.txid);
    const childTxs = new Map(spent.map((i, k) => [i, k === 0 && opts.remix ? coinJoin(`${k}`.repeat(64)) : plain(`${k + 1}`.repeat(64))]));
    const outspends = tx.vout.map((_, i) => makeOutspend(spent.includes(i) ? { spent: true, txid: childTxs.get(i)!.txid } : {}));
    if (opts.missingChild) childTxs.delete(spent[0]!);
    return { parentTxs, outspends, childTxs };
  }
  const variant = (tx: MempoolTransaction, ctx?: TxContext) =>
    analyzeCoinJoin(tx, undefined, ctx).findings.find((f) => f.id === "h4-coinjoin-single-entity")?.params?._variant;

  it("fires on a JoinMarket label: label kept, bonus offset exactly, suppressions stay", () => {
    const tx = realJoinMarket();
    const result = score(tx, chainCtx(tx, [0, 1]));
    const jm = result.findings.find((f) => f.id === "h4-joinmarket")!;
    const hint = result.findings.find((f) => f.id === "h4-coinjoin-single-entity")!;
    expect(hint.params?._variant).toBe("isolated");
    expect(hint.severity).toBe("medium");
    expect(hint.scoreImpact).toBe(-jm.scoreImpact);
    expect(hint.description).toContain("may");
    expect(result.txType).toBe("joinmarket-coinjoin");
    expect(result.findings.find((f) => f.id === "h3-cioh")!.scoreImpact).toBe(0);
  });

  it("does not fire with a CoinJoin parent, a remixed output, or fewer than 2 spent equal outputs", () => {
    const tx = realJoinMarket();
    expect(variant(tx, chainCtx(tx, [0, 1], { cjParent: true }))).toBeUndefined();
    expect(variant(tx, chainCtx(tx, [0, 1, 2], { remix: true }))).toBeUndefined();
    expect(variant(tx, chainCtx(tx, [0]))).toBeUndefined();
    expect(variant(tx, chainCtx(tx, [0, 5]))).toBeUndefined(); // a change is not an equal output
    // a parent that only the permissive check sees as multi-party (5 sources, 5 outputs)
    const ctx = chainCtx(tx, [0, 1]);
    const multiParty = makeTx({
      txid: tx.vin[1]!.txid,
      vin: Array.from({ length: 5 }, (_, i) => makeVin({ txid: `${i + 1}`.repeat(64) })),
      vout: Array.from({ length: 5 }, (_, i) => makeVout({ value: 300_000 + i * 1_000 })),
    });
    expect(isCoinJoinTx(multiParty)).toBe(false);
    ctx.parentTxs!.set(multiParty.txid, multiParty);
    expect(variant(tx, ctx)).toBeUndefined();
  });

  it("missing parent, outspend or child data means no evidence", () => {
    const tx = realJoinMarket();
    expect(variant(tx, chainCtx(tx, [0, 1], { missingParent: true }))).toBeUndefined();
    expect(variant(tx, chainCtx(tx, [0, 1, 2], { missingChild: true }))).toBeUndefined();
    const { parentTxs, childTxs } = chainCtx(tx, [0, 1]);
    expect(variant(tx, { parentTxs: parentTxs!, childTxs: childTxs! })).toBeUndefined();
    expect(variant(tx)).toBeUndefined();
  });

  it("never stacks: RBF wins over isolated", () => {
    const tx = realJoinMarket(0xfffffffd);
    const { findings } = analyzeCoinJoin(tx, undefined, chainCtx(tx, [0, 1]));
    expect(findings.filter((f) => f.id === "h4-coinjoin-single-entity").map((f) => f.params?._variant)).toEqual(["rbf"]);
  });

  it("an observed co-spend replaces isolated (same offset, once)", () => {
    const tx = realJoinMarket();
    const children = cospend(tx, [0, 1]);
    const ctx = chainCtx(tx, [0, 1]);
    const result = score(tx, { ...ctx, childTxs: children }, children);
    const jm = result.findings.find((f) => f.id === "h4-joinmarket")!;
    const hints = result.findings.filter((f) => f.id === "h4-coinjoin-single-entity");
    expect(hints.map((f) => f.params?._variant)).toEqual(["cospent"]);
    expect(hints[0]!.scoreImpact).toBe(-jm.scoreImpact);
  });

  it.each([
    ["Whirlpool", whirlpoolTx],
    ["WabiSabi", wabisabiTx],
    ["JoinMarket", joinmarketTx],
  ] as const)("%s fixture keeps its exact score with a CoinJoin parent or a remixed output", (_name, fixture) => {
    const tx = fixture as unknown as MempoolTransaction;
    const equal = tx.vout.map((o, i) => [o.value, i] as const)
      .filter(([v], _, all) => all.filter(([w]) => w === v).length >= 2).map(([, i]) => i);
    const sameScore = (ctx: TxContext) => {
      const r = score(tx, ctx);
      expect(r.findings.some((f) => f.id === "h4-coinjoin-single-entity")).toBe(false);
      expect(r.score).toBe(score(tx, { parentTxs: ctx.parentTxs! }).score);
    };
    sameScore(chainCtx(tx, equal, { cjParent: true }));
    sameScore(chainCtx(tx, equal, { remix: true }));
  });

  it("fires on a generic CoinJoin label too, offsetting its bonus", () => {
    const tx = makeTx({
      vin: Array.from({ length: 8 }, (_, i) => vin(2_000_000, i)),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: DENOM })),
        ...Array.from({ length: 3 }, () => makeVout({ value: 700_000 })),
      ],
    });
    const { findings } = analyzeCoinJoin(tx, undefined, chainCtx(tx, [0, 1]));
    const generic = findings.find((f) => f.id === "h4-coinjoin")!;
    const hint = findings.find((f) => f.id === "h4-coinjoin-single-entity")!;
    expect(hint.params?._variant).toBe("isolated");
    expect(hint.scoreImpact).toBe(-generic.scoreImpact);
    expect(variant(tx, chainCtx(tx, [0, 1], { cjParent: true }))).toBeUndefined();
  });

  it("Whirlpool and WabiSabi never get it, even fully isolated", () => {
    for (const fixture of [whirlpoolTx, wabisabiTx]) {
      const tx = fixture as unknown as MempoolTransaction;
      const equal = tx.vout.map((o, i) => [o.value, i] as const)
        .filter(([v], _, all) => all.filter(([w]) => w === v).length >= 2).map(([, i]) => i);
      expect(variant(tx, chainCtx(tx, equal))).toBeUndefined();
    }
  });
});
