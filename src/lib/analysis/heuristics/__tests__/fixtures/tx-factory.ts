import type {
  MempoolTransaction,
  MempoolVin,
  MempoolVout,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";

let addrCounter = 0;

/** Generate a unique bc1q address for test isolation. */
function uniqueAddr(): string {
  const hex = (addrCounter++).toString(16).padStart(38, "0");
  return `bc1q${hex}`;
}

/** Reset the address counter between tests if needed. */
export function resetAddrCounter(): void {
  addrCounter = 0;
}

export function makeVin(overrides: Partial<MempoolVin> = {}): MempoolVin {
  const addr = uniqueAddr();
  return {
    txid: "b".repeat(64),
    vout: 0,
    prevout: {
      scriptpubkey: "0014" + "c".repeat(40),
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "c".repeat(40),
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: addr,
      value: 100000,
    },
    scriptsig: "",
    scriptsig_asm: "",
    is_coinbase: false,
    sequence: 0xfffffffd,
    ...overrides,
  };
}

export function makeVout(overrides: Partial<MempoolVout> = {}): MempoolVout {
  return {
    scriptpubkey: "0014" + "d".repeat(40),
    scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "d".repeat(40),
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: uniqueAddr(),
    value: 48000,
    ...overrides,
  };
}

export function makeTx(overrides: Partial<MempoolTransaction> = {}): MempoolTransaction {
  return {
    txid: "a".repeat(64),
    version: 2,
    locktime: 0,
    size: 250,
    weight: 700,
    fee: 1500,
    vin: [makeVin()],
    vout: [makeVout(), makeVout({ value: 50000 })],
    status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    ...overrides,
  };
}

export function makeAddress(overrides: Partial<MempoolAddress> = {}): MempoolAddress {
  return {
    address: "bc1q" + "a".repeat(38),
    chain_stats: {
      funded_txo_count: 1,
      funded_txo_sum: 100000,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 1,
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
    ...overrides,
  };
}

export function makeUtxo(overrides: Partial<MempoolUtxo> = {}): MempoolUtxo {
  return {
    txid: "a".repeat(64),
    vout: 0,
    value: 50000,
    status: { confirmed: true, block_height: 800000 },
    ...overrides,
  };
}

/** Create a coinbase vin (is_coinbase=true, prevout=null). */
export function makeCoinbaseVin(): MempoolVin {
  return {
    txid: "0".repeat(64),
    vout: 0xffffffff,
    prevout: null,
    scriptsig: "03e80700",
    scriptsig_asm: "OP_PUSHBYTES_3 e80700",
    is_coinbase: true,
    sequence: 0xffffffff,
  };
}

/** Create an OP_RETURN output. */
export function makeOpReturnVout(data = "deadbeef"): MempoolVout {
  return {
    scriptpubkey: `6a${data}`,
    scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_${data.length / 2} ${data}`,
    scriptpubkey_type: "op_return",
    value: 0,
  };
}
