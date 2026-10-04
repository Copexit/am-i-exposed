import { describe, it, expect } from "vitest";
import { UR, UREncoder } from "@ngraveio/bc-ur";
import { CryptoPSBT, CryptoHDKey, CryptoKeypath, PathComponent, CryptoCoinInfo, CryptoAccount, CryptoOutput, ScriptExpressions, MultiKey } from "@keystonehq/bc-ur-registry";
import { HDKey } from "@scure/bip32";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { isXpubOrDescriptor } from "@/lib/bitcoin/descriptor";
import { UrDecoder } from "../index";

const psbtBytes = buildPsbt({ sign: false, nonWitness: true }).toPSBT();
const encoderFor = (ur: UR, frag = 60) => new UREncoder(ur, frag);

describe("UrDecoder", () => {
  it("single-part ur:crypto-psbt -> PSBT hex", () => {
    const ur = new CryptoPSBT(Buffer.from(psbtBytes)).toUR();
    const d = new UrDecoder();
    expect(d.receive(encoderFor(ur, 10_000).nextPart())).toEqual({ kind: "done", payload: bytesToHex(psbtBytes) });
  });

  it("multi-part, uppercase, out of order and with drops", () => {
    const enc = encoderFor(new CryptoPSBT(Buffer.from(psbtBytes)).toUR());
    const parts = Array.from({ length: enc.fragmentsLength * 3 }, () => enc.nextPart().toUpperCase());
    const shuffled = parts.filter((_, i) => i % 3 !== 1).reverse(); // drop a third, reverse order
    const d = new UrDecoder();
    let last: ReturnType<UrDecoder["receive"]> = { kind: "progress", percent: 0 };
    for (const p of shuffled) { last = d.receive(p); if (last.kind === "done") break; }
    expect(last).toEqual({ kind: "done", payload: bytesToHex(psbtBytes) });
  });

  it("resets when a different sequence starts (Review Focus 5)", () => {
    const a = encoderFor(new CryptoPSBT(Buffer.from(psbtBytes)).toUR());
    const other = buildPsbt({ sign: true }).toPSBT();
    const b = encoderFor(new CryptoPSBT(Buffer.from(other)).toUR());
    const d = new UrDecoder();
    d.receive(a.nextPart()); d.receive(a.nextPart());
    let last: ReturnType<UrDecoder["receive"]> = { kind: "progress", percent: 0 };
    for (let i = 0; i < b.fragmentsLength * 3 && last.kind !== "done"; i++) last = d.receive(b.nextPart());
    expect(last).toEqual({ kind: "done", payload: bytesToHex(other) });
  });

  // A real BIP84 account key, so the decoded xpub can be compared byte for byte
  const master = HDKey.fromMasterSeed(new Uint8Array(32).fill(1));
  const account = master.derive("m/84'/0'/0'");
  const fp = Buffer.alloc(4); fp.writeUInt32BE(master.fingerprint);
  const pfp = Buffer.alloc(4); pfp.writeUInt32BE(account.parentFingerprint);
  const hdkey = () => new CryptoHDKey({
    isMaster: false,
    key: Buffer.from(account.publicKey!),
    chainCode: Buffer.from(account.chainCode!),
    origin: new CryptoKeypath([84, 0, 0].map((index) => new PathComponent({ index, hardened: true })), fp, 3),
    parentFingerprint: pfp,
    useInfo: new CryptoCoinInfo(0, 0),
  });

  it("ur:crypto-account -> wpkh descriptor whose xpub matches the real account key", () => {
    const acct = new CryptoAccount(fp, [new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], hdkey())]);
    const r = new UrDecoder().receive(encoderFor(acct.toUR(), 10_000).nextPart());
    expect(r).toEqual({ kind: "done", payload: `wpkh([${fp.toString("hex")}/84h/0h/0h]${account.publicExtendedKey})` });
    expect(isXpubOrDescriptor((r as { payload: string }).payload)).toBe(true);
  });

  it("multisig crypto-output is rejected with a clear reason", () => {
    const out = new CryptoOutput([ScriptExpressions.WITNESS_SCRIPT_HASH, ScriptExpressions.MULTISIG], new MultiKey(1, [hdkey()]));
    expect(new UrDecoder().receive(encoderFor(out.toUR(), 10_000).nextPart())).toEqual({ kind: "error", reason: "multisig" });
  });
});
