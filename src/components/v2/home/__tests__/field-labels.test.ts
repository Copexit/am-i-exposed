import { describe, it, expect } from "vitest";
import { buildFieldUtxos, labelKind, sampleEvenly, scriptLabel } from "../field-labels";
import { FIELD_TX } from "../field-data";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import fixture from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json";
import type { MempoolTransaction } from "@/lib/api/types";

describe("v2 home field labels", () => {
  const utxos = buildFieldUtxos(FIELD_TX);

  it("generated data matches the fixture exactly", () => {
    expect(FIELD_TX.txid).toBe(fixture.txid);
    expect(FIELD_TX.inValues).toEqual(fixture.vin.map((v) => v.prevout.value));
    expect(FIELD_TX.outValues).toEqual(fixture.vout.map((v) => v.value));
    expect(utxos.filter((u) => u.side === "in").map((u) => u.scriptType)).toEqual(fixture.vin.map((v) => v.prevout.scriptpubkey_type));
    expect(utxos.filter((u) => u.side === "out").map((u) => u.scriptType)).toEqual(fixture.vout.map((v) => v.scriptpubkey_type));
  });

  it("the engine calls this tx a WabiSabi CoinJoin (backs the 'CoinJoin output' label)", () => {
    const r = analyzeTransactionSync(fixture as unknown as MempoolTransaction);
    expect(r.findings.some(isCoinJoinFinding)).toBe(true);
    expect(r.txType).toBe("wabisabi-coinjoin");
  });

  it("anon set counts outputs with the exact same value, inputs get none", () => {
    const out = utxos.filter((u) => u.side === "out");
    for (const u of out) expect(u.anonSet).toBe(FIELD_TX.outValues.filter((v) => v === u.value).length);
    expect(utxos.filter((u) => u.side === "in").every((u) => u.anonSet === 0)).toBe(true);
    expect(out.find((u) => u.value === 2097152)?.anonSet).toBe(20);
  });

  it("derives round/dust/label kind from the value", () => {
    const base = { side: "out" as const, index: 0, scriptType: "v1_p2tr", anonSet: 1 };
    expect(labelKind({ ...base, value: 555, round: false, dust: true })).toBe("dust");
    expect(labelKind({ ...base, value: 5_000_000, round: true, dust: false, anonSet: 15 })).toBe("anon-set");
    expect(labelKind({ ...base, value: 5_000_000, round: true, dust: false })).toBe("round");
    expect(labelKind({ ...base, value: 62_667_834, round: false, dust: false })).toBe("plain");
    expect(utxos.find((u) => u.value === 50_000)?.round).toBe(true);
    expect(utxos.find((u) => u.value === 16_384)?.round).toBe(false);
    expect(utxos.some((u) => u.dust)).toBe(false);
  });

  it("formats script types and samples evenly", () => {
    expect(scriptLabel("v0_p2wpkh")).toBe("P2WPKH");
    expect(scriptLabel("v1_p2tr")).toBe("P2TR");
    expect(scriptLabel("p2pkh")).toBe("P2PKH");
    expect(sampleEvenly([0, 1, 2, 3, 4, 5], 3)).toEqual([0, 2, 4]);
    expect(sampleEvenly([1, 2], 5)).toEqual([1, 2]);
  });
});
