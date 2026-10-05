import { Transaction, p2wpkh, NETWORK } from "@scure/btc-signer";
import { hex } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { MempoolTransaction } from "../../src/lib/api/types";

const priv = new Uint8Array(32).fill(7);
const pay = p2wpkh(secp256k1.getPublicKey(priv, true), NETWORK);
const PAY_OUT = {
  scriptpubkey: hex.encode(pay.script),
  scriptpubkey_asm: "",
  scriptpubkey_type: "v0_p2wpkh",
  scriptpubkey_address: pay.address!,
};

/**
 * Deterministic signed PSBT (fixed key, RFC6979) spending output 0 of a synthetic parent,
 * same construction as src/lib/input/__tests__/fixtures.ts. The parent is returned in
 * mempool.space JSON shape with its real txid, ready to serve on /api/tx/<txid>.
 */
export function buildSignedFixture() {
  const amounts = [100_000, 50_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000];
  const p = new Transaction({ allowUnknownInputs: true });
  p.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
  for (const a of amounts) p.addOutput({ script: pay.script, amount: BigInt(a) });

  const tx = new Transaction();
  tx.addInput({
    txid: p.id, index: 0,
    witnessUtxo: { script: pay.script, amount: 100_000n },
    // Full parent too, so the PSBT exceeds the 512-char short-input cap
    nonWitnessUtxo: p.toBytes(true, false),
  });
  tx.addOutputAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", 60_000n, NETWORK);
  tx.addOutput({ script: pay.script, amount: 39_000n });
  tx.sign(priv);
  const psbtB64 = Buffer.from(tx.toPSBT()).toString("base64");
  tx.finalize();

  const inValue = 200_000;
  const parent: MempoolTransaction = {
    txid: p.id,
    version: 2,
    locktime: 0,
    vin: [{
      txid: "01".repeat(32),
      vout: 0,
      prevout: { ...PAY_OUT, value: inValue },
      scriptsig: "",
      scriptsig_asm: "",
      witness: [],
      is_coinbase: false,
      sequence: 0xffffffff,
    }],
    vout: amounts.map((value) => ({ ...PAY_OUT, value })),
    size: 300,
    weight: 1200,
    fee: inValue - amounts.reduce((s, a) => s + a, 0),
    status: { confirmed: true, block_height: 800_000, block_hash: "00".repeat(32), block_time: 1_700_000_000 },
  };
  return { psbtB64, rawHex: tx.hex, txid: tx.id, parent };
}
