import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolAddress, MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { parseXpub, deriveOneAddress } from "@/lib/bitcoin/descriptor";

// BIP-84 test vector account zpub (public test data, no funds)
export const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
export const parsed = parseXpub(ZPUB);
export const addr = (chain: 0 | 1, index: number) => deriveOneAddress(parsed, chain, index).address;
const EXTERNAL = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

/**
 * In-memory esplora: txs, outspends and address views derived from them, and a
 * count of every request by method.
 */
export class FakeChain {
  tip = 1000;
  txs = new Map<string, MempoolTransaction>();
  outspends = new Map<string, MempoolOutspend[]>();
  requests: Record<string, number> = {};
  private seq = 0;

  get total(): number {
    return Object.values(this.requests).reduce((a, b) => a + b, 0);
  }

  /** A tx paying `outputs`, spending wallet coins `inputs` (or an external coin). */
  tx(outputs: { address: string; value: number }[], inputs: { txid: string; vout: number }[] = [], confirmed = true): MempoolTransaction {
    const txid = (++this.seq).toString(16).padStart(64, "0");
    const prevout = (address: string, value: number) => ({ scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value });
    const vin = inputs.length === 0
      ? [{ txid: "ee".repeat(32), vout: 0, prevout: prevout(EXTERNAL, 1e8), scriptsig: "", scriptsig_asm: "", is_coinbase: false, sequence: 0 }]
      : inputs.map((i, k) => {
          const prev = this.txs.get(i.txid)!.vout[i.vout]!;
          this.outspends.get(i.txid)![i.vout] = { spent: true, txid, vin: k };
          return { txid: i.txid, vout: i.vout, prevout: prevout(prev.scriptpubkey_address!, prev.value), scriptsig: "", scriptsig_asm: "", is_coinbase: false, sequence: 0 };
        });
    const tx: MempoolTransaction = {
      txid, version: 2, locktime: 0, size: 200, weight: 560, fee: 500, vin,
      vout: outputs.map(o => ({ ...prevout(o.address, o.value) })),
      status: confirmed ? { confirmed: true, block_height: this.tip, block_hash: "00".repeat(32), block_time: 1_700_000_000 } : { confirmed: false },
    };
    this.txs.set(txid, tx);
    this.outspends.set(txid, tx.vout.map(() => ({ spent: false })));
    return tx;
  }

  mine(blocks = 1) {
    this.tip += blocks;
  }

  confirm(txid: string, height = this.tip) {
    const tx = this.txs.get(txid)!;
    tx.status = { confirmed: true, block_height: height, block_hash: "11".repeat(32), block_time: 1_700_000_600 };
  }

  private txsOf(a: string) {
    return [...this.txs.values()]
      .filter(t => t.vout.some(o => o.scriptpubkey_address === a) || t.vin.some(i => i.prevout?.scriptpubkey_address === a))
      .map(t => structuredClone(t))
      .reverse();
  }

  private count(method: string) {
    this.requests[method] = (this.requests[method] ?? 0) + 1;
  }

  async getTipHeight(): Promise<number> {
    this.count("tip");
    return this.tip;
  }

  client(): MempoolClient {
    const utxos = (a: string) => [...this.txs.values()].flatMap(t => t.vout.flatMap((o, vout) =>
      o.scriptpubkey_address === a && !this.outspends.get(t.txid)![vout]!.spent ? [{ txid: t.txid, vout, value: o.value, status: t.status }] : []));
    const notUsed = async () => { throw new Error("not used by wallet scans"); };
    return {
      getAddress: async (a: string): Promise<MempoolAddress> => {
        this.count("getAddress");
        const txs = this.txsOf(a);
        const conf = txs.filter(t => t.status.confirmed).length;
        const stats = (n: number) => ({ funded_txo_count: n, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: n });
        return { address: a, chain_stats: stats(conf), mempool_stats: stats(txs.length - conf) };
      },
      getAddressTxs: async (a: string) => { this.count("getAddressTxs"); return this.txsOf(a); },
      getAddressUtxos: async (a: string) => { this.count("getAddressUtxos"); return utxos(a); },
      getTxOutspends: async (txid: string) => {
        this.count("getTxOutspends");
        const o = this.outspends.get(txid);
        if (!o) throw new ApiError("NOT_FOUND");
        return structuredClone(o);
      },
      getTransaction: async (txid: string) => {
        this.count("getTransaction");
        const t = this.txs.get(txid);
        if (!t) throw new ApiError("NOT_FOUND");
        return structuredClone(t);
      },
      getTxHex: notUsed,
      getRecommendedFees: notUsed,
      getAddressPrefix: notUsed,
      getHistoricalPrice: notUsed,
      getHistoricalEurPrice: notUsed,
    } as MempoolClient;
  }
}
