import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { MempoolTransaction } from "@/lib/api/types";
import { classifyWabiSabi, isStandardDenomination, type WabiSabiTxLike } from "../wabisabi";
import { analyzeCoinJoin } from "../coinjoin";
import { detectWabiSabiForTurbo } from "../../boltzmann-detection";

/**
 * Labelled corpus of real mainnet transactions (docs/privacy-engine.md, H4
 * WabiSabi): rounds from zkSNACKs (2023-2024) and post-shutdown coordinators
 * (2024-2026), and negatives (Whirlpool, JoinMarket, Wasabi 1.x, exchange
 * batches, WabiSabi look-alikes). Compact encoding: each input is
 * `<type><value>[~<nSequence hex> when not final]`, each output
 * `<type><value>[=<index of the earlier output paying the same script>]`.
 */
interface CorpusEntry {
  txid: string;
  label: "wabisabi" | "other";
  category: string;
  source: string;
  date: string;
  locktime: number;
  vin: string;
  vout: string;
}

const TYPES: Record<string, string> = {
  w: "v0_p2wpkh", t: "v1_p2tr", s: "p2sh", k: "p2pkh", h: "v0_p2wsh", o: "op_return", p: "p2pk", m: "multisig", u: "unknown", a: "v1_p2a",
};

function decode(e: CorpusEntry): WabiSabiTxLike {
  const parse = (tok: string) => {
    const m = /^([a-z])(\d+)(?:~([0-9a-f]+))?(?:=(\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad token ${tok}`);
    return { type: TYPES[m[1]!]!, value: Number(m[2]), seq: m[3], same: m[4] };
  };
  return {
    locktime: e.locktime,
    vin: e.vin.split(" ").map(parse).map((t) => ({
      sequence: t.seq === undefined ? 0xffffffff : parseInt(t.seq, 16),
      prevout: { value: t.value, scriptpubkey_type: t.type },
    })),
    vout: e.vout.split(" ").map(parse).map((t, i) => ({
      value: t.value,
      scriptpubkey_type: t.type,
      scriptpubkey: `script-${t.same ?? i}`,
    })),
  };
}

const FIXTURES = join(__dirname, "fixtures");
const corpus = JSON.parse(readFileSync(join(FIXTURES, "wabisabi-corpus.json"), "utf-8")) as CorpusEntry[];

/**
 * Real rounds the classifier does not recognise, by design: their outputs
 * are a single decimal denomination (or 2 inputs), which is exactly what a
 * Whirlpool mix or an equal-output batch looks like. They stay generic.
 */
const KNOWN_MISSES = new Set([
  "3b3a96916321d3e305c4025dfd8c075bdcf12d984cbc0da614c3a6d8c8586096", // gingerwallet, 2 in / 3 out
  "3428f647e21ebabcb82dbd825c7632aa6424fb49474102de52eec19e1819fb99", // gingerwallet, 8x7, one decimal tier
  "2c6dd05fade2fa4ebd4df69e538f12977410fa01d42005a08c14997dcd77344e", // 9x10, one decimal tier
  "8917bf1c63c0e5b78f0713a393928fb5cdf0ff9896d8f143800826def2f99dea", // 7x8, one decimal tier
  "d0bf70388742c19cde75a5a45bd47f42eb6bac521d32ef5d6f50661732cbe3dc", // 9x10, one decimal tier
  "e24e86b690b24dbea6c589fb796b2556739fa53d84984aef0559aad08d0d2d05", // 8x9, one decimal tier
]);

describe("WabiSabi standard denominations", () => {
  it("builds 2^n, 3^n, 2*3^n and the 1-2-5 decimal series", () => {
    for (const v of [8_192, 6_561, 13_122, 10_000, 20_000, 50_000, 1_048_576, 4_782_969, 1_062_882, 100_000_000, 2_187, 4_374]) {
      expect(isStandardDenomination(v), String(v)).toBe(true);
    }
    for (const v of [9_999, 30_000, 25_000_000, 1_000_001, 100_000_001]) {
      expect(isStandardDenomination(v), String(v)).toBe(false);
    }
  });

  it("has 93 denominations between the default 5,000 sat and 43,000 BTC bounds", () => {
    let n = 0;
    for (const v of [
      ...Array.from({ length: 43 }, (_, i) => 2 ** i),
      ...Array.from({ length: 27 }, (_, i) => 3 ** i),
      ...Array.from({ length: 27 }, (_, i) => 2 * 3 ** i),
      ...Array.from({ length: 13 }, (_, i) => [10 ** i, 2 * 10 ** i, 5 * 10 ** i]).flat(),
    ].filter((v, i, a) => a.indexOf(v) === i)) {
      if (v >= 5_000 && v <= 43_000e8 && isStandardDenomination(v)) n++;
    }
    expect(n).toBe(93);
  });
});

describe("classifyWabiSabi on the labelled mainnet corpus", () => {
  it("covers several coordinators and eras, and the known negatives", () => {
    const positives = corpus.filter((e) => e.label === "wabisabi");
    expect(positives.length).toBeGreaterThanOrEqual(120);
    expect(new Set(positives.map((e) => e.category)).size).toBeGreaterThanOrEqual(10);
    expect(corpus.length - positives.length).toBeGreaterThanOrEqual(200);
  });

  it.each(corpus.map((e) => [`${e.label} ${e.category} ${e.txid.slice(0, 12)}`, e] as const))("%s", (_name, e) => {
    const expected = e.label === "wabisabi" && !KNOWN_MISSES.has(e.txid);
    expect(classifyWabiSabi(decode(e)).isWabiSabi).toBe(expected);
  });
});

describe("every consumer agrees with the classifier", () => {
  const API = join(FIXTURES, "api-responses");
  const txs = [
    ...readdirSync(API).map((f) => join(API, f)),
    ...readdirSync(join(API, "corpus")).map((f) => join(API, "corpus", f)),
  ]
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(f, "utf-8")) as MempoolTransaction | { tx: MempoolTransaction })
    .map((j) => ("tx" in j ? j.tx : j))
    .filter((tx) => Array.isArray(tx.vin));

  it.each(txs.map((tx) => [tx.txid.slice(0, 12), tx] as const))("%s", (_id, tx) => {
    const isWabiSabi = tx.txid === "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e";
    expect(classifyWabiSabi(tx).isWabiSabi).toBe(isWabiSabi);
    expect(detectWabiSabiForTurbo(tx)).toBe(isWabiSabi);
    expect(analyzeCoinJoin(tx).findings.some((f) => f.params?.isWabiSabi === 1)).toBe(isWabiSabi);
  });

  it("rates the zkSNACKs example a high-confidence round", () => {
    const tx = txs.find((t) => t.txid.startsWith("fb596c9f"))!;
    const c = classifyWabiSabi(tx);
    expect(c.confidence).toBe("high");
    expect(c.evidence.standardOutputs / c.evidence.outputs).toBeGreaterThan(0.95);
  });
});
