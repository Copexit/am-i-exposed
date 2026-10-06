import { Transaction, p2wpkh, NETWORK } from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import { descriptorChecksum } from "@/lib/bitcoin/descriptor";

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

const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };
const PURPOSES = [["bip44", 44, "pkh"], ["bip49", 49, "sh(wpkh"], ["bip84", 84, "wpkh"], ["bip86", 86, "tr"]] as const;

/** Coldcard "Generic JSON" wallet export (same shape Sparrow reads), real keys from a fixed seed. */
export function coldcardJson(opts: { testnet?: boolean; desc?: boolean; withMultisig?: boolean } = {}) {
  const master = HDKey.fromMasterSeed(new Uint8Array(32).fill(3), opts.testnet ? TESTNET_VERSIONS : undefined);
  const coin = opts.testnet ? 1 : 0;
  const xfp = master.fingerprint.toString(16).padStart(8, "0").toUpperCase();
  const json: Record<string, unknown> = { chain: opts.testnet ? "XTN" : "BTC", xfp, account: 0, xpub: master.publicExtendedKey };
  const accounts: Record<string, HDKey> = {};
  for (const [name, purpose, wrap] of PURPOSES) {
    const acct = master.derive(`m/${purpose}'/${coin}'/0'`);
    accounts[name] = acct;
    const body = `${wrap}([${xfp.toLowerCase()}/${purpose}h/${coin}h/0h]${acct.publicExtendedKey}/<0;1>/*)${wrap.includes("(") ? ")" : ""}`;
    json[name] = {
      name, deriv: `m/${purpose}'/${coin}'/0'`, xpub: acct.publicExtendedKey,
      ...(opts.desc ? { desc: `${body}#${descriptorChecksum(body)}` } : {}),
    };
  }
  if (opts.withMultisig) json.bip48_2 = { deriv: `m/48'/${coin}'/0'/2'`, xpub: master.derive(`m/48'/${coin}'/0'/2'`).publicExtendedKey, desc: "wsh(sortedmulti(...))" };
  return { json, master, xfp, accounts };
}
