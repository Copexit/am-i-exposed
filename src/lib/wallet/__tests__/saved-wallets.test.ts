import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { saveAnalysisSettings, DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import {
  walletKey, saveSnapshot, loadSnapshot, listSavedWallets, forgetWallet, clearSavedWallets,
  fullRescanReason, SNAPSHOT_VERSION, MAX_SNAPSHOT_BYTES, FULL_RESCAN_AFTER_MS, SavedWalletError, type WalletSnapshot,
} from "../saved-wallets";
import { FakeChain, ZPUB, parsed, addr } from "./fake-chain";

const BASE = "https://mempool.space/api";
const KEY = walletKey(parsed, BASE);

function snapshot(over: Partial<WalletSnapshot> = {}): WalletSnapshot {
  const chain = new FakeChain();
  const a = addr(0, 0);
  const tx = chain.tx([{ address: a, value: 10_000 }]);
  // The same tx listed under two addresses is stored once
  const infos: WalletAddressInfo[] = [
    { derived: { path: "0/0", address: a, isChange: false, index: 0 }, addressData: null, txs: [tx], utxos: [{ txid: tx.txid, vout: 0, value: 10_000, status: tx.status }] },
    { derived: { path: "1/0", address: addr(1, 0), isChange: true, index: 0 }, addressData: null, txs: [tx], utxos: [] },
  ];
  const now = Date.now();
  return {
    v: SNAPSHOT_VERSION, scannedAt: now, fullScanAt: now, gapLimit: 20, tipHeight: 1000, scriptType: "p2wpkh",
    lastUsed: { 0: 0, 1: 0 }, infos, traces: [],
    labels: [{ type: "xpub", ref: ZPUB, label: "Savings" }, { type: "xpub", ref: "xpub-of-another-wallet", label: "x" }, { type: "tx", ref: tx.txid, label: "rent" }],
    ...over,
  };
}

/** Every string stored in the wallet DB, raw. */
async function rawDump(): Promise<string> {
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("aie-wallets"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await Promise.all(["meta", "data"].map(s => new Promise<unknown[]>((res) => {
    const r = db.transaction(s).objectStore(s).getAll();
    r.onsuccess = () => res(r.result as unknown[]);
  })));
  db.close();
  return JSON.stringify(all);
}

beforeEach(async () => { await clearSavedWallets(); });
afterEach(() => { saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS); });

describe("saved wallets", () => {
  it("round-trips a snapshot", async () => {
    const s = snapshot();
    await saveSnapshot(KEY, ZPUB, BASE, s);
    const back = await loadSnapshot(KEY, ZPUB);
    expect(back).toEqual({ ...s, labels: [s.labels[0], s.labels[2]] });
    const [meta] = await listSavedWallets();
    expect(meta).toMatchObject({ key: KEY, scriptType: "p2wpkh", backend: `mainnet@${BASE}`, scannedAt: s.scannedAt });
    expect(meta!.size).toBeGreaterThan(0);
  });

  it("never stores the xpub: hashed key, placeholder for the wallet's own xpub label", async () => {
    expect(KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(walletKey({ ...parsed, scriptType: "p2tr" }, BASE)).not.toBe(KEY);
    expect(walletKey(parsed, "https://mempool.space/signet/api")).not.toBe(KEY);
    await saveSnapshot(KEY, ZPUB, BASE, snapshot());
    const raw = await rawDump();
    expect(raw).not.toContain(ZPUB);
    expect(raw).not.toContain(ZPUB.slice(4, 40));
    expect(raw).not.toContain("xpub-of-another-wallet");
  });

  it("saves and reads nothing while the cache setting is off", async () => {
    await saveSnapshot(KEY, ZPUB, BASE, snapshot());
    saveAnalysisSettings({ ...DEFAULT_ANALYSIS_SETTINGS, enableCache: false });
    expect(await loadSnapshot(KEY, ZPUB)).toBeNull();
    expect(await listSavedWallets()).toEqual([]);
    const other = walletKey({ ...parsed, scriptType: "p2tr" }, BASE);
    await saveSnapshot(other, ZPUB, BASE, snapshot());
    saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS);
    expect(await loadSnapshot(other, ZPUB)).toBeNull();
  });

  it("an older schema keeps its labels and asks for a full rescan", async () => {
    await saveSnapshot(KEY, ZPUB, BASE, snapshot());
    // Rewrite the stored row as a version-0 layout
    const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open("aie-wallets"); r.onsuccess = () => res(r.result); });
    await new Promise<void>((res) => {
      const tx = db.transaction("data", "readwrite");
      tx.objectStore("data").put({ key: KEY, json: JSON.stringify({ v: 0, addrs: [], labels: [{ type: "xpub", ref: "@this-wallet", label: "Savings" }] }) });
      tx.oncomplete = () => res();
    });
    db.close();
    const old = (await loadSnapshot(KEY, ZPUB))!;
    expect(old.v).toBe(0);
    expect(old.labels).toEqual([{ type: "xpub", ref: ZPUB, label: "Savings" }]);
    expect(fullRescanReason(old, 20)).toBe("schema");
  });

  it("full rescan after 7 days or when the gap limit grows", () => {
    const s = snapshot();
    expect(fullRescanReason(s, 20)).toBeNull();
    expect(fullRescanReason(s, 300)).toBe("gap");
    expect(fullRescanReason({ ...s, fullScanAt: Date.now() - FULL_RESCAN_AFTER_MS - 1 }, 20)).toBe("age");
    // A quick refresh moves scannedAt, not fullScanAt
    expect(fullRescanReason({ ...s, scannedAt: Date.now(), fullScanAt: Date.now() - 8 * 86_400_000 }, 20)).toBe("age");
  });

  it("drops graph traces over the size cap, then refuses with a clear error", async () => {
    const big = "x".repeat(MAX_SNAPSHOT_BYTES);
    const s = snapshot();
    const trace = { tx: s.infos[0]!.txs[0]!, backward: [], forward: [], outspends: [], pad: big };
    await saveSnapshot(KEY, ZPUB, BASE, { ...s, traces: [["t", trace]] });
    expect((await loadSnapshot(KEY, ZPUB))!.traces).toEqual([]);
    const err = await saveSnapshot(KEY, ZPUB, BASE, { ...s, labels: [{ type: "tx", ref: "a", label: big }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SavedWalletError);
    expect((err as SavedWalletError).code).toBe("tooLarge");
  }, 30_000);

  it("forget removes one wallet, clear removes all", async () => {
    const other = walletKey({ ...parsed, scriptType: "p2tr" }, BASE);
    await saveSnapshot(KEY, ZPUB, BASE, snapshot());
    await saveSnapshot(other, ZPUB, BASE, snapshot());
    await forgetWallet(KEY);
    expect(await loadSnapshot(KEY, ZPUB)).toBeNull();
    expect((await listSavedWallets()).map(m => m.key)).toEqual([other]);
    await clearSavedWallets();
    expect(await listSavedWallets()).toEqual([]);
  });
});
