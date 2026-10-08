import { describe, it, expect } from "vitest";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { scanChain } from "../scan";
import { quickRefresh, REFRESH_WINDOW } from "../refresh";
import { lastUsedIndex, SNAPSHOT_VERSION, type WalletSnapshot } from "../saved-wallets";
import { FakeChain, parsed, addr } from "./fake-chain";

async function fullScan(chain: FakeChain, gap: number): Promise<WalletAddressInfo[]> {
  const infos: WalletAddressInfo[] = [];
  for (const c of [0, 1] as const) {
    const r = await scanChain(parsed, c, chain.client(), new AbortController().signal, true, gap, () => {});
    infos.push(...r.infos);
  }
  return infos;
}

function snapshotOf(chain: FakeChain, infos: WalletAddressInfo[], gap: number): WalletSnapshot {
  const now = Date.now();
  return {
    v: SNAPSHOT_VERSION, scannedAt: now, fullScanAt: now, gapLimit: gap, tipHeight: chain.tip,
    scriptType: parsed.scriptType, lastUsed: lastUsedIndex(infos), infos, traces: [], labels: [],
  };
}

/** What the audit sees: used addresses with their txs (and statuses) and coins. */
function view(infos: WalletAddressInfo[]) {
  return infos
    .filter(i => i.txs.length > 0)
    .map(i => ({
      path: i.derived.path,
      txs: i.txs.map(t => `${t.txid}:${t.status.confirmed ? t.status.block_height : "mempool"}`).sort(),
      utxos: i.utxos.map(u => `${u.txid}:${u.vout}`).sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function refresh(chain: FakeChain, snap: WalletSnapshot) {
  chain.requests = {};
  return quickRefresh(snap, parsed, [0, 1], chain.client(), () => chain.getTipHeight(), { local: true });
}

/** Five used receive addresses, one spend with change at 1/0. */
async function smallWallet() {
  const chain = new FakeChain();
  const funding = [0, 1, 2, 3, 4].map(i => chain.tx([{ address: addr(0, i), value: 100_000 + i }]));
  chain.tx([{ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", value: 150_000 }, { address: addr(1, 0), value: 50_000 }],
    [{ txid: funding[0]!.txid, vout: 0 }, { txid: funding[1]!.txid, vout: 0 }]);
  chain.mine(10);
  const infos = await fullScan(chain, 20);
  return { chain, snap: snapshotOf(chain, infos, 20), funding };
}

describe("quickRefresh", () => {
  it("no activity: up to date with tip + one outspends call per coin txid + a window per chain", async () => {
    const { chain, snap } = await smallWallet();
    const r = await refresh(chain, snap);
    expect(r.newTxids).toEqual([]);
    expect(view(r.infos)).toEqual(view(snap.infos));
    // Coins: 0/2, 0/3, 0/4 and the change 1/0, each from its own tx
    expect(chain.requests).toEqual({ tip: 1, getTxOutspends: 4, getAddress: 2 * REFRESH_WINDOW });
  });

  it("finds a receive past the frontier and keeps extending the window", async () => {
    const { chain, snap } = await smallWallet();
    const a = chain.tx([{ address: addr(0, 9), value: 7_000 }]);
    const b = chain.tx([{ address: addr(0, 9 + REFRESH_WINDOW), value: 8_000 }]);
    const r = await refresh(chain, snap);
    expect(r.newTxids.sort()).toEqual([a.txid, b.txid].sort());
    expect(view(r.infos)).toEqual(view(await fullScan(chain, 30)));
    expect(lastUsedIndex(r.infos)[0]).toBe(9 + REFRESH_WINDOW);
  });

  it("detects the spend of a saved coin and the change it creates", async () => {
    const { chain, snap, funding } = await smallWallet();
    const spend = chain.tx([{ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", value: 90_000 }, { address: addr(1, 1), value: 12_000 }],
      [{ txid: funding[2]!.txid, vout: 0 }]);
    const r = await refresh(chain, snap);
    expect(r.newTxids).toEqual([spend.txid]);
    const spent = r.infos.find(i => i.derived.path === "0/2")!;
    expect(spent.utxos).toEqual([]);
    expect(spent.txs.map(t => t.txid)).toContain(spend.txid);
    expect(view(r.infos)).toEqual(view(await fullScan(chain, 20)));
  });

  it("picks up a new unconfirmed tx, then its confirmation", async () => {
    const { chain, snap } = await smallWallet();
    const pending = chain.tx([{ address: addr(0, 5), value: 3_000 }], [], false);
    const r1 = await refresh(chain, snap);
    expect(r1.newTxids).toEqual([pending.txid]);
    expect(r1.infos.find(i => i.derived.path === "0/5")!.txs[0]!.status.confirmed).toBe(false);

    chain.mine();
    chain.confirm(pending.txid);
    const snap2 = { ...snap, infos: r1.infos, tipHeight: r1.tipHeight, lastUsed: lastUsedIndex(r1.infos) };
    const r2 = await refresh(chain, snap2);
    expect(r2.newTxids).toEqual([]);
    expect(r2.infos.find(i => i.derived.path === "0/5")!.txs[0]!.status).toMatchObject({ confirmed: true, block_height: chain.tip });
  });

  it("reorg-safe: a shallow confirmation is rechecked, a deep one is not", async () => {
    const { chain, snap } = await smallWallet();
    // Saved at 1 confirmation, then reorged into the next block
    const shallow = chain.tx([{ address: addr(0, 5), value: 4_000 }]);
    const r0 = await refresh(chain, snap);
    const snap1 = { ...snap, infos: r0.infos, tipHeight: chain.tip, lastUsed: lastUsedIndex(r0.infos) };
    chain.mine();
    chain.confirm(shallow.txid, chain.tip);
    const r1 = await refresh(chain, snap1);
    expect(r1.infos.find(i => i.derived.path === "0/5")!.txs[0]!.status.block_height).toBe(chain.tip);
    // Only 0/5 was refetched (3 calls); the 10-deep txs were not
    expect(chain.requests.getAddressTxs).toBe(1);
  });
});

// ---------- Request-count harness ----------

/**
 * 250 used addresses (200 receive, 50 change), 150 coins, gap limit 300:
 * the full scan walks 850 addresses, the quick refresh checks what can change.
 */
async function bigWallet() {
  const chain = new FakeChain();
  const pays = Array.from({ length: 200 }, (_, i) => chain.tx([{ address: addr(0, i), value: 50_000 + i }]));
  for (let k = 0; k < 50; k++) {
    chain.tx([{ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", value: 60_000 }, { address: addr(1, k), value: 39_000 }],
      [{ txid: pays[2 * k]!.txid, vout: 0 }, { txid: pays[2 * k + 1]!.txid, vout: 0 }]);
  }
  chain.mine(100);
  return chain;
}

describe("request counts: quick refresh vs full scan (mocked 250-address wallet, gap 300)", () => {
  it("counts requests", async () => {
    const chain = await bigWallet();
    chain.requests = {};
    const infos = await fullScan(chain, 300);
    const full = chain.total;
    expect(infos).toHaveLength(200 + 300 + 50 + 300);
    expect(full).toBe(3 * 850);

    const snap = snapshotOf(chain, infos, 300);
    const idle = await refresh(chain, snap);
    const quick = chain.total;
    expect(idle.newTxids).toEqual([]);
    // 1 tip + 150 coin txids + 2 x 20 frontier addresses
    expect(quick).toBe(1 + 150 + 2 * REFRESH_WINDOW);

    chain.tx([{ address: addr(0, 200), value: 1_000 }]);
    const active = await refresh(chain, snap);
    const quickActive = chain.total;
    expect(active.newTxids).toHaveLength(1);
    // + 3 calls for the new address, + 1 more frontier address
    expect(quickActive).toBe(quick + 3 + 1);

    console.info(`[request harness] full scan: ${full} requests; quick refresh: ${quick} (idle), ${quickActive} (one new payment)`);
  }, 60_000);
});

// Optional: the same comparison on a real signet wallet. Never hardcode a key here:
// AIE_HARNESS_XPUB=tpub... [AIE_HARNESS_API=https://mempool.space/signet/api] [AIE_HARNESS_GAP=20] pnpm vitest run refresh
const REAL_XPUB = process.env.AIE_HARNESS_XPUB;
describe.skipIf(!REAL_XPUB)("request counts on a real wallet (AIE_HARNESS_XPUB)", () => {
  it("counts requests", async () => {
    const { parseXpub } = await import("@/lib/bitcoin/descriptor");
    const { createMempoolClient } = await import("@/lib/api/mempool");
    const { walletChains } = await import("../scan");
    const real = parseXpub(REAL_XPUB!);
    const base = process.env.AIE_HARNESS_API ?? "https://mempool.space/signet/api";
    const gap = Number(process.env.AIE_HARNESS_GAP ?? 20);
    const inner = createMempoolClient(base);
    let n = 0;
    const counted = Object.fromEntries(Object.entries(inner).map(([k, f]) =>
      [k, (...a: unknown[]) => { n++; return (f as (...x: unknown[]) => unknown)(...a); }])) as typeof inner;
    const tip = async () => { n++; return Number(await (await fetch(`${base}/blocks/tip/height`)).text()); };

    const infos: WalletAddressInfo[] = [];
    for (const c of walletChains(real)) {
      infos.push(...(await scanChain(real, c, counted, new AbortController().signal, false, gap, () => {})).infos);
    }
    const full = n;
    n = 0;
    const now = Date.now();
    const snap: WalletSnapshot = {
      v: SNAPSHOT_VERSION, scannedAt: now, fullScanAt: now, gapLimit: gap, tipHeight: await tip(),
      scriptType: real.scriptType, lastUsed: lastUsedIndex(infos), infos, traces: [], labels: [],
    };
    n = 0;
    await quickRefresh(snap, real, walletChains(real), counted, tip, { local: false });
    console.info(`[request harness, real] full scan: ${full} requests (gap ${gap}); quick refresh: ${n}`);
  }, 3_600_000);
});
