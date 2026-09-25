import { describe, it, expect } from "vitest";
import { Transaction } from "@scure/btc-signer";
import { base64 } from "@scure/base";
import { isPSBT, parsePSBT } from "../psbt";
import { bytesToHex, hexToBytes } from "../hex";
import { analyzeTransaction } from "@/lib/analysis/orchestrator";

// Valid PSBT: 1 input (100000 sats P2WPKH witnessUtxo), 1 output (90000 sats P2WPKH), fee 10000
// prettier-ignore
const PSBT_COMPLETE = "cHNidP8BAFICAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAAEBH6CGAQAAAAAAFgAUq6urq6urq6urq6urq6urq6urq6sAAA==";

describe("isPSBT", () => {
  it("recognizes base64 PSBT", () => {
    expect(isPSBT(PSBT_COMPLETE)).toBe(true);
  });

  it("recognizes hex PSBT", () => {
    expect(isPSBT("70736274ff0100")).toBe(true);
  });

  it("rejects random string", () => {
    expect(isPSBT("hello world")).toBe(false);
  });

  it("rejects xpub", () => {
    expect(isPSBT("xpub661MyMwAqRbcFtXgS5sYJA")).toBe(false);
  });

  it("rejects txid", () => {
    expect(isPSBT("a".repeat(64))).toBe(false);
  });
});

describe("parsePSBT", () => {
  it("parses a complete PSBT", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.inputCount).toBe(1);
    expect(result.outputCount).toBe(1);
    expect(result.tx.vin).toHaveLength(1);
    expect(result.tx.vout).toHaveLength(1);
    expect(result.tx.txid).toBe("psbt-preview");
    expect(result.tx.status.confirmed).toBe(false);
  });

  it("extracts output values and computes fee", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vout[0]?.value).toBe(90_000);
    expect(result.outputTotal).toBe(90_000);
    expect(result.inputTotal).toBe(100_000);
    expect(result.complete).toBe(true);
    expect(result.fee).toBe(10_000);
  });

  it("rejects invalid PSBT", () => {
    expect(() => parsePSBT("not-a-psbt")).toThrow();
  });

  it("detects P2WPKH script type in outputs", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vout[0]?.scriptpubkey_type).toBe("v0_p2wpkh");
  });

  it("detects P2WPKH script type in inputs with witnessUtxo", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vin[0]?.prevout?.scriptpubkey_type).toBe("v0_p2wpkh");
    expect(result.tx.vin[0]?.prevout?.value).toBe(100_000);
  });

  it("computes fee rate", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.feeRate).toBeGreaterThan(0);
    expect(result.vsize).toBeGreaterThan(0);
  });
});

// ---------- PSBTs built with @scure/btc-signer (deterministic fixtures) ----------

const H = 0x80000000;
const PUBKEY = hexToBytes("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
const P2WPKH_A = hexToBytes("0014" + "ab".repeat(20));
const P2WPKH_B = hexToBytes("0014" + "cd".repeat(20));
const P2PKH = hexToBytes("76a914" + "ef".repeat(20) + "88ac");
const OP_RETURN = hexToBytes("6a0568656c6c6f");
const DUMMY_TXID = hexToBytes("01".repeat(32));

function toBase64(tx: Transaction): string {
  return base64.encode(tx.toPSBT());
}

/** A previous transaction paying `amount` to `script` at output index 1. */
function prevTx(script: Uint8Array, amount: bigint): Transaction {
  const prev = new Transaction();
  prev.addInput({ txid: DUMMY_TXID, index: 0 });
  prev.addOutput({ script: P2WPKH_B, amount: BigInt(1_000) });
  prev.addOutput({ script, amount });
  return prev;
}

describe("parsePSBT - input prevouts", () => {
  it("derives the input address from witnessUtxo so same-address change is visible", () => {
    const tx = new Transaction();
    tx.addInput({ txid: DUMMY_TXID, index: 0, witnessUtxo: { script: P2WPKH_A, amount: BigInt(100_000) } });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(60_000) });
    tx.addOutput({ script: P2WPKH_A, amount: BigInt(39_000) });
    const r = parsePSBT(toBase64(tx), "mainnet");
    expect(r.tx.vin[0]?.prevout?.scriptpubkey_address).toMatch(/^bc1q/);
    expect(r.tx.vin[0]?.prevout?.scriptpubkey_address).toBe(r.tx.vout[1]?.scriptpubkey_address);
  });

  it("reads value, script and address from nonWitnessUtxo for legacy inputs", () => {
    const prev = prevTx(P2PKH, BigInt(50_000));
    const tx = new Transaction();
    tx.addInput({ txid: prev.id, index: 1, nonWitnessUtxo: prev.toBytes(true, false) });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(45_000) });
    const r = parsePSBT(toBase64(tx), "mainnet");
    const prevout = r.tx.vin[0]!.prevout!;
    expect(prevout.value).toBe(50_000);
    expect(prevout.scriptpubkey_type).toBe("p2pkh");
    expect(prevout.scriptpubkey_address).toMatch(/^1/);
    expect(r.complete).toBe(true);
    expect(r.fee).toBe(5_000);
  });

  it("leaves prevout null and marks incomplete when no UTXO data is present", async () => {
    const tx = new Transaction();
    tx.addInput({ txid: DUMMY_TXID, index: 0 });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(45_000) });
    const r = parsePSBT(toBase64(tx), "mainnet");
    expect(r.tx.vin[0]?.prevout).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.fee).toBe(0);
    // Heuristics must tolerate the unknown prevout
    await expect(analyzeTransaction(r.tx)).resolves.toBeDefined();
  });

  it("copies finalScriptWitness and finalScriptSig into the vin", () => {
    const prev = prevTx(P2PKH, BigInt(50_000));
    const tx = new Transaction();
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(140_000) });
    tx.addInput({ txid: DUMMY_TXID, index: 0, witnessUtxo: { script: P2WPKH_A, amount: BigInt(100_000) } });
    tx.addInput({ txid: prev.id, index: 1, nonWitnessUtxo: prev.toBytes(true, false) });
    tx.updateInput(0, { finalScriptWitness: [hexToBytes("3044aa01"), PUBKEY] }, true);
    tx.updateInput(1, { finalScriptSig: hexToBytes("0101") }, true);
    const r = parsePSBT(toBase64(tx), "mainnet");
    expect(r.tx.vin[0]?.witness).toEqual(["3044aa01", bytesToHex(PUBKEY)]);
    expect(r.tx.vin[0]?.scriptsig).toBe("");
    expect(r.tx.vin[1]?.witness).toEqual([]);
    expect(r.tx.vin[1]?.scriptsig).toBe("0101");
  });
});

describe("parsePSBT - outputs and network", () => {
  it("labels OP_RETURN outputs as op_return with no address", () => {
    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({ txid: DUMMY_TXID, index: 0, witnessUtxo: { script: P2WPKH_A, amount: BigInt(100_000) } });
    tx.addOutput({ script: OP_RETURN, amount: BigInt(0) });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(90_000) });
    const r = parsePSBT(toBase64(tx), "mainnet");
    expect(r.tx.vout[0]?.scriptpubkey_type).toBe("op_return");
    expect(r.tx.vout[0]?.scriptpubkey_address).toBe("");
  });

  it("encodes addresses for the requested test network", () => {
    const tx = new Transaction();
    tx.addInput({ txid: DUMMY_TXID, index: 0, witnessUtxo: { script: P2WPKH_A, amount: BigInt(100_000) } });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(90_000) });
    const r = parsePSBT(toBase64(tx), "testnet4");
    expect(r.network).toBe("testnet");
    expect(r.tx.vin[0]?.prevout?.scriptpubkey_address).toMatch(/^tb1q/);
    expect(r.tx.vout[0]?.scriptpubkey_address).toMatch(/^tb1q/);
  });

  it("infers testnet from a BIP32 coin type 1' derivation hint when no network is given", () => {
    const tx = new Transaction();
    tx.addInput({
      txid: DUMMY_TXID, index: 0,
      witnessUtxo: { script: P2WPKH_A, amount: BigInt(100_000) },
      bip32Derivation: [[PUBKEY, { fingerprint: 0xd34db33f, path: [84 + H, 1 + H, H, 0, 0] }]],
    });
    tx.addOutput({ script: P2WPKH_B, amount: BigInt(90_000) });
    const r = parsePSBT(toBase64(tx));
    expect(r.network).toBe("testnet");
    expect(r.tx.vout[0]?.scriptpubkey_address).toMatch(/^tb1q/);
  });

  it("rejects malformed hex with a hex error", () => {
    expect(() => parsePSBT("70736274ffzz")).toThrow(/hex/i);
  });
});
