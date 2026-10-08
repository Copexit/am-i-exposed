import { describe, it, expect } from "vitest";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { ScriptType } from "@/lib/bitcoin/descriptor";
import { scanChain } from "../scan";
import { quickRefresh, verifyCoins, extendFrontier, newTxids, REFRESH_WINDOW } from "../refresh";
import { auditWallet } from "@/lib/analysis/wallet-audit";
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

/** Phase 1 only. */
async function refresh(chain: FakeChain, snap: WalletSnapshot) {
  chain.requests = {};
  const r = await quickRefresh(snap, parsed, [0, 1], chain.client(), () => chain.getTipHeight(), { local: true });
  return { ...r, newTxids: newTxids(snap.infos, r.infos) };
}

/** Both phases, with request counts per phase. */
async function refreshAll(chain: FakeChain, snap: WalletSnapshot) {
  const r = await refresh(chain, snap);
  const phase1 = chain.total;
  chain.requests = {};
  const progress: number[] = [];
  const verified = await verifyCoins(r.infos, r.pending, chain.client(), { local: true }, (done) => progress.push(done));
  const infos = await extendFrontier(verified, parsed, r.frontier, snap.gapLimit, chain.client(), { local: true });
  return { ...r, infos, newTxids: newTxids(snap.infos, infos), phase1, phase2: chain.total, phase2Requests: chain.requests, progress };
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
  it("no activity: phase 1 is tip + a window per chain, phase 2 one request per coin address", async () => {
    const { chain, snap } = await smallWallet();
    const r = await refresh(chain, snap);
    expect(r.newTxids).toEqual([]);
    expect(chain.requests).toEqual({ tip: 1, getAddress: 2 * REFRESH_WINDOW });
    // Coins: 0/2, 0/3, 0/4 and the change 1/0, none verified yet
    expect(r.pending).toHaveLength(4);
    expect(r.coins).toBe(4);
    const all = await refreshAll(chain, snap);
    expect(view(all.infos)).toEqual(view(snap.infos));
    expect(all.phase2Requests).toEqual({ getAddressUtxos: 4 });
    expect(all.progress.sort()).toEqual([1, 2, 3, 4]);
  });

  it("finds a receive past the frontier and keeps extending the window", async () => {
    const { chain, snap } = await smallWallet();
    const a = chain.tx([{ address: addr(0, 9), value: 7_000 }]);
    const b = chain.tx([{ address: addr(0, 9 + REFRESH_WINDOW), value: 8_000 }]);
    const r = await refreshAll(chain, snap);
    expect(r.newTxids.sort()).toEqual([a.txid, b.txid].sort());
    expect(view(r.infos)).toEqual(view(await fullScan(chain, 30)));
    expect(lastUsedIndex(r.infos)[0]).toBe(9 + REFRESH_WINDOW);
  });

  it("phase 1: a spend with change past the frontier marks the saved coin spent at once", async () => {
    const { chain, snap, funding } = await smallWallet();
    const spend = chain.tx([{ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", value: 90_000 }, { address: addr(1, 1), value: 12_000 }],
      [{ txid: funding[2]!.txid, vout: 0 }]);
    const r = await refresh(chain, snap);
    expect(r.newTxids).toEqual([spend.txid]);
    const spent = r.infos.find(i => i.derived.path === "0/2")!;
    expect(spent.utxos).toEqual([]);
    expect(spent.txs.map(t => t.txid)).toContain(spend.txid);
    expect(r.pending.map(c => c.txid)).not.toContain(funding[2]!.txid);
    expect(view(r.infos)).toEqual(view(await fullScan(chain, 20)));
  });

  it("phase 2: a spend with no wallet output is found by verifying the coins", async () => {
    const { chain, snap, funding } = await smallWallet();
    const sweep = chain.tx([{ address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", value: 99_000 }], [{ txid: funding[3]!.txid, vout: 0 }]);
    expect((await refresh(chain, snap)).newTxids).toEqual([]);
    const r = await refreshAll(chain, snap);
    expect(r.newTxids).toEqual([sweep.txid]);
    expect(r.infos.find(i => i.derived.path === "0/3")!.utxos).toEqual([]);
    expect(view(r.infos)).toEqual(view(await fullScan(chain, 20)));
  });

  it("phase 2 stops when cancelled", async () => {
    const { chain, snap } = await smallWallet();
    const r = await refresh(chain, snap);
    chain.requests = {};
    const ctl = new AbortController();
    ctl.abort();
    await expect(verifyCoins(r.infos, r.pending, chain.client(), { local: true, signal: ctl.signal }, () => {})).rejects.toThrow(/Abort/);
    expect(chain.total).toBe(0);
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
    const idle = await refreshAll(chain, snap);
    expect(idle.newTxids).toEqual([]);
    // Phase 1: 1 tip + 2 x 20 frontier addresses; phase 2: one UTXO list per coin address
    expect(idle.phase1).toBe(1 + 2 * REFRESH_WINDOW);
    expect(idle.phase2).toBe(150);

    chain.tx([{ address: addr(0, 200), value: 1_000 }]);
    const active = await refreshAll(chain, snap);
    expect(active.newTxids).toHaveLength(1);
    // + 3 calls for the new address, + 1 more frontier address
    expect(active.phase1).toBe(idle.phase1 + 3 + 1);

    console.info(`[request harness] full scan: ${full} requests; quick refresh phase 1: ${idle.phase1} (idle), ${active.phase1} (one new payment); phase 2: ${idle.phase2} (idle), ${active.phase2} (one new payment: the walk goes on to the saved gap)`);
  }, 60_000);
});

// Optional: the same comparison on a real signet wallet. Never hardcode a key here:
// AIE_HARNESS_XPUB=tpub... [AIE_HARNESS_TYPE=p2wpkh] [AIE_HARNESS_API=https://mempool.space/signet/api] [AIE_HARNESS_GAP=20] pnpm vitest run refresh
const REAL_XPUB = process.env.AIE_HARNESS_XPUB;
describe.skipIf(!REAL_XPUB)("request counts on a real wallet (AIE_HARNESS_XPUB)", () => {
  it("counts requests", async () => {
    const { parseXpub } = await import("@/lib/bitcoin/descriptor");
    const { createMempoolClient } = await import("@/lib/api/mempool");
    const { walletChains } = await import("../scan");
    // A bare xpub/tpub reads as legacy: AIE_HARNESS_TYPE=p2wpkh (or a descriptor) sets the address type
    const real = parseXpub(REAL_XPUB!, process.env.AIE_HARNESS_TYPE as ScriptType | undefined);
    const base = process.env.AIE_HARNESS_API ?? "https://mempool.space/signet/api";
    const gap = Number(process.env.AIE_HARNESS_GAP ?? 20);
    const inner = createMempoolClient(base);
    let n = 0;
    const counted = Object.fromEntries(Object.entries(inner).map(([k, f]) =>
      [k, (...a: unknown[]) => { n++; return (f as (...x: unknown[]) => unknown)(...a); }])) as typeof inner;
    const tip = async () => { n++; return Number(await (await fetch(`${base}/blocks/tip/height`)).text()); };

    const infos: WalletAddressInfo[] = [];
    const t0 = Date.now();
    for (const c of walletChains(real)) {
      infos.push(...(await scanChain(real, c, counted, new AbortController().signal, false, gap, () => {})).infos);
    }
    const full = n;
    const fullMs = Date.now() - t0;
    n = 0;
    const now = Date.now();
    const snap: WalletSnapshot = {
      v: SNAPSHOT_VERSION, scannedAt: now, fullScanAt: now, gapLimit: gap, tipHeight: await tip(),
      scriptType: real.scriptType, lastUsed: lastUsedIndex(infos), infos, traces: [], labels: [],
    };
    n = 0;
    let t = Date.now();
    const r = await quickRefresh(snap, real, walletChains(real), counted, tip, { local: false });
    const p1 = n, p1ms = Date.now() - t;
    n = 0;
    t = Date.now();
    await verifyCoins(r.infos, r.pending, counted, { local: false }, () => {});
    console.info(`[request harness, real] full scan: ${full} requests in ${(fullMs / 1000).toFixed(1)} s (gap ${gap}); `
      + `quick refresh phase 1: ${p1} requests in ${(p1ms / 1000).toFixed(1)} s; phase 2: ${n} requests in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }, 4 * 3_600_000);
});

describe("quick refresh equals a full scan", () => {
  /** Deterministic PRNG (mulberry32). */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const EXT = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

  it.each([1, 2, 3])("random history, seed %i", async (seed) => {
    const rand = rng(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const GAP = 30;
    const chain = new FakeChain();
    let nextChange = 0;
    const coins = () => [...chain.txs.values()].flatMap(t => t.vout.flatMap((o, vout) =>
      o.scriptpubkey_address?.startsWith("bc1q") && o.scriptpubkey_address !== EXT && !chain.outspends.get(t.txid)![vout]!.spent ? [{ txid: t.txid, vout }] : []));
    const spend = (withChange: boolean, confirmed = true) => {
      const c = pick(coins());
      const outs = [{ address: EXT, value: 1_000 }, ...(withChange ? [{ address: addr(1, nextChange++), value: 900 }] : [])];
      return chain.tx(outs, [c], confirmed);
    };

    // History: receives on 0..15 with gaps, a few spends
    for (let i = 0; i < 12; i++) chain.tx([{ address: addr(0, Math.floor(rand() * 16)), value: 10_000 + i }]);
    for (let i = 0; i < 4; i++) spend(rand() < 0.7);
    chain.mine(50);
    const shallow = chain.tx([{ address: addr(0, 3), value: 4_242 }]);
    const pending = chain.tx([{ address: addr(0, 4), value: 5_151 }], [], false);
    const before = await fullScan(chain, GAP);
    const snap = snapshotOf(chain, before, GAP);
    const last = snap.lastUsed[0];

    // Activity since the snapshot
    chain.mine();
    chain.confirm(shallow.txid, chain.tip);        // reorg: re-mined one block later
    chain.confirm(pending.txid);                    // confirmation
    chain.tx([{ address: addr(0, last + 3), value: 3_000 }]);          // past the frontier
    chain.tx([{ address: addr(0, last + 3 + 25), value: 3_100 }]);     // within the gap of the new one
    const gapIdx = before.find(i => !i.derived.isChange && i.txs.length === 0 && i.derived.index < last)?.derived.index;
    if (gapIdx !== undefined) chain.tx([{ address: addr(0, gapIdx), value: 3_200 }]); // a late invoice payment
    const holder = before.find(i => i.utxos.length > 0)!;
    chain.tx([{ address: holder.derived.address, value: 3_300 }]);    // reuse of a coin-holding address
    spend(true);                                    // spend with change
    spend(false);                                   // sweep, no wallet output
    spend(true, false);                             // unconfirmed spend

    const refreshed = (await refreshAll(chain, snap)).infos;
    const full = await fullScan(chain, GAP);
    expect(refreshed).toEqual(full);
    expect(auditWallet(refreshed)).toEqual(auditWallet(full));
  });
});

