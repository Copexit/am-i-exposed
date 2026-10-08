import { describe, it, expect } from "vitest";
import { History, recv, chg, ext } from "@/lib/analysis/__tests__/fixtures/wallet-history";
import { parseBip329, serializeBip329, type Bip329Record } from "../bip329";
import { autoLabels, exportRecords, labelsFilename, matchLabels, parseLabel } from "../labels";

describe("parseLabel", () => {
  it.each([
    ["[KYC] Bitstamp · withdrawal", ["kyc"], "Bitstamp"],
    ["[kyc]Kraken", ["kyc"], "Kraken"],
    ["[noKYC] Bisq · trade", ["nokyc"], "Bisq"],
    ["[No-KYC] RoboSats", ["nokyc"], "RoboSats"],
    ["[CJ] Whirlpool · 1M pool", ["cj"], "Whirlpool"],
    ["[cambio] pago alquiler", ["change"], "pago alquiler"],
    ["[CHANGE] rent", ["change"], "rent"],
    ["[tóxico] dust", ["toxic"], "dust"],
    ["[Toxico] x", ["toxic"], "x"],
    ["[persona] Ana · cena", ["person"], "Ana"],
    ["[noKYC][CJ] Bisq", ["nokyc", "cj"], "Bisq"],
    ["[foo] bar", [], "[foo] bar"],
    ["no prefix · detail", [], "no prefix"],
  ])("%s", (label, tags, who) => {
    expect(parseLabel(label)).toEqual({ tags, who });
  });
});

/** KYC receipt, noKYC receipt; the KYC coin pays someone and its change stays. */
function wallet() {
  const h = new History();
  const kyc = h.receive(recv(0), 500_000, 100);
  const nokyc = h.receive(recv(1), 300_000, 101);
  const [, change] = h.tx([kyc], [{ address: ext(1), value: 200_000 }, { address: chg(0), value: 299_000 }], 102);
  const infos = h.infos([
    { address: recv(0), isChange: false, index: 0 },
    { address: recv(1), isChange: false, index: 1 },
    { address: recv(2), isChange: false, index: 2 },
    { address: chg(0), isChange: true, index: 0 },
  ]);
  return { h, kyc, nokyc, change: change!, infos };
}

describe("matchLabels", () => {
  it("counts applied and unmatched records, resolves coin labels and inherits the origin on change", () => {
    const { kyc, nokyc, change, infos } = wallet();
    const records: Bip329Record[] = [
      { type: "output", ref: `${kyc.txid}:0`, label: "[KYC] Bitstamp · withdrawal" },
      { type: "addr", ref: recv(1), label: "[noKYC] Bisq · trade 7" },
      { type: "tx", ref: change.txid, label: "rent" },
      { type: "output", ref: `${nokyc.txid}:0`, spendable: false },
      { type: "tx", ref: "f".repeat(64), label: "not this wallet" },
      { type: "addr", ref: ext(1), label: "someone else's address" },
    ];
    const m = matchLabels(records, infos);
    expect(m.applied).toBe(4);
    expect(m.unmatched).toBe(2);
    expect(m.tx.get(change.txid)).toBe("rent");
    // The noKYC coin: label from its address, frozen by its output record
    expect(m.coins.get(`${nokyc.txid}:0`)).toMatchObject({ text: "[noKYC] Bisq · trade 7", source: "addr", tags: ["nokyc"], frozen: true, origins: ["nokyc:bisq"] });
    // Change of the KYC coin: no label of its own, inherits [KYC] (rule 4)
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ text: undefined, tags: ["kyc"], inherited: true, origins: ["kyc:bitstamp"] });
  });

  it("a change with its own origin label does not inherit", () => {
    const { change, kyc, infos } = wallet();
    const m = matchLabels([
      { type: "output", ref: `${kyc.txid}:0`, label: "[KYC] Bitstamp" },
      { type: "output", ref: `${change.txid}:1`, label: "[cambio][persona] Ana" },
    ], infos);
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ tags: ["change", "person"], inherited: false, origins: ["person:ana"] });
  });
});

describe("export", () => {
  it("merges automatic labels into the user's, adds the rest, and import(export(x)) is x", () => {
    const { kyc, change } = wallet();
    const user: Bip329Record[] = [
      { type: "output", ref: `${change.txid}:1`, label: "[cambio] rent", origin: "wpkh([d34db33f/84h/0h/0h])", keypath: "/1/0" },
      { type: "tx", ref: kyc.txid, label: "[KYC] Bitstamp" },
    ];
    const auto = new Map([
      [`output:${change.txid}:1`, { type: "output" as const, ref: `${change.txid}:1`, label: "aie: exposed change" }],
      [`addr:${recv(0)}`, { type: "addr" as const, ref: recv(0), label: "aie: reused address" }],
    ]);
    const out = exportRecords(user, auto);
    expect(out[0]).toEqual({ ...user[0], label: "[cambio] rent | aie: exposed change" });
    expect(out[1]).toEqual(user[1]);
    expect(out[2]).toEqual({ type: "addr", ref: recv(0), label: "aie: reused address" });
    expect(exportRecords(user, auto, true)).toEqual([...auto.values()]);
    expect(parseBip329(serializeBip329(out))!.records).toEqual(user);
  });

  it("keeps a long user label whole instead of cutting it to fit the automatic part", () => {
    const long = "x".repeat(250);
    const out = exportRecords([{ type: "addr", ref: recv(0), label: long }], new Map([[`addr:${recv(0)}`, { type: "addr" as const, ref: recv(0), label: "aie: reused address" }]]));
    expect(out[0]!.label).toBe(long);
  });

  it("automatic labels: reused address, toxic change, groups, exposed change", () => {
    const h = new History();
    const a = h.receive(recv(0), 1_000_000, 100);
    h.receive(recv(0), 700_000, 101); // reuse
    // Round payment, non-round change of the same type: exposed
    const [, c] = h.tx([a], [{ address: ext(1), value: 500_000 }, { address: chg(0), value: 499_000 }], 102);
    const [, small] = h.tx([c!], [{ address: ext(2), value: 491_000 }, { address: chg(1), value: 7_000 }], 103);
    const infos = h.infos([
      { address: recv(0), isChange: false, index: 0 },
      { address: chg(0), isChange: true, index: 0 },
      { address: chg(1), isChange: true, index: 1 },
    ]);
    const auto = autoLabels(infos);
    expect(auto.get(`addr:${recv(0)}`)!.label).toBe("aie: reused address");
    expect(auto.get(`output:${c!.txid}:1`)!.label).toBe("aie: exposed change");
    expect(auto.get(`output:${small!.txid}:1`)!.label).toMatch(/^aie: toxic change/);
    expect([...auto.values()].every(x => x.label.startsWith("aie: "))).toBe(true);
  });

  it("filename is a short hash of the xpub", () => {
    expect(labelsFilename("xpubABC")).toMatch(/^[0-9a-f]{8}-labels\.jsonl$/);
  });
});
