import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { base32 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { BbqrDecoder } from "../bbqr";

const b36 = (n: number) => n.toString(36).toUpperCase().padStart(2, "0");
function encode(data: Uint8Array, enc: "H" | "2" | "Z", type: string, parts: number): string[] {
  const body = enc === "H" ? bytesToHex(data).toUpperCase()
    : base32.encode(enc === "Z" ? new Uint8Array(deflateRawSync(data, { windowBits: 10 })) : data).replace(/=+$/, "");
  const unit = enc === "H" ? 2 : 8;
  const size = Math.ceil(body.length / parts / unit) * unit;
  return Array.from({ length: parts }, (_, i) => `B$${enc}${type}${b36(parts)}${b36(i)}` + body.slice(i * size, (i + 1) * size));
}
const psbt = buildPsbt({ sign: false, nonWitness: true }).toPSBT();
const corrupt = { kind: "error", reason: "corrupt" };


describe("BbqrDecoder", () => {
  it.each(["H", "2", "Z"] as const)("encoding %s, 3 parts out of order -> PSBT hex", async (enc) => {
    const d = new BbqrDecoder();
    const [a, b, c] = encode(psbt, enc, "P", 3);
    expect(await d.receive(c ?? "")).toEqual({ kind: "progress", received: 1, total: 3 });
    await d.receive(a ?? "");
    expect(await d.receive(b ?? "")).toEqual({ kind: "done", payload: bytesToHex(psbt) });
  });
  it("U type -> text", async () => {
    const [p] = encode(new TextEncoder().encode("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), "2", "U", 1);
    expect(await new BbqrDecoder().receive(p ?? "")).toEqual({ kind: "done", payload: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" });
  });
  it("J type is unsupported", async () => {
    const [p] = encode(new TextEncoder().encode("{}"), "2", "J", 1);
    expect(await new BbqrDecoder().receive(p ?? "")).toEqual({ kind: "error", reason: "unsupported-type" });
  });
  it("switching to a new sequence resets (Review Focus 5)", async () => {
    const d = new BbqrDecoder();
    await d.receive(encode(psbt, "H", "P", 3)[0] ?? "");
    const other = buildPsbt({ sign: true }).toPSBT();
    const parts = encode(other, "2", "P", 2);
    await d.receive(parts[0] ?? "");
    expect(await d.receive(parts[1] ?? "")).toEqual({ kind: "done", payload: bytesToHex(other) });
  });
  it("bad headers return corrupt without throwing", async () => {
    const d = new BbqrDecoder();
    expect(await d.receive("B$2P0000AAAA")).toEqual(corrupt); // total 0
    expect(await d.receive("B$2P0202AAAA")).toEqual(corrupt); // index >= total
    expect(await d.receive("B$2P0100")).toEqual(corrupt); // empty body
    expect(await d.receive("garbage")).toEqual(corrupt);
  });
  it("a corrupt frame does not reset an in-progress sequence", async () => {
    const d = new BbqrDecoder();
    const [a, b] = encode(psbt, "2", "P", 2);
    await d.receive(a ?? "");
    expect(await d.receive("B$2P0201!!!!")).toEqual(corrupt);
    expect(await d.receive(b ?? "")).toEqual({ kind: "done", payload: bytesToHex(psbt) });
  });
  it("garbage base32 -> corrupt", async () => {
    expect(await new BbqrDecoder().receive("B$2P0100ABCDEFG1")).toEqual(corrupt);
    expect(await new BbqrDecoder().receive("B$ZP0100AAAAAAAA")).toEqual(corrupt);
  });
  it("inflate bomb is rejected", async () => {
    const bomb = new Uint8Array(deflateRawSync(new Uint8Array(10 * 1024 * 1024)));
    const body = base32.encode(bomb).replace(/=+$/, "");
    expect(await new BbqrDecoder().receive(`B$ZP0100${body}`)).toEqual(corrupt);
  });
});
