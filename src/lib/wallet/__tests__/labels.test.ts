import { describe, it, expect } from "vitest";
import { History, recv, chg, ext, coinJoin } from "@/lib/analysis/__tests__/fixtures/wallet-history";
import { parseBip329, serializeBip329, type Bip329Record } from "../bip329";
import { autoLabels, exportRecords, labelsFilename, matchLabels, parseLabel, setWalletOrigin, walletOriginOf, withFiatValues } from "../labels";

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
    expect(parseLabel(label)).toMatchObject({ tags, who });
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
    // Change of the KYC coin: no label of its own, shows its funding tx's label, inherits [KYC] (rule 4)
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ text: "rent", source: "tx", tags: ["kyc"], inherited: true, origins: ["kyc:bitstamp"] });
  });

  it("change of a [CJ] coin inherits as toxic, never as [CJ]", () => {
    const { change, kyc, infos } = wallet();
    const m = matchLabels([{ type: "output", ref: `${kyc.txid}:0`, label: "[CJ] Whirlpool" }], infos);
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ tags: ["toxic"], inherited: true, origins: [] });
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

describe("Sparrow-shaped labels", () => {
  it("parses the (received) / (change) suffix off before the prefixes, and keeps it", () => {
    expect(parseLabel("[KYC] Bitstamp (received)")).toMatchObject({ tags: ["kyc"], who: "Bitstamp", suffix: "received" });
    expect(parseLabel("[noKYC] Bisq · trade 7 (change)")).toMatchObject({ tags: ["nokyc"], who: "Bisq", suffix: "change" });
    expect(parseLabel("rent (sent)")).toMatchObject({ tags: [], who: "rent", suffix: "sent" });
    // Only at the end, with Sparrow's exact spacing
    expect(parseLabel("[KYC] (received) Kraken").suffix).toBeUndefined();
    expect(parseLabel("[KYC] Kraken(received)").suffix).toBeUndefined();
  });

  it("tx-only labels: each coin takes its funding tx's label", () => {
    const { kyc, nokyc, infos } = wallet();
    const m = matchLabels([
      { type: "tx", ref: kyc.txid, label: "[KYC] Bitstamp · withdrawal" },
      { type: "tx", ref: nokyc.txid, label: "[noKYC] Bisq" },
    ], infos);
    expect(m.coins.get(`${nokyc.txid}:0`)).toMatchObject({ text: "[noKYC] Bisq", source: "tx", tags: ["nokyc"], inherited: false });
    // The KYC coin is spent; its change inherits [KYC] through the tx label of its parent
    const change = [...m.coins.entries()].find(([k]) => !k.startsWith(nokyc.txid))![1];
    expect(change).toMatchObject({ tags: ["kyc"], inherited: true });
  });

  it("an export of a wallet labeled on Transactions: output labels with the suffix, the output label wins over the tx label", () => {
    const { nokyc, change, kyc, infos } = wallet();
    const m = matchLabels([
      { type: "tx", ref: nokyc.txid, label: "[noKYC] Bisq · trade 7" },
      { type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Bisq · trade 7 (received)" },
      { type: "tx", ref: kyc.txid, label: "[KYC] Bitstamp" },
      { type: "tx", ref: change.txid, label: "rent" },
      { type: "output", ref: `${change.txid}:1`, label: "rent (change)" },
    ], infos);
    expect(m.coins.get(`${nokyc.txid}:0`)).toMatchObject({ source: "output", suffix: "received", tags: ["nokyc"], origins: ["nokyc:bisq"] });
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ text: "rent", suffix: "change", tags: ["kyc"], inherited: true });
    expect(m.checks).toEqual([]);
  });
});

describe("label checks", () => {
  it("flags a Sparrow suffix on the wrong chain and [change] on a receipt", () => {
    const { nokyc, change, infos } = wallet();
    const m = matchLabels([
      { type: "output", ref: `${nokyc.txid}:0`, label: "[change] Bisq (change)" },
      { type: "output", ref: `${change.txid}:1`, label: "rent (received)" },
    ], infos);
    expect(m.checks).toHaveLength(2);
    expect(m.checks).toContainEqual({ id: "suffix-chain", refs: [`${nokyc.txid}:0`, `${change.txid}:1`] });
    expect(m.checks).toContainEqual({ id: "change-on-receive", refs: [`${nokyc.txid}:0`] });
  });

  it("flags [CJ] on a coin that is not a CoinJoin output, and a CoinJoin output not labeled [CJ]", () => {
    const h = new History();
    const a = h.receive(recv(0), 2_000_000, 100);
    const outs = coinJoin(h, a, 1_000_000, recv(1), chg(0), 101);
    const plain = h.receive(recv(2), 50_000, 102);
    const infos = h.infos([
      { address: recv(0), isChange: false, index: 0 }, { address: recv(1), isChange: false, index: 1 },
      { address: recv(2), isChange: false, index: 2 }, { address: chg(0), isChange: true, index: 0 },
    ]);
    const m = matchLabels([{ type: "output", ref: `${plain.txid}:0`, label: "[CJ] Whirlpool" }], infos);
    expect(m.checks.find(c => c.id === "cj-not-mixed")!.refs).toEqual([`${plain.txid}:0`]);
    expect(m.checks.find(c => c.id === "mixed-unlabeled")!.refs).toEqual([`${outs[0]!.txid}:0`]);
  });

  it("runs no label checks on change that only shows a spend's tx label", () => {
    const h = new History();
    const a = h.receive(recv(0), 400_000, 100);
    const [, change] = h.tx([a], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 299_000 }], 101);
    const infos = h.infos([{ address: recv(0), isChange: false, index: 0 }, { address: chg(0), isChange: true, index: 0 }]);
    const m = matchLabels([{ type: "tx", ref: change!.txid, label: "[CJ] paid into a Whirlpool mix" }], infos);
    expect(m.checks.find(c => c.id === "cj-not-mixed")).toBeUndefined();
  });

  it("flags [KYC] and [noKYC] coins already linked on-chain, and a freeze on a spent output", () => {
    const h = new History();
    const k = h.receive(recv(0), 400_000, 100);
    const n = h.receive(recv(1), 300_000, 101);
    // A past spend merged both: its one wallet output carries both origins
    const [, merged] = h.tx([k, n], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 599_000 }], 102);
    // Two receipts on one address: certainly linked
    const a = h.receive(recv(2), 50_000, 103);
    const b = h.receive(recv(2), 60_000, 104);
    const infos = h.infos([
      { address: recv(0), isChange: false, index: 0 }, { address: recv(1), isChange: false, index: 1 },
      { address: recv(2), isChange: false, index: 2 }, { address: chg(0), isChange: true, index: 0 },
    ]);
    const m = matchLabels([
      { type: "output", ref: `${k.txid}:0`, label: "[KYC] Bitstamp", spendable: false },
      { type: "output", ref: `${n.txid}:0`, label: "[noKYC] Bisq" },
      { type: "output", ref: `${a.txid}:0`, label: "[KYC] Kraken" },
      { type: "output", ref: `${b.txid}:0`, label: "[noKYC] RoboSats" },
    ], infos);
    expect(m.checks.find(c => c.id === "kyc-linked")!.refs.sort()).toEqual([`${merged!.txid}:1`, `${a.txid}:0`, `${b.txid}:0`].sort());
    expect(m.checks.find(c => c.id === "stale-freeze")!.refs).toEqual([`${k.txid}:0`]);
  });
});

describe("Sparrow export shape: counts and suffixes", () => {
  it("strips (input) too, and counts labels on current coins, on the history and for other wallets", () => {
    const { kyc, nokyc, change, infos } = wallet();
    const origin = "wpkh([deadbeef/84h/1h/0h])";
    const recs: Bip329Record[] = [
      // Sparrow exports every entry; most carry no label (dropped by the parser, not here)
      { type: "output", ref: `${nokyc.txid}:0`, label: "x, x (received)", origin, keypath: "/0/1", value: 300_000 },
      { type: "output", ref: `${change.txid}:1`, label: "e (change)", origin },
      { type: "input", ref: `${change.txid}:0`, label: "kakarot (input)", origin },
      { type: "tx", ref: kyc.txid, label: "kakarot", origin },
      { type: "addr", ref: recv(2), label: "unused", origin },
      // The key record: Sparrow writes its own key string; not checkable against a bare key, never "another wallet"
      { type: "xpub", ref: "tpubDifferentButSameWalletMaybe", label: "BIP39", origin },
      { type: "tx", ref: "f".repeat(64), label: "elsewhere" },
    ];
    expect(parseLabel("kakarot (input)")).toMatchObject({ tags: [], who: "kakarot", suffix: "input" });
    const m = matchLabels(recs, infos, "tpubTHISWALLET");
    expect(m.coins.get(`${nokyc.txid}:0`)).toMatchObject({ text: "x, x", suffix: "received", source: "output" });
    expect(m.coins.get(`${change.txid}:1`)).toMatchObject({ text: "e", suffix: "change" });
    expect([m.onCoins, m.history, m.unmatched]).toEqual([2, 4, 1]);
  });
});

describe("wallet-level origin (one account per origin)", () => {
  const XPUB = `tpubD${"6".repeat(106)}`; // shaped like a key, not a real one
  it("reads it from the wallet's xpub record; coins with no origin take it, an explicit prefix wins and is flagged", () => {
    const { kyc, nokyc, change, infos } = wallet();
    const records = setWalletOrigin([
      { type: "xpub", ref: XPUB, label: "BIP39" },
      { type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Bisq" },
      { type: "tx", ref: kyc.txid, label: "Kraken · withdrawal" },
    ], XPUB, "kyc");
    expect(records[0]).toEqual({ type: "xpub", ref: XPUB, label: "[KYC] BIP39" });
    const m = matchLabels(records, infos, XPUB);
    expect(m.walletOrigin).toBe("kyc");
    // The explicit [noKYC] coin keeps its prefix, and the label check flags it
    expect(m.coins.get(`${nokyc.txid}:0`)!.tags).toEqual(["nokyc"]);
    expect(m.checks.find((c) => c.id === "wallet-origin-mismatch")!.refs).toEqual([`${nokyc.txid}:0`]);
    // A coin with no origin of its own (change of an unlabeled receipt) takes the wallet's
    expect(m.coins.get(`${change.txid}:1`)!.tags).toEqual(["kyc"]);
  });

  it("no mismatch when every coin agrees with the wallet origin", () => {
    const { nokyc, infos } = wallet();
    const m = matchLabels(setWalletOrigin([{ type: "output", ref: `${nokyc.txid}:0`, label: "[noKYC] Bisq" }], XPUB, "nokyc"), infos, XPUB);
    expect(m.checks.find((c) => c.id === "wallet-origin-mismatch")).toBeUndefined();
  });


  it("post-mix wallet: coins take [CJ]; mixed sets no origin", () => {
    const { nokyc, infos } = wallet();
    const cj = matchLabels(setWalletOrigin([], XPUB, "cj"), infos, XPUB);
    expect(cj.coins.get(`${nokyc.txid}:0`)!.tags).toEqual(["cj"]);
    const mixed = matchLabels(setWalletOrigin([], XPUB, "mixed"), infos, XPUB);
    expect(mixed.walletOrigin).toBe("mixed");
    expect(mixed.coins.get(`${nokyc.txid}:0`)).toBeUndefined();
  });

  it("round-trips through a BIP329 file and clears back to the plain label", () => {
    const set = setWalletOrigin([{ type: "xpub", ref: XPUB, label: "[KYC] BIP39" }], XPUB, "nokyc");
    expect(set).toEqual([{ type: "xpub", ref: XPUB, label: "[noKYC] BIP39" }]);
    const back = parseBip329(serializeBip329(set))!.records;
    expect(walletOriginOf(back[0]!.label)).toBe("nokyc");
    expect(setWalletOrigin(back, XPUB, null)).toEqual([{ type: "xpub", ref: XPUB, label: "BIP39" }]);
    expect(setWalletOrigin([], XPUB, "mixed")).toEqual([{ type: "xpub", ref: XPUB, label: "[mixed] wallet" }]);
    expect(setWalletOrigin(setWalletOrigin([], XPUB, "cj"), XPUB, null)).toEqual([]);
    expect(setWalletOrigin([{ type: "xpub", ref: XPUB, label: "x".repeat(255) }], XPUB, "kyc")[0]!.label!.length).toBe(255);
  });
});

describe("parseLabel: observer · platform or reason · fiat value", () => {
  it.each([
    ["[noKYC] Juan · RoboSats compra · 250 EUR (73.600 EUR/BTC)", { tags: ["nokyc"], who: "Juan", platform: "RoboSats compra", fiat: { text: "250 EUR (73.600 EUR/BTC)", currency: "EUR" } }],
    ["[KYC] Bitstamp · retiro · 1.000 EUR", { tags: ["kyc"], who: "Bitstamp", platform: "retiro", fiat: { text: "1.000 EUR", currency: "EUR" } }],
    ["[KYC] Kraken · 1,250 usd", { tags: ["kyc"], who: "Kraken", fiat: { text: "1,250 usd", currency: "USD" } }],
    ["[noKYC] Bisq", { tags: ["nokyc"], who: "Bisq" }],
    ["[noKYC] Ana · cena · 2 pizzas", { tags: ["nokyc"], who: "Ana", platform: "cena" }],
    ["[noKYC] Ana · €250", { tags: ["nokyc"], who: "Ana", fiat: { text: "€250", currency: "EUR" } }],
    ["[noKYC] Ana · EUR 250", { tags: ["nokyc"], who: "Ana", fiat: { text: "EUR 250", currency: "EUR" } }],
    ["[noKYC] Ana · 250 €", { tags: ["nokyc"], who: "Ana", fiat: { text: "250 €", currency: "EUR" } }],
    ["[KYC] Kraken · $1,200", { tags: ["kyc"], who: "Kraken", fiat: { text: "$1,200", currency: "USD" } }],
    ["[noKYC] Bisq · 0.01 BTC", { tags: ["nokyc"], who: "Bisq", platform: "0.01 BTC" }],
    ["[noKYC] Bisq · 50000 sat", { tags: ["nokyc"], who: "Bisq", platform: "50000 sat" }],
    ["Juan · 250 EUR (received)", { tags: [], who: "Juan", fiat: { text: "250 EUR", currency: "EUR" }, suffix: "received" }],
  ])("%s", (label, want) => {
    const p = parseLabel(label);
    expect(p).toMatchObject(want);
    if (!("platform" in want)) expect(p.platform).toBeUndefined();
    if (!("fiat" in want)) expect(p.fiat).toBeUndefined();
  });
});

describe("withFiatValues", () => {
  it("appends the received value to incoming tx labels once, keeps user values and outgoing txs as they are", async () => {
    const { kyc, nokyc, change, infos } = wallet();
    const asked: number[] = [];
    const price = async (ts: number) => { asked.push(ts); return 50_000; };
    const records: Bip329Record[] = [
      { type: "tx", ref: kyc.txid, label: "[KYC] Bitstamp · withdrawal" },
      { type: "tx", ref: nokyc.txid, label: "[noKYC] Bisq · trade · 140 EUR" },
      { type: "tx", ref: change.txid, label: "rent" },
      { type: "output", ref: `${kyc.txid}:0`, label: "[KYC] Bitstamp (received)" },
    ];
    const out = await withFiatValues(records, infos, price);
    expect(await withFiatValues(records, infos, async () => 46_000, "EUR").then((r) => r[0]!.label)).toBe("[KYC] Bitstamp · withdrawal · 230 EUR");
    // 500,000 sats at 50,000 USD/BTC
    expect(out[0]!.label).toBe("[KYC] Bitstamp · withdrawal · 250 USD");
    expect(out.slice(1)).toEqual(records.slice(1));
    // Only whole-hour timestamps are passed to the price lookup, once each
    expect(asked.every((t) => Number.isInteger(t) && t % 3600 === 0)).toBe(true);
    expect(new Set(asked).size).toBe(asked.length);
    // No double append
    expect(await withFiatValues(out, infos, price)).toEqual(out);
    expect(parseLabel(out[0]!.label!).fiat).toEqual({ text: "250 USD", currency: "USD" });
  });
});

describe("tx labels on the wallet's own spends", () => {
  it("change of a spend from [KYC] coins labeled \"[noKYC] paid Juan\" stays KYC (rule 4)", () => {
    const { kyc, change, infos } = wallet();
    const m = matchLabels([
      { type: "tx", ref: kyc.txid, label: "[KYC] Bitstamp" },
      { type: "tx", ref: change.txid, label: "[noKYC] paid Juan" },
    ], infos);
    const c = m.coins.get(`${change.txid}:1`)!;
    expect(c.tags).toEqual(["kyc"]);
    expect(c.origins).toEqual(["kyc:bitstamp"]);
    // The spend's label is still shown, as where the coin came from
    expect(c).toMatchObject({ text: "[noKYC] paid Juan", source: "tx", inherited: true });
  });

  it("notes a CoinJoin output without [CJ] only when origin prefixes are in use", () => {
    const h = new History();
    const a = h.receive(recv(0), 2_000_000, 100);
    const outs = coinJoin(h, a, 1_000_000, recv(1), chg(0), 101);
    const plain = h.receive(recv(2), 50_000, 102);
    const infos = h.infos([
      { address: recv(0), isChange: false, index: 0 }, { address: recv(1), isChange: false, index: 1 },
      { address: recv(2), isChange: false, index: 2 }, { address: chg(0), isChange: true, index: 0 },
    ]);
    expect(matchLabels([{ type: "output", ref: `${plain.txid}:0`, label: "rent" }], infos).checks).toEqual([]);
    const m = matchLabels([{ type: "output", ref: `${plain.txid}:0`, label: "[noKYC] Bisq" }], infos);
    expect(m.checks.find((c) => c.id === "mixed-unlabeled")!.refs).toEqual([`${outs[0]!.txid}:0`]);
  });
});
