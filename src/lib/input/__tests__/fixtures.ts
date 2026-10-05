import { Transaction, p2wpkh, NETWORK } from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export const priv = new Uint8Array(32).fill(7);
export const pub = secp256k1.getPublicKey(priv, true);
export const pay = p2wpkh(pub, NETWORK);

/** Parent tx paying 100_000 sats to `pay` (unsigned is fine: only its outputs matter). */
function parentTx(): Transaction {
  const p = new Transaction({ allowUnknownInputs: true });
  p.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
  p.addOutput({ script: pay.script, amount: 100_000n });
  p.addOutput({ script: pay.script, amount: 50_000n });
  // Padding so a PSBT embedding this parent (non_witness_utxo) exceeds 512 base64 chars.
  for (let i = 0; i < 6; i++) p.addOutput({ script: pay.script, amount: 1_000n });
  return p;
}

export function buildPsbt(opts: { sign: boolean; nonWitness?: boolean }) {
  const parent = parentTx();
  const tx = new Transaction();
  tx.addInput({
    txid: parent.id, index: 0,
    witnessUtxo: { script: pay.script, amount: 100_000n },
    ...(opts.nonWitness ? { nonWitnessUtxo: parent.toBytes(true, false) } : {}),
  });
  tx.addOutputAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", 60_000n, NETWORK);
  tx.addOutput({ script: pay.script, amount: 39_000n });
  if (opts.sign) tx.sign(priv);
  return tx;
}
