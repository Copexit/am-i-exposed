import { describe, it, expect } from "vitest";
import { MAX_FILE_BYTES, MAX_LABEL_LENGTH, parseBip329, serializeBip329, userPart } from "../bip329";

const TX = "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd";

/** Sparrow 2.x export shape (WalletLabels.java): extra fields, entries with no label, origin descriptors. */
const SPARROW = [
  `{"type":"xpub","ref":"xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz","label":"Cold storage"}`,
  `{"type":"tx","ref":"${TX}","label":"[KYC] Bitstamp · withdrawal","origin":"wpkh([d34db33f/84h/0h/0h])","height":800000,"time":"2023-07-24T03:50:41Z","fee":2820,"value":1500000}`,
  `{"type":"tx","ref":"${"a".repeat(64)}","origin":"wpkh([d34db33f/84h/0h/0h])","height":800001,"fee":141,"value":-50000}`,
  `{"type":"addr","ref":"bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c","label":"[KYC] Bitstamp · deposit address","origin":"wpkh([d34db33f/84h/0h/0h])","keypath":"/0/0","heights":[800000]}`,
  `{"type":"output","ref":"${TX}:1","label":"[KYC] Bitstamp","origin":"wpkh([d34db33f/84h/0h/0h])","spendable":false,"keypath":"/0/0","value":1500000,"height":800000,"fmv":{"USD":441.12}}`,
  `{"type":"input","ref":"${TX}:0","origin":"wpkh([d34db33f/84h/0h/0h])","keypath":"/0/0","value":1500000}`,
].join("\n");

/** Bitcoin Core-ish: only address labels, no origin, CRLF line ends. */
const CORE = [
  `{"type": "addr", "ref": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "label": "[noKYC] Bisq · trade 42"}`,
  `{"type": "addr", "ref": "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "label": "legacy"}`,
].join("\r\n");

describe("parseBip329", () => {
  it("reads a Sparrow export: keeps extra fields, ignores records with no label", () => {
    const r = parseBip329(SPARROW)!;
    expect(r.invalid).toBe(0);
    expect(r.empty).toBe(2); // the unlabeled tx and input
    expect(r.records.map(x => x.type)).toEqual(["xpub", "tx", "addr", "output"]);
    const out = r.records[3]!;
    expect(out).toMatchObject({ spendable: false, keypath: "/0/0", value: 1500000, fmv: { USD: 441.12 } });
  });

  it("reads Bitcoin Core-ish address labels with CRLF", () => {
    const r = parseBip329(CORE)!;
    expect(r.records).toHaveLength(2);
    expect(r.invalid).toBe(0);
  });

  it("skips malformed lines with a count", () => {
    const text = [
      "not json",
      "[1,2]",
      `{"type":"utxo","ref":"${TX}:0","label":"x"}`, // unknown type
      `{"type":"tx","ref":"abc","label":"x"}`, // bad txid
      `{"type":"output","ref":"${TX}","label":"x"}`, // missing :vout
      `{"type":"output","ref":"${TX}:0","spendable":"false"}`, // string, not boolean
      `{"type":"tx","ref":"${TX}","spendable":false}`, // spendable only on outputs
      `{"type":"tx","ref":"${TX}","label":42}`,
      `{"type":"addr","ref":"bc1Qmixedcase0000000000000000000000","label":"x"}`,
      "",
      `{"type":"tx","ref":"${TX.toUpperCase()}","label":"ok"}`,
    ].join("\n");
    const r = parseBip329(text)!;
    expect(r.invalid).toBe(8);
    expect(r.empty).toBe(1); // the tx with only "spendable": the field is dropped, nothing is left
    expect(r.records).toEqual([{ type: "tx", ref: TX, label: "ok" }]);
  });

  it("spendable on a non-output record: drops only that field", () => {
    expect(parseBip329(`{"type":"tx","ref":"${TX}","label":"keep","spendable":false}`)!.records).toEqual([{ type: "tx", ref: TX, label: "keep" }]);
  });

  it("a leading-zero vout is the same outpoint", () => {
    const r = parseBip329(`{"type":"output","ref":"${TX}:01","label":"a"}\n{"type":"input","ref":"${TX}:007","label":"b"}\n{"type":"output","ref":"${TX}:1","label":"c"}`)!;
    expect(r.records.map(x => x.ref)).toEqual([`${TX}:7`, `${TX}:1`]);
    expect(r.duplicates).toBe(1);
    expect(r.records[1]!.label).toBe("c");
  });

  it("an uppercase P2TR address is lowercased", () => {
    const P2TR = "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297";
    expect(parseBip329(`{"type":"addr","ref":"${P2TR.toUpperCase()}","label":"x"}`)!.records[0]!.ref).toBe(P2TR);
  });

  it("a __proto__ key is kept as data and never touches the prototype", () => {
    const r = parseBip329(`{"type":"tx","ref":"${TX}","label":"x","__proto__":{"polluted":true}}`)!;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const rec = r.records[0]!;
    expect(Object.getPrototypeOf(rec)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(rec, "__proto__")).toBe(true);
    expect(serializeBip329(r.records)).toContain('"__proto__":{"polluted":true}');
    expect(parseBip329(serializeBip329(r.records))!.records).toEqual(r.records);
  });

  it("the 255-character cut never splits a surrogate pair", () => {
    const label = "x".repeat(MAX_LABEL_LENGTH - 1) + "\u{1F600}tail";
    const out = parseBip329(JSON.stringify({ type: "tx", ref: TX, label }))!.records[0]!.label!;
    expect(out).toBe("x".repeat(MAX_LABEL_LENGTH - 1));
    expect(out.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
  });

  it("deduplicates by type and ref: the last one wins", () => {
    const r = parseBip329(`{"type":"tx","ref":"${TX}","label":"first"}\n{"type":"addr","ref":"1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2","label":"a"}\n{"type":"tx","ref":"${TX}","label":"second"}`)!;
    expect(r.duplicates).toBe(1);
    expect(r.records.map(x => x.label)).toEqual(["a", "second"]);
  });

  it("truncates labels at 255 characters and refuses files over the size cap", () => {
    const r = parseBip329(`{"type":"tx","ref":"${TX}","label":"${"x".repeat(300)}"}`)!;
    expect(r.records[0]!.label).toHaveLength(MAX_LABEL_LENGTH);
    expect(r.truncated).toBe(1);
    expect(parseBip329("x".repeat(MAX_FILE_BYTES + 1))).toBeNull();
  });

  it("drops automatic aie: parts, keeps the user's", () => {
    expect(userPart("[KYC] Kraken | aie: group A")).toBe("[KYC] Kraken");
    expect(userPart("aie: CoinJoin output")).toBe("");
    const r = parseBip329(`{"type":"output","ref":"${TX}:0","label":"aie: toxic change"}\n{"type":"output","ref":"${TX}:1","label":"aie: group A","spendable":false}`)!;
    expect(r.empty).toBe(1);
    expect(r.records).toEqual([{ type: "output", ref: `${TX}:1`, spendable: false }]);
  });

  it("round-trips: parse(serialize(parse(x))) equals parse(x)", () => {
    const once = parseBip329(SPARROW + "\n" + CORE)!.records;
    expect(parseBip329(serializeBip329(once))!.records).toEqual(once);
    expect(serializeBip329(once).split("\n").at(-1)).toBe("");
  });
});
