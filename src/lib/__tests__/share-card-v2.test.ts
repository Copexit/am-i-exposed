import { describe, it, expect } from "vitest";
import { buildV2CardModel, shortQuery } from "@/lib/share-card";
import { GRADE_HEX } from "@/lib/constants";

const TXID = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
const base = { grade: "A+" as const, score: 100, query: TXID, inputType: "txid" as const, findingCount: 4 };

describe("share card v2 model", () => {
  it("shortens long ids, keeps short ones", () => {
    expect(shortQuery(TXID)).toBe("323df21f…d429dec2");
    expect(shortQuery("abc")).toBe("abc");
  });

  it("resolves grade color, score, id line and labels", () => {
    const m = buildV2CardModel({ ...base, style: "v2", txType: " Whirlpool CoinJoin ", topLeak: "Round amount" });
    expect(m.gradeColor).toBe(GRADE_HEX["A+"]);
    expect(m.score).toBe("100");
    expect(m.scoreFraction).toBe(1);
    expect(m.txType).toBe("Whirlpool CoinJoin");
    expect(m.topLeak).toBe("Round amount");
    expect(m.idLine).toBe("TX  323df21f…d429dec2");
    expect(m.labels.scannedClientSide).toBe("SCANNED CLIENT-SIDE");
  });

  it("omits absent tx type / top leak and clamps the score", () => {
    const m = buildV2CardModel({ ...base, grade: "F", score: -5, inputType: "address", query: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", txType: "", topLeak: null, v2Labels: { address: "ADDR" } });
    expect(m.txType).toBeNull();
    expect(m.topLeak).toBeNull();
    expect(m.score).toBe("0");
    expect(m.idLine.startsWith("ADDR  1A1zP1eP")).toBe(true);
  });
});
