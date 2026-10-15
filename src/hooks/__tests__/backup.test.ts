// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { bookmarkStore, type Bookmark } from "@/hooks/useBookmarks";
import { savedGraphStore } from "@/hooks/useSavedGraphs";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";
import { clearSavedWallets, exportSavedWallets, saveSnapshot, walletKey, listSavedWallets, SNAPSHOT_VERSION } from "@/lib/wallet/saved-wallets";
import { getAnalysisSettings, saveAnalysisSettings, DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import { ZPUB, parsed } from "@/lib/wallet/__tests__/fake-chain";
import { buildBackup, parseBackup, restoreBackup, summarizeBackup } from "../backup";

const ALL = { includeWallets: true, includeSavedWallets: true, includeSettings: true };
const TXID = "a".repeat(64);
const BASE = "https://mempool.space/api";

const txBookmark = (savedAt: number, label?: string): Bookmark => ({ input: TXID, type: "txid", grade: "B", score: 70, savedAt, label });
const walletBookmark: Bookmark = { input: ZPUB, type: "wallet", grade: "C", score: 50, savedAt: 5, scriptType: "p2wpkh", network: "mainnet" };
const graph = (savedAt: number, name = "g"): SavedGraph => ({
  id: "g1", name, savedAt, network: "mainnet", rootTxid: TXID, rootTxids: [TXID], nodes: [{ txid: TXID, depth: 0 }],
});
const snap = (scannedAt: number) => ({
  v: SNAPSHOT_VERSION, scannedAt, fullScanAt: scannedAt, gapLimit: 20, tipHeight: 1, scriptType: "p2wpkh" as const,
  lastUsed: { 0: -1, 1: -1 }, infos: [], traces: [], labels: [],
});

beforeEach(async () => {
  localStorage.clear();
  bookmarkStore.remove();
  savedGraphStore.remove();
  saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS);
  await clearSavedWallets();
});

describe("full backup", () => {
  it("round trips bookmarks, graphs, saved wallets and settings", async () => {
    bookmarkStore.set([txBookmark(10, "rent"), walletBookmark]);
    savedGraphStore.set([graph(10)]);
    const key = walletKey(parsed, BASE);
    await saveSnapshot(key, ZPUB, BASE, snap(1000));
    saveAnalysisSettings({ ...DEFAULT_ANALYSIS_SETTINGS, maxDepth: 9 });
    localStorage.setItem("ami-theme", "light");

    const payload = parseBackup(JSON.parse(JSON.stringify(await buildBackup(ALL))));
    expect(payload).not.toBeNull();
    expect(summarizeBackup(payload!)).toEqual({ bookmarks: 1, wallets: 1, graphs: 1, savedWallets: 1, settings: 2 });

    localStorage.clear();
    bookmarkStore.remove();
    savedGraphStore.remove();
    saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS);
    await clearSavedWallets();

    const r = await restoreBackup(payload!, ALL);
    expect(r).toEqual({ bookmarks: 2, graphs: 1, savedWallets: 1, settings: 2 });
    expect(bookmarkStore.getSnapshot().map((b) => b.input).sort()).toEqual([TXID, ZPUB].sort());
    expect(savedGraphStore.getSnapshot()[0]!.id).toBe("g1");
    expect((await listSavedWallets())[0]!.key).toBe(key);
    expect(getAnalysisSettings().maxDepth).toBe(9);
    expect(localStorage.getItem("ami-theme")).toBe("light");
  });

  it("merges by the newer savedAt / scannedAt", async () => {
    bookmarkStore.set([txBookmark(10, "old")]);
    savedGraphStore.set([graph(30, "local newer")]);
    const key = walletKey(parsed, BASE);
    await saveSnapshot(key, ZPUB, BASE, snap(1000));
    const [entry] = await exportSavedWallets();
    await saveSnapshot(key, ZPUB, BASE, snap(2000));

    const r = await restoreBackup(
      { version: 2, createdAt: 0, bookmarks: [txBookmark(20, "new")], graphs: [graph(20, "file older")], savedWallets: [entry!] },
      ALL,
    );
    expect(r).toMatchObject({ bookmarks: 1, graphs: 0, savedWallets: 0 });
    expect(bookmarkStore.getSnapshot()[0]!.label).toBe("new");
    expect(savedGraphStore.getSnapshot()[0]!.name).toBe("local newer");
    expect((await listSavedWallets())[0]!.scannedAt).toBe(2000);
  });

  it("leaves wallet bookmarks, saved wallets and settings out unless asked", async () => {
    bookmarkStore.set([txBookmark(10), walletBookmark]);
    await saveSnapshot(walletKey(parsed, BASE), ZPUB, BASE, snap(1000));
    localStorage.setItem("ami-theme", "light");
    const none = { includeWallets: false, includeSavedWallets: false, includeSettings: false };
    const built = await buildBackup(none);
    expect(JSON.stringify(built)).not.toContain(ZPUB);
    expect(built.savedWallets).toBeUndefined();
    expect(built.settings).toBeUndefined();

    const full = await buildBackup(ALL);
    localStorage.clear();
    bookmarkStore.remove();
    await clearSavedWallets();
    const r = await restoreBackup(full, none);
    expect(r).toEqual({ bookmarks: 1, graphs: 0, savedWallets: 0, settings: 0 });
    expect(bookmarkStore.getSnapshot().some((b) => b.type === "wallet")).toBe(false);
    expect(await listSavedWallets()).toEqual([]);
    expect(localStorage.getItem("ami-theme")).toBeNull();
  });

  it("does not take v1 or legacy files (they go through importBookmarks)", () => {
    expect(parseBackup({ version: 1, bookmarks: [], graphs: [] })).toBeNull();
    expect(parseBackup([txBookmark(1)])).toBeNull();
  });

  it("ignores unknown settings keys", async () => {
    const r = await restoreBackup({ version: 2, createdAt: 0, bookmarks: [], graphs: [], settings: { "ami-theme": "dark", "other-key": "x" } }, ALL);
    expect(r.settings).toBe(1);
    expect(localStorage.getItem("other-key")).toBeNull();
  });
});
