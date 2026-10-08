import { describe, it, expect } from "vitest";
import { parseXpub, deriveOneAddress, type ScriptType } from "@/lib/bitcoin/descriptor";
import type { MempoolClient } from "@/lib/api/mempool";
import { detectScriptType } from "../scan";

// A synthetic BIP84 testnet account (84h/1h/0h from a fixed test seed) exported as a bare tpub
const TPUB = "tpubDCBVmvPqwyD5EZfHGe3Sz7ZjM822jrWC2npTFZre9NQKnaRtWz9BtqhXo1HQ4uwc9QcoPE7pD5ZpcQCTig5AMLREB9kQTkvc3rcNTKiKjVF";
const parsed = parseXpub(TPUB);
const first = (scriptType: ScriptType) => deriveOneAddress({ ...parsed, scriptType }, 0, 0).address;

/** API where only the given types' first receive address has history. */
const api = (used: ScriptType[]) => ({
  getAddress: async (a: string) => {
    const n = used.some((s) => first(s) === a) ? 1 : 0;
    return { chain_stats: { tx_count: n }, mempool_stats: { tx_count: 0 } };
  },
}) as unknown as MempoolClient;

describe("detectScriptType", () => {
  it("parses a bare tpub as legacy (SLIP-132), the case detection corrects", () => {
    expect(parsed.scriptType).toBe("p2pkh");
  });
  it.each<[ScriptType[], ScriptType]>([
    [["p2wpkh"], "p2wpkh"],
    [["p2tr"], "p2tr"],
    [["p2sh-p2wpkh"], "p2sh-p2wpkh"],
    [["p2pkh"], "p2pkh"],
    [["p2pkh", "p2tr"], "p2tr"],
    [[], "p2wpkh"],
  ])("history on %j -> %s", async (used, expected) => {
    expect(await detectScriptType(parsed, api(used))).toBe(expected);
  });
});
