import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { base32 } from "@scure/base";
import { UREncoder } from "@ngraveio/bc-ur";
import { CryptoPSBT, CryptoHDKey, CryptoKeypath, PathComponent, CryptoCoinInfo, CryptoOutput, ScriptExpressions, MultiKey } from "@keystonehq/bc-ur-registry";
import { HDKey } from "@scure/bip32";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt, coldcardJson } from "./fixtures";
import { QrAssembler } from "../qr-assembler";

const b36 = (n: number) => n.toString(36).toUpperCase().padStart(2, "0");
function bbqr(data: Uint8Array, parts: number): string[] {
  const body = base32.encode(new Uint8Array(deflateRawSync(data, { windowBits: 10 }))).replace(/=+$/, "");
  const size = Math.ceil(body.length / parts / 8) * 8;
  return Array.from({ length: parts }, (_, i) => `B$ZP${b36(parts)}${b36(i)}` + body.slice(i * size, (i + 1) * size));
}
const psbtA = buildPsbt({ sign: false, nonWitness: true }).toPSBT();
const psbtB = buildPsbt({ sign: true }).toPSBT();
const urEnc = (b: Uint8Array) => new UREncoder(new CryptoPSBT(Buffer.from(b)).toUR(), 60);
const addr = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

describe("QrAssembler", () => {
  it("plain text -> done, trimmed; bitcoin: URI passed through", async () => {
    const a = new QrAssembler();
    expect(await a.push(`  ${addr}\n`)).toEqual({ kind: "done", payload: addr });
    expect(await a.push(`bitcoin:${addr.toUpperCase()}?amount=1`)).toEqual({ kind: "done", payload: `bitcoin:${addr.toUpperCase()}?amount=1` });
  });

  it("plain JSON wallet export frame -> descriptor; other JSON-looking text passes through", async () => {
    const { json } = coldcardJson({ desc: true });
    const a = new QrAssembler();
    expect(await a.push(JSON.stringify(json))).toEqual({ kind: "done", payload: (json.bip84 as { desc: string }).desc });
    expect(await a.push(" {not json} ")).toEqual({ kind: "done", payload: "{not json}" });
    expect(await a.push('{"p2sh_foo":1}')).toEqual({ kind: "done", payload: '{"p2sh_foo":1}' });
  });

  it("multisig-only wallet JSON (plain frame or BBQr J) -> error multisig", async () => {
    const { json } = coldcardJson({ withMultisig: true });
    for (const k of ["bip44", "bip49", "bip84", "bip86"]) delete json[k];
    const text = JSON.stringify(json);
    expect(await new QrAssembler().push(text)).toEqual({ kind: "error", reason: "multisig" });
    const body = base32.encode(new Uint8Array(deflateRawSync(new TextEncoder().encode(text), { windowBits: 10 }))).replace(/=+$/, "");
    expect(await new QrAssembler().push(`B$ZJ0100${body}`)).toEqual({ kind: "error", reason: "multisig" });
  });

  it("UR multipart with a garbage frame and repeats still completes", async () => {
    const a = new QrAssembler();
    const enc = urEnc(psbtA);
    let s = await a.push(enc.nextPart());
    expect(s).toMatchObject({ kind: "progress", format: "ur" });
    const before = s;
    expect(await a.push("ur:crypto-psbt/1-3/zzzz")).toEqual(before);
    for (let i = 0; i < enc.fragmentsLength * 3 && s.kind !== "done"; i++) { const p = enc.nextPart(); await a.push(p); s = await a.push(p); }
    expect(s).toEqual({ kind: "done", payload: bytesToHex(psbtA) });
  });

  it("BBQr progress, then UR sequence resets and completes (Review Focus 5)", async () => {
    const a = new QrAssembler();
    const [b0] = bbqr(psbtA, 3);
    expect(await a.push(b0!)).toMatchObject({ kind: "progress", format: "bbqr", received: 1, total: 3 });
    const enc = urEnc(psbtB);
    let s = await a.push(enc.nextPart());
    for (let i = 0; i < enc.fragmentsLength * 3 && s.kind !== "done"; i++) s = await a.push(enc.nextPart());
    expect(s).toEqual({ kind: "done", payload: bytesToHex(psbtB) });
  });

  it("UR progress, then BBQr completes; overlapping pushes stay consistent", async () => {
    const a = new QrAssembler();
    await a.push(urEnc(psbtA).nextPart());
    const parts = bbqr(psbtB, 3);
    const results = await Promise.all(parts.map((p) => a.push(p)));
    expect(results[2]).toEqual({ kind: "done", payload: bytesToHex(psbtB) });
  });

  it("crypto-output multisig -> error multisig", async () => {
    const m = HDKey.fromMasterSeed(new Uint8Array(32).fill(1));
    const acct = m.derive("m/84'/0'/0'");
    const fp = Buffer.alloc(4); fp.writeUInt32BE(m.fingerprint);
    const pfp = Buffer.alloc(4); pfp.writeUInt32BE(acct.parentFingerprint);
    const key = new CryptoHDKey({
      isMaster: false, key: Buffer.from(acct.publicKey!), chainCode: Buffer.from(acct.chainCode!),
      origin: new CryptoKeypath([84, 0, 0].map((index) => new PathComponent({ index, hardened: true })), fp, 3),
      parentFingerprint: pfp, useInfo: new CryptoCoinInfo(0, 0),
    });
    const out = new CryptoOutput([ScriptExpressions.WITNESS_SCRIPT_HASH, ScriptExpressions.MULTISIG], new MultiKey(1, [key]));
    expect(await new QrAssembler().push(new UREncoder(out.toUR(), 10_000).nextPart())).toEqual({ kind: "error", reason: "multisig" });
  });

  it("push then immediate reset stays idle", async () => {
    const a = new QrAssembler();
    const p = a.push(addr);
    a.reset();
    expect(await p).toEqual({ kind: "idle" });
    expect(await a.push(addr)).toEqual({ kind: "done", payload: addr });
  });

  it("reset during a pending BBQr inflate yields no late done", async () => {
    const a = new QrAssembler();
    const parts = bbqr(psbtA, 2);
    await a.push(parts[0]!);
    const p = a.push(parts[1]!);
    a.reset();
    expect(await p).toEqual({ kind: "idle" });
    // decoder is clean too: the first frame alone is progress again, not done
    expect(await a.push(parts[0]!)).toMatchObject({ kind: "progress", received: 1, total: 2 });
  });

  it("recovers after an error and after done", async () => {
    const a = new QrAssembler();
    const bad = new UREncoder(new CryptoPSBT(Buffer.from(psbtA)).toUR(), 10_000).nextPart().replace("crypto-psbt", "crypto-bogus");
    expect(await a.push(bad)).toMatchObject({ kind: "error" });
    expect(await a.push(addr)).toEqual({ kind: "done", payload: addr });
    expect(await a.push("  " + psbtB.length + "x  ")).toEqual({ kind: "done", payload: psbtB.length + "x" });
  });
});
