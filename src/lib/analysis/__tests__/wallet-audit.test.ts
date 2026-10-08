import { describe, it, expect } from "vitest";
import { auditWallet, type WalletAddressInfo } from "../wallet-audit";
import type { MempoolAddress, MempoolTransaction, MempoolUtxo } from "@/lib/api/types";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";
import { History, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph, coinClass } from "../wallet-behavior";
import { isCoinJoinTx } from "../heuristics/coinjoin";

function makeAddr(
  address: string,
  index: number,
  txCount: number,
  utxos: MempoolUtxo[] = [],
  isChange = false,
): WalletAddressInfo {
  const addressData: MempoolAddress = {
    address,
    chain_stats: {
      funded_txo_count: txCount,
      funded_txo_sum: 100_000,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: txCount,
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
  };

  const derived: DerivedAddress = {
    path: `${isChange ? 1 : 0}/${index}`,
    address,
    isChange,
    index,
  };

  return {
    derived,
    addressData,
    txs: [],
    utxos,
  };
}

function makeUtxo(value: number, txid = "abc123"): MempoolUtxo {
  return {
    txid,
    vout: 0,
    status: { confirmed: true, block_height: 800000, block_time: 1700000000, block_hash: "" },
    value,
  };
}

describe("auditWallet", () => {
  it("detects address reuse", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 3), // reused
      makeAddr("bc1qaddr1", 1, 3), // reused
      makeAddr("bc1qaddr2", 2, 1), // not reused
      makeAddr("bc1qaddr3", 3, 1), // not reused
    ];

    const result = auditWallet(addresses);
    const reuseFinding = result.findings.find(f => f.id === "wallet-address-reuse");
    expect(reuseFinding).toBeDefined();
    expect(reuseFinding?.params?.reusedCount).toBe(2);
    expect(reuseFinding?.params?.totalReceived).toBe(4);
    expect(result.reusedAddresses).toBe(2);
    expect(result.activeAddresses).toBe(4);
  });

  it("detects dust UTXOs", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(100), makeUtxo(200), makeUtxo(300)]),
      makeAddr("bc1qaddr1", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    const dustFinding = result.findings.find(f => f.id === "wallet-dust-utxos");
    expect(dustFinding).toBeDefined();
    expect(dustFinding?.params?.dustCount).toBe(3);
    expect(result.dustUtxos).toBe(3);
    expect(result.totalUtxos).toBe(4);
  });

  it("detects toxic change", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [
        makeUtxo(1000, "a"),
        makeUtxo(2000, "b"),
        makeUtxo(3000, "c"),
        makeUtxo(5000, "d"),
      ]),
    ];

    const result = auditWallet(addresses);
    const toxicFinding = result.findings.find(f => f.id === "wallet-toxic-change");
    expect(toxicFinding).toBeDefined();
    expect(toxicFinding?.params?.toxicCount).toBe(4);
  });

  it("rewards no address reuse", () => {
    const addresses: WalletAddressInfo[] = Array.from({ length: 6 }, (_, i) =>
      makeAddr(`bc1qaddr${i}`, i, 1),
    );

    const result = auditWallet(addresses);
    const noReuse = result.findings.find(f => f.id === "wallet-no-reuse");
    expect(noReuse).toBeDefined();
    expect(noReuse?.severity).toBe("good");
    expect(result.reusedAddresses).toBe(0);
  });

  it("detects mixed script types", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(50_000)]),
      makeAddr("3addr1xxx", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    const mixedFinding = result.findings.find(f => f.id === "wallet-mixed-script-utxos");
    expect(mixedFinding).toBeDefined();
    expect(mixedFinding?.params?.scriptTypes).toBe(2);
  });

  it("counts a consolidation only when 3+ inputs are the wallet's own", () => {
    const tx = (txid: string, inputAddrs: string[]) => ({
      txid,
      vin: inputAddrs.map((a) => ({ prevout: { scriptpubkey_address: a, value: 1000 } })),
      vout: [{ scriptpubkey_address: "bc1qaddr0", value: 2000 }],
    }) as unknown as MempoolTransaction;
    const own = tx("own", ["bc1qaddr1", "bc1qaddr2", "bc1qaddr3"]);
    const received = tx("received", ["bc1qother1", "bc1qother2", "bc1qother3"]);
    const addresses = ["bc1qaddr0", "bc1qaddr1", "bc1qaddr2", "bc1qaddr3"].map((a, i) => makeAddr(a, i, 1));
    addresses[0]!.txs = [own, received];

    const finding = auditWallet(addresses).findings.find(f => f.id === "wallet-consolidation-history");
    expect(finding?.params?.consolidationCount).toBe(1);
  });

  it("calculates total balance correctly", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(100_000), makeUtxo(200_000)]),
      makeAddr("bc1qaddr1", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    expect(result.totalBalance).toBe(350_000);
    expect(result.totalUtxos).toBe(3);
  });

  it("returns score between 0 and 100", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 5), // heavily reused
      makeAddr("bc1qaddr1", 1, 1),
    ];

    const result = auditWallet(addresses);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["A+", "B", "C", "D", "F"]).toContain(result.grade);
  });

  it("tags findings with adversary tiers and temporality", () => {
    const result = auditWallet([makeAddr("bc1qaddr0", 0, 3), makeAddr("bc1qaddr1", 1, 1)]);
    const reuse = result.findings.find(f => f.id === "wallet-address-reuse");
    expect(reuse?.adversaryTiers).toEqual(["passive_observer", "kyc_exchange", "state_adversary"]);
    expect(reuse?.temporality).toBe("ongoing_pattern");
  });

  it("marks a partial scan with wallet-scan-partial (web, CLI and MCP share this)", () => {
    const partial = auditWallet([], ["a1", "a2"]).findings.find(f => f.id === "wallet-scan-partial");
    expect(partial).toMatchObject({ severity: "low", scoreImpact: 0, params: { count: 2 } });
    expect(auditWallet([]).findings.some(f => f.id === "wallet-scan-partial")).toBe(false);
  });
});

describe("auditWallet: wallet heuristics", () => {
  it("a merge counted as change merge is not also a consolidation", () => {
    const h = new History();
    const [, change] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    h.tx([change!, h.receive(recv(1), 100_000, 102), h.receive(recv(2), 100_000, 103)], [{ address: ext(2), value: 990_000 }], 104);
    const ids = auditWallet(h.infos(walletAddrs(3))).findings.map((f) => f.id);
    expect(ids).toContain("wallet-change-merge");
    expect(ids).not.toContain("wallet-consolidation-history");
  });

  it("an empty wallet gets no wallet-heuristic findings and zero origins", () => {
    const r = auditWallet([]);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(70);
    expect(r.utxoOrigins.received).toEqual({ count: 0, sats: 0 });
  });

  it("new findings carry metadata", () => {
    const h = new History();
    const [, change] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    h.tx([change!, h.receive(recv(1), 100_000, 102)], [{ address: ext(2), value: 890_000 }], 103);
    const f = auditWallet(h.infos(walletAddrs(2))).findings.find((x) => x.id === "wallet-change-merge");
    expect(f?.adversaryTiers).toEqual(["passive_observer", "kyc_exchange"]);
    expect(f?.temporality).toBe("historical");
  });
});

describe("auditWallet: final-review probe wallets (false-positive regressions)", () => {
  const ids = (h: History, n = 4) => auditWallet(h.infos(walletAddrs(n))).findings.map((f) => f.id);
  const outsiders = (n: number, value: number) => Array.from({ length: n }, (_, i) => ({ address: ext(300 + i), value }));

  it("I1: a coin paid by someone else's CoinJoin is a receipt; merging it is not a post-mix merge", () => {
    const h = new History();
    const cj = h.tx(outsiders(5, 1_300_000), [recv(0), ext(1), ext(2), ext(3), ext(4)].map((address) => ({ address, value: 1_234_567 })), 100);
    expect(isCoinJoinTx(h.txs[0]!)).toBe(true); // fixture guard
    h.tx([cj[0]!, h.receive(recv(1), 100_000, 101)], [{ address: ext(5), value: 1_330_000 }], 102);
    const infos = h.infos(walletAddrs(2));
    expect(coinClass(buildWalletGraph(infos), cj[0]!.txid, 0)).toBe("received");
    expect(ids(h, 2)).not.toContain("wallet-postmix-merge");
  });

  it("I1: a Whirlpool mix into the wallet with no wallet input still yields mixed coins", () => {
    const h = new History();
    const mix = h.tx(outsiders(5, 1_000_000), [recv(0), ext(1), ext(2), ext(3), ext(4)].map((address) => ({ address, value: 1_000_000 })), 100);
    h.tx([mix[0]!, h.receive(recv(1), 100_000, 101)], [{ address: ext(5), value: 1_090_000 }], 102);
    expect(ids(h, 2)).toContain("wallet-postmix-merge");
  });

  it("I2: an output of a tx the wallet only partly funded is unknown, so merging it is not a change merge", () => {
    const h = new History();
    const a = h.receive(recv(0), 500_000, 100);
    const [pj] = h.tx([a, { address: ext(9), value: 300_000 }], [{ address: recv(1), value: 790_000 }, { address: ext(10), value: 9_000 }], 101);
    h.tx([pj!, h.receive(recv(2), 100_000, 102)], [{ address: ext(5), value: 880_000 }], 103);
    const infos = h.infos(walletAddrs(3));
    expect(coinClass(buildWalletGraph(infos), pj!.txid, 0)).toBe("unknown");
    expect(ids(h, 3)).not.toContain("wallet-change-merge");
  });

  it("I3: an own batch paying two people the same amount is a solo spend, not a CoinJoin", () => {
    const h = new History();
    const [, c0] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    const batch = h.tx([c0!, h.receive(recv(1), 700_000, 102)], [{ address: ext(2), value: 600_000 }, { address: ext(3), value: 600_000 }, { address: chg(1), value: 297_000 }], 103);
    expect(isCoinJoinTx(h.txs.find((t) => t.txid === batch[0]!.txid)!)).toBe(true); // fixture guard: the generic detector matches
    const infos = h.infos(walletAddrs(2));
    const r = auditWallet(infos);
    expect(r.findings.map((f) => f.id)).toContain("wallet-change-merge");
    expect(r.utxoOrigins["coinjoin-change"].count).toBe(0);
    expect(r.utxoOrigins.change).toEqual({ count: 1, sats: 297_000 });
  });

  it("I4: a peel chain gets no 'coins kept apart' credit", () => {
    const h = new History();
    let coin = h.receive(recv(0), 5_000_000, 100);
    for (let i = 0; i < 3; i++) coin = h.tx([coin], [{ address: ext(i), value: 10_007 + i }, { address: chg(i), value: coin.value - 11_007 - i }], 101 + i)[1]!;
    const found = ids(h, 3);
    expect(found).toContain("wallet-peel-chain");
    expect(found).not.toContain("wallet-no-merge");
  });

  it("M1: change merged with a coin on its own address adds no new link", () => {
    const h = new History();
    const [, c0] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    const again = h.tx([{ address: ext(50), value: 60_000 }], [{ address: chg(0), value: 50_000 }], 102)[0]!;
    h.tx([c0!, again], [{ address: ext(2), value: 840_000 }], 103);
    expect(ids(h, 1)).not.toContain("wallet-change-merge");
  });
});
