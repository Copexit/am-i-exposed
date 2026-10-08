/**
 * Saved wallet scans: one schema-versioned snapshot per wallet in IndexedDB,
 * so reopening a wallet renders at once and only a quick refresh hits the API.
 *
 * DB "aie-wallets" (separate from the "aie-cache" response cache, cleared with it):
 * - "meta": small records for the settings list (no addresses, no txs)
 * - "data": the snapshot as a JSON string (its length is the size counted against the caps)
 *
 * The key is a SHA-256 of key + script type + chain + backend, and the raw
 * xpub is never written: a BIP329 "xpub" label for this wallet is stored with
 * a placeholder ref, labels of other xpubs are dropped. Nothing is saved or
 * read while the "Persist cache across sessions" setting is off.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ParsedXpub, ScriptType, DerivedAddress } from "@/lib/bitcoin/descriptor";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolAddress, MempoolTransaction, MempoolUtxo } from "@/lib/api/types";
import type { UtxoTraceResult } from "@/lib/wallet/scan";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { Bip329Record } from "@/lib/wallet/bip329";
import { cacheKeyPrefix } from "@/lib/api/cache-policy";
import { getAnalysisSettings } from "@/lib/analysis/settings";

/** Bump when the snapshot layout changes: older snapshots trigger a full rescan (labels are kept). */
export const SNAPSHOT_VERSION = 1;
/** One wallet larger than this is not saved (graph traces are dropped first). */
export const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
/** All saved wallets together: the least recently scanned are dropped past this. */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** A quick refresh cannot see a payment to an old address: a full walk runs at least this often. */
export const FULL_RESCAN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const DB_NAME = "aie-wallets";
const DB_VERSION = 1;
const SELF_XPUB = "@this-wallet";

/** Everything needed to rebuild the results without the network. */
export interface WalletSnapshot {
  v: number;
  /** Last scan or refresh (ms) */
  scannedAt: number;
  /** Last complete gap-limit walk (ms): drives the weekly full rescan */
  fullScanAt: number;
  gapLimit: number;
  tipHeight: number | null;
  scriptType: ScriptType;
  /** Highest used index per chain (-1 = none) */
  lastUsed: { 0: number; 1: number };
  /** A complete scan: a partial one (failed addresses) is never saved */
  infos: WalletAddressInfo[];
  traces: [string, UtxoTraceResult][];
  labels: Bip329Record[];
}

/** Settings list entry. */
export interface SavedWalletMeta {
  key: string;
  scriptType: ScriptType;
  /** cacheKeyPrefix of the backend, e.g. "signet@https://mempool.space/signet/api" */
  backend: string;
  scannedAt: number;
  size: number;
}

/** A trace layer's Map as a plain array (JSON drops Maps). */
type StoredLayer = { depth: number; txs: MempoolTransaction[] };
type StoredTrace = Omit<UtxoTraceResult, "backward" | "forward"> & { backward: StoredLayer[]; forward: StoredLayer[] };

/** Stored layout: each tx once, addresses refer to it by txid. */
interface StoredSnapshot extends Omit<WalletSnapshot, "infos" | "traces"> {
  addresses: { derived: DerivedAddress; addressData: MempoolAddress | null; utxos: MempoolUtxo[]; txids: string[] }[];
  txs: Record<string, MempoolTransaction>;
  traces: [string, StoredTrace][];
}

const layersOut = (ls: TraceLayer[]): StoredLayer[] => ls.map(l => ({ depth: l.depth, txs: [...l.txs.values()] }));
const layersIn = (ls: StoredLayer[]): TraceLayer[] => ls.map(l => ({ depth: l.depth, txs: new Map(l.txs.map(t => [t.txid, t])) }));

export class SavedWalletError extends Error {
  constructor(public code: "tooLarge" | "quota", public size = 0) {
    super(code === "tooLarge" ? `Wallet snapshot too large (${size} bytes)` : "Browser storage is full");
    this.name = "SavedWalletError";
  }
}

/** Hex SHA-256 identifying a wallet on one backend. Never contains the key itself. */
export function walletKey(parsed: Pick<ParsedXpub, "xpub" | "scriptType" | "singleChain">, baseUrl: string): string {
  const id = [parsed.xpub, parsed.scriptType, parsed.singleChain ?? "*", cacheKeyPrefix(baseUrl)].join("|");
  return bytesToHex(sha256(new TextEncoder().encode(id)));
}

/** Highest used index per chain. */
export function lastUsedIndex(infos: readonly WalletAddressInfo[]): { 0: number; 1: number } {
  const out = { 0: -1, 1: -1 };
  for (const i of infos) {
    const s = i.addressData;
    const used = i.txs.length > 0 || (!!s && s.chain_stats.tx_count + s.mempool_stats.tx_count > 0);
    const c = i.derived.isChange ? 1 : 0;
    if (used && i.derived.index > out[c]) out[c] = i.derived.index;
  }
  return out;
}

function toStored(s: WalletSnapshot, xpub: string): StoredSnapshot {
  const txs: Record<string, MempoolTransaction> = {};
  const addresses = s.infos.map(({ derived, addressData, utxos, txs: list }) => {
    for (const tx of list) txs[tx.txid] = tx;
    return { derived, addressData, utxos, txids: list.map(t => t.txid) };
  });
  const labels = s.labels.flatMap(r => r.type !== "xpub" ? [r] : r.ref === xpub ? [{ ...r, ref: SELF_XPUB }] : []);
  const { infos: _infos, ...rest } = s;
  const traces = s.traces.map(([id, t]): [string, StoredTrace] => [id, { ...t, backward: layersOut(t.backward), forward: layersOut(t.forward) }]);
  return { ...rest, labels, addresses, txs, traces };
}

function fromStored(s: StoredSnapshot, xpub: string): WalletSnapshot {
  const { addresses, txs, ...rest } = s;
  return {
    ...rest,
    infos: addresses.map(a => ({
      derived: a.derived,
      addressData: a.addressData,
      utxos: a.utxos,
      txs: a.txids.flatMap(id => txs[id] ? [txs[id]] : []),
    })),
    traces: s.traces.map(([id, t]): [string, UtxoTraceResult] => [id, { ...t, backward: layersIn(t.backward), forward: layersIn(t.forward) }]),
    labels: s.labels.map(r => r.type === "xpub" && r.ref === SELF_XPUB ? { ...r, ref: xpub } : r),
  };
}

/**
 * Bring an older snapshot forward. No migration exists yet: an unknown version
 * keeps only its labels and is marked stale, so the caller runs a full rescan.
 */
export function migrate(raw: unknown, xpub: string): WalletSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredSnapshot>;
  if (r.v === SNAPSHOT_VERSION) return fromStored(r as StoredSnapshot, xpub);
  const labels = Array.isArray(r.labels) ? r.labels.map(l => l.type === "xpub" && l.ref === SELF_XPUB ? { ...l, ref: xpub } : l) : [];
  return {
    v: typeof r.v === "number" ? r.v : 0, scannedAt: 0, fullScanAt: 0, gapLimit: 0, tipHeight: null,
    scriptType: r.scriptType ?? "p2wpkh", lastUsed: { 0: -1, 1: -1 }, infos: [], traces: [], labels,
  };
}

/** Why the saved scan cannot be quick-refreshed, or null. */
export function fullRescanReason(s: WalletSnapshot, gapLimit: number, now = Date.now()): "schema" | "age" | "gap" | null {
  if (s.v !== SNAPSHOT_VERSION) return "schema";
  if (now - s.fullScanAt > FULL_RESCAN_AFTER_MS) return "age";
  if (gapLimit > s.gapLimit) return "gap";
  return null;
}

// ---------- IndexedDB ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function enabled(): boolean {
  return getAnalysisSettings().enableCache && typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("data")) db.createObjectStore("data", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/** Saved wallets, most recently scanned first. */
export async function listSavedWallets(): Promise<SavedWalletMeta[]> {
  if (!enabled()) return [];
  try {
    const all = await run<SavedWalletMeta[]>(["meta"], "readonly", tx => tx.objectStore("meta").getAll());
    return all.sort((a, b) => b.scannedAt - a.scannedAt);
  } catch {
    return [];
  }
}

export async function loadSnapshot(key: string, xpub: string): Promise<WalletSnapshot | null> {
  if (!enabled()) return null;
  try {
    const row = await run<{ key: string; json: string } | undefined>(["data"], "readonly", tx => tx.objectStore("data").get(key));
    return row ? migrate(JSON.parse(row.json), xpub) : null;
  } catch {
    return null;
  }
}

/**
 * Save (replace) a wallet's snapshot. Drops graph traces when over the
 * per-wallet cap, then evicts the least recently scanned wallets to stay under
 * the total cap. Throws SavedWalletError when it still cannot be stored.
 */
export async function saveSnapshot(key: string, xpub: string, backend: string, snap: WalletSnapshot): Promise<void> {
  if (!enabled()) return;
  let json = JSON.stringify(toStored(snap, xpub));
  if (json.length > MAX_SNAPSHOT_BYTES && snap.traces.length > 0) json = JSON.stringify(toStored({ ...snap, traces: [] }, xpub));
  if (json.length > MAX_SNAPSHOT_BYTES) throw new SavedWalletError("tooLarge", json.length);

  const meta: SavedWalletMeta = { key, scriptType: snap.scriptType, backend: cacheKeyPrefix(backend), scannedAt: snap.scannedAt, size: json.length };
  const others = (await listSavedWallets()).filter(m => m.key !== key);
  let total = json.length + others.reduce((n, m) => n + m.size, 0);
  const evict: string[] = [];
  // ponytail: evicts by last scan, not last open; a per-open timestamp if users notice
  for (const m of [...others].reverse()) {
    if (total <= MAX_TOTAL_BYTES) break;
    evict.push(m.key);
    total -= m.size;
  }
  try {
    await run(["meta", "data"], "readwrite", tx => {
      for (const k of evict) { tx.objectStore("meta").delete(k); tx.objectStore("data").delete(k); }
      tx.objectStore("meta").put(meta);
      tx.objectStore("data").put({ key, json });
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") throw new SavedWalletError("quota", json.length);
    throw e;
  }
}

/** "Forget this wallet". */
export async function forgetWallet(key: string): Promise<void> {
  try {
    await run(["meta", "data"], "readwrite", tx => { tx.objectStore("meta").delete(key); tx.objectStore("data").delete(key); });
  } catch {
    // Nothing stored
  }
}

/** Delete every saved wallet (the whole database, no empty shell left). */
export async function clearSavedWallets(): Promise<void> {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* never opened */ }
    dbPromise = null;
  }
  if (typeof indexedDB === "undefined" || indexedDB === null) return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
