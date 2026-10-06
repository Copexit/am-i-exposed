import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grantLookupConsent } from "../consent";
import { lookupTx, summarize, selectTxids, type TxAttribution } from "../wabisabi-attribution";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", `${n}.json`), "utf8");
const CJ = "c575fb58fc4221882a281ceebe051131b2cc397f738156a93877c93639909cea";
const POST = "36aa04341be28abc8f6dab05d16a1e26d37446d72af4a22f4e0a09babba03adf";
const FEED = "49249142e386ba3740e90a9b358251c6af7007395b5cfc6dd066cbaf965f59ac";
const UNK = "ab".repeat(32);

/** fetch mock answering search/coinjoin from fixtures by method + param. */
function mockWabisator(map: Record<string, string>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    const key = `${method}:${params.query ?? params.txId}`;
    const body = map[key];
    return body ? new Response(body, { status: 200 }) : new Response("{}", { status: 502 });
  });
}
const ctx = (txids: string[]) => ({ isUmbrel: false, consent: grantLookupConsent("wabisator", txids) });
afterEach(() => vi.restoreAllMocks());

describe("lookupTx", () => {
  it("maps a recorded Kruw round", async () => {
    mockWabisator({ [`search:${CJ}`]: fx("wabisator-search-coinjoin"), [`coinjoin:${CJ}`]: fx("wabisator-coinjoin") });
    const r = await lookupTx(CJ, ctx([CJ]));
    expect(r.kind).toBe("coinjoin");
    if (r.kind !== "coinjoin") return;
    expect(r.coordinator).toEqual({ key: "kruw", name: "Kruw" });
    expect(r.inputs).toBe(214);
    expect(r.outputs).toBe(305);
    expect(r.inputOrigins).toEqual({ fresh: 13, remix: 199, other: 2 });
    expect(r.nonStandardOutputs).toBe(5);
    expect(r.remixedFromRounds).toHaveLength(80);
    expect(r.remixedIntoRounds).toHaveLength(41);
    expect(r.anonsetOut).toBeCloseTo(11.54);
  });
  it("normalizes an uppercase txid", async () => {
    mockWabisator({ [`search:${CJ}`]: fx("wabisator-search-coinjoin"), [`coinjoin:${CJ}`]: fx("wabisator-coinjoin") });
    const r = await lookupTx(CJ.toUpperCase(), ctx([CJ]));
    expect(r.kind).toBe("coinjoin");
    expect(r.txid).toBe(CJ);
  });
  it("tolerates a null Transaction and missing RoundEndTime", async () => {
    const j = JSON.parse(fx("wabisator-coinjoin"));
    j.result.Transaction = null;
    delete j.result.Coinjoin.RoundEndTime;
    mockWabisator({ [`search:${CJ}`]: fx("wabisator-search-coinjoin"), [`coinjoin:${CJ}`]: JSON.stringify(j) });
    const r = await lookupTx(CJ, ctx([CJ]));
    expect(r.kind).toBe("coinjoin");
    if (r.kind === "coinjoin") {
      expect(r.inputOrigins).toEqual({ fresh: 0, remix: 0, other: 0 });
      expect(r.nonStandardOutputs).toBe(0);
    }
  });
  it("maps a post-mix consolidation as linked", async () => {
    mockWabisator({ [`search:${POST}`]: fx("wabisator-search-postmix") });
    const r = await lookupTx(POST, ctx([POST]));
    expect(r.kind).toBe("linked");
    if (r.kind === "linked") { expect(r.outOf).toHaveLength(45); expect(r.into).toHaveLength(0); }
  });
  it("maps unknown txids to none, and errors (HTTP or JSON-RPC) to error", async () => {
    mockWabisator({ [`search:${UNK}`]: fx("wabisator-search-unknown") });
    expect((await lookupTx(UNK, ctx([UNK]))).kind).toBe("none");
    expect((await lookupTx(CJ, ctx([CJ]))).kind).toBe("error");          // 502 from the mock
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad"}}', { status: 200 }));
    expect((await lookupTx(CJ, ctx([CJ]))).kind).toBe("error");
  });
  it("rethrows aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("x", "AbortError"));
    await expect(lookupTx(CJ, ctx([CJ]))).rejects.toThrow();
  });
});

describe("summarize", () => {
  it("counts post-mix merges but not CoinJoins our engine recognizes", async () => {
    mockWabisator({ [`search:${POST}`]: fx("wabisator-search-postmix"), [`search:${FEED}`]: fx("wabisator-search-feeder") });
    const results: TxAttribution[] = [await lookupTx(POST, ctx([POST])), await lookupTx(FEED, ctx([FEED])), { kind: "error", txid: UNK, message: "x" }];
    const s = summarize(results, (t) => t === FEED);
    expect(s.checked).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.postMixMerges).toEqual([{ txid: POST, coins: 45, rounds: 13 }]);
    expect(s.outOf[0]!.coordinator).toBe("kruw");
    expect(s.into.length).toBeGreaterThan(0);
  });
});

describe("selectTxids", () => {
  it("newest first, deduplicated, unconfirmed first, capped", () => {
    const txs = [{ txid: "a", status: { block_time: 1 } }, { txid: "b", status: { block_time: 3 } }, { txid: "a", status: { block_time: 1 } }, { txid: "c", status: {} }];
    expect(selectTxids(txs, 2)).toEqual(["c", "b"]);
  });
});
