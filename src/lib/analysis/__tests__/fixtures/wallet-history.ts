/**
 * Synthetic wallet histories for wallet-level heuristic tests: a tiny builder
 * over tx-factory. Addresses are fake but typed by prefix (getAddressType).
 */
import type { MempoolTransaction } from "@/lib/api/types";
import type { WalletAddressInfo } from "../../wallet-audit";
import { makeTx, makeVin, makeVout } from "../../heuristics/__tests__/fixtures/tx-factory";

export interface Coin { txid: string; vout: number; address: string; value: number }

const addr = (prefix: string, tag: string, n: number) => `${prefix}${tag}${n.toString(16).padStart(38 - tag.length, "0")}`;
/** Wallet receive / change addresses (P2WPKH-shaped) and outside addresses. */
export const recv = (i: number) => addr("bc1q", "aa", i);
export const chg = (i: number) => addr("bc1q", "cc", i);
export const ext = (i: number) => addr("bc1q", "ee", i);
export const extTaproot = (i: number) => addr("bc1p", "ee", i);

export class History {
  private n = 0;
  readonly txs: MempoolTransaction[] = [];

  /** A tx spending `inputs`, paying `outputs`, at `height`. Returns its output coins. */
  tx(inputs: (Coin | { address: string; value: number })[], outputs: { address: string; value: number }[], height: number): Coin[] {
    const txid = (++this.n).toString(16).padStart(64, "0");
    const tx = makeTx({
      txid,
      vin: inputs.map((c, i) => makeVin({
        txid: "txid" in c ? c.txid : (1000 + this.n * 10 + i).toString(16).padStart(64, "f"),
        vout: "vout" in c ? c.vout : 0,
        prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: c.address.startsWith("bc1p") ? "v1_p2tr" : "v0_p2wpkh", scriptpubkey_address: c.address, value: c.value },
      })),
      vout: outputs.map((o) => makeVout({ scriptpubkey_address: o.address, value: o.value, scriptpubkey_type: o.address.startsWith("bc1p") ? "v1_p2tr" : "v0_p2wpkh" })),
      status: { confirmed: true, block_height: height, block_time: 1_700_000_000 + height * 600 },
    });
    this.txs.push(tx);
    return outputs.map((o, vout) => ({ txid, vout, address: o.address, value: o.value }));
  }

  /** Received from outside: one external input. */
  receive(address: string, value: number, height: number): Coin {
    return this.tx([{ address: ext(900 + this.n), value: value + 1_000 }], [{ address, value }], height)[0]!;
  }

  /** WalletAddressInfo[] for `addresses` (wallet order), with txs, stats and unspent coins derived from the history. */
  infos(addresses: { address: string; isChange: boolean; index: number }[]): WalletAddressInfo[] {
    const spent = new Set(this.txs.flatMap((t) => t.vin.map((v) => `${v.txid}:${v.vout}`)));
    return addresses.map(({ address, isChange, index }) => {
      const txs = this.txs.filter((t) => t.vout.some((o) => o.scriptpubkey_address === address) || t.vin.some((v) => v.prevout?.scriptpubkey_address === address));
      const funded = this.txs.flatMap((t) => t.vout.map((o, vout) => ({ t, o, vout }))).filter(({ o }) => o.scriptpubkey_address === address);
      const utxos = funded.filter(({ t, vout }) => !spent.has(`${t.txid}:${vout}`))
        .map(({ t, o, vout }) => ({ txid: t.txid, vout, value: o.value, status: t.status }));
      const stats = { funded_txo_count: funded.length, funded_txo_sum: funded.reduce((s, f) => s + f.o.value, 0), spent_txo_count: 0, spent_txo_sum: 0, tx_count: txs.length };
      return {
        derived: { address, isChange, index, path: `${isChange ? 1 : 0}/${index}` },
        addressData: { address, chain_stats: stats, mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } },
        txs,
        utxos,
      };
    });
  }
}

/** Equal-output CoinJoin: the wallet's `input` plus 4 outside inputs, 5 x `denom` outputs (one to `mixedTo`), wallet change to `changeTo`. */
export function coinJoin(h: History, input: Coin, denom: number, mixedTo: string, changeTo: string, height: number): Coin[] {
  const others = [1, 2, 3, 4].map((i) => ({ address: ext(500 + i + height), value: denom + 50_000 }));
  const outs = [mixedTo, ext(600 + height), ext(601 + height), ext(602 + height), ext(603 + height)].map((address) => ({ address, value: denom }));
  return h.tx([input, ...others], [...outs, { address: changeTo, value: input.value - denom - 5_000 }], height);
}

/**
 * The golden wallet: a payment that reveals its change, change merged with a
 * receipt, a CoinJoin whose output is merged with unmixed change, and a peel
 * chain of 3 payments. See docs/spec-wallet-heuristics.md "Golden wallet".
 */
export function goldenWallet(): WalletAddressInfo[] {
  const h = new History();
  const r0 = h.receive(recv(0), 1_000_000, 100);
  const r1 = h.receive(recv(1), 500_000, 101);
  const [, c0] = h.tx([r0], [{ address: extTaproot(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 102); // P1
  const [, c1] = h.tx([c0!, r1], [{ address: ext(2), value: 1_150_000 }, { address: chg(1), value: 48_000 }], 103); // M1
  const r2 = h.receive(recv(2), 2_000_000, 104);
  const cj = coinJoin(h, r2, 1_000_000, recv(3), chg(2), 105);
  h.tx([cj[0]!, c1!], [{ address: ext(3), value: 1_040_000 }], 106); // PM
  const r4 = h.receive(recv(4), 3_000_000, 110);
  const [, c3] = h.tx([r4], [{ address: ext(4), value: 100_001 }, { address: chg(3), value: 2_899_000 }], 111); // P2
  const [, c4] = h.tx([c3!], [{ address: ext(5), value: 200_003 }, { address: chg(4), value: 2_698_000 }], 112); // P3
  h.tx([c4!], [{ address: ext(6), value: 150_007 }, { address: chg(5), value: 2_547_000 }], 113); // P4
  return h.infos([
    ...[0, 1, 2, 3, 4].map((i) => ({ address: recv(i), isChange: false, index: i })),
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ address: chg(i), isChange: true, index: i })),
  ]);
}

/** A careful wallet: 6 receipts, 3 single-coin changeless spends. */
export function cleanWallet(): WalletAddressInfo[] {
  const h = new History();
  const coins = [0, 1, 2, 3, 4, 5].map((i) => h.receive(recv(i), 400_000 + i * 1_111, 100 + i));
  coins.slice(0, 3).forEach((c, i) => h.tx([c], [{ address: ext(10 + i), value: c.value - 1_500 }], 200 + i));
  return h.infos([0, 1, 2, 3, 4, 5].map((i) => ({ address: recv(i), isChange: false, index: i })));
}

/** Receive and change addresses 0..n-1, in scan order. */
export const walletAddrs = (n: number) => [
  ...Array.from({ length: n }, (_, i) => ({ address: recv(i), isChange: false, index: i })),
  ...Array.from({ length: n }, (_, i) => ({ address: chg(i), isChange: true, index: i })),
];

/** The tester's signet wallet (wave A report): coins kept by 10 payments, plus CoinJoin change. */
export const TESTER_KEPT = [19_990_000_000, 9_990_000_000, 4_990_000_000, 4_920_000_000, 2_650_000_000, 1_240_000_000, 700_000_000, 99_000_000, 591_429, 134_361];
export const TESTER_CJ_CHANGE = 15_240_920;

/**
 * The tester's wallet replayed: one faucet receipt on `receive`, then 10
 * payments each keeping a coin on change(2i) and passing the rest to
 * change(2i+1); the last rest enters a CoinJoin whose mixed output leaves the
 * wallet (a postmix account elsewhere) and whose change returns to change(cjIndex).
 * Returns the history and the wallet's addresses, in scan order.
 */
export function testerHistory(receive = recv(0), change: (i: number) => string = chg, cjIndex = 146) {
  const h = new History();
  const fee = 1_000;
  const denom = 10_000_000;
  const pays = TESTER_KEPT.map((_, i) => 1_000_000 + i * 7_919);
  const lastRest = denom + TESTER_CJ_CHANGE + 5_000;
  let coin = h.receive(receive, lastRest + TESTER_KEPT.reduce((s, v) => s + v, 0) + pays.reduce((s, v) => s + v, 0) + TESTER_KEPT.length * fee, 100);
  TESTER_KEPT.forEach((kept, i) => {
    const rest = coin.value - pays[i]! - kept - fee;
    coin = h.tx([coin], [{ address: ext(i), value: pays[i]! }, { address: change(2 * i), value: kept }, { address: change(2 * i + 1), value: rest }], 101 + i)[2]!;
  });
  const others = [1, 2, 3, 4].map((i) => ({ address: ext(500 + i), value: denom + 50_000 }));
  h.tx([coin, ...others], [...[0, 1, 2, 3, 4].map((i) => ({ address: ext(600 + i), value: denom })), { address: change(cjIndex), value: TESTER_CJ_CHANGE }], 120);
  const addresses = [
    { address: receive, isChange: false, index: 0 },
    ...Array.from({ length: 2 * TESTER_KEPT.length }, (_, i) => ({ address: change(i), isChange: true, index: i })),
    { address: change(cjIndex), isChange: true, index: cjIndex },
  ];
  return { h, addresses };
}

/**
 * Peel-shaped variant of the tester's wallet: every tx has exactly one wallet
 * output. Each coin is the change of one payment from its own receipt, and the
 * CoinJoin change comes from one more receipt. With one wallet output per tx
 * two unspent coins can only share a certain cluster through address reuse,
 * so the links here are certain but each coin is its own cluster.
 */
export function testerPeelHistory(receive: (i: number) => string = recv, change: (i: number) => string = chg, cjIndex = 146) {
  const h = new History();
  const fee = 1_000;
  const denom = 10_000_000;
  TESTER_KEPT.forEach((kept, i) => {
    const pay = 1_000_000 + i * 7_919;
    const r = h.receive(receive(i), kept + pay + fee, 100 + 2 * i);
    h.tx([r], [{ address: ext(i), value: pay }, { address: change(i), value: kept }], 101 + 2 * i);
  });
  const r = h.receive(receive(TESTER_KEPT.length), denom + TESTER_CJ_CHANGE + 5_000, 130);
  const others = [1, 2, 3, 4].map((i) => ({ address: ext(500 + i), value: denom + 50_000 }));
  h.tx([r, ...others], [...[0, 1, 2, 3, 4].map((i) => ({ address: ext(600 + i), value: denom })), { address: change(cjIndex), value: TESTER_CJ_CHANGE }], 131);
  const addresses = [
    ...Array.from({ length: TESTER_KEPT.length + 1 }, (_, i) => ({ address: receive(i), isChange: false, index: i })),
    ...Array.from({ length: TESTER_KEPT.length }, (_, i) => ({ address: change(i), isChange: true, index: i })),
    { address: change(cjIndex), isChange: true, index: cjIndex },
  ];
  return { h, addresses };
}
