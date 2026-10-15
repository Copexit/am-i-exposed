"use client";

/**
 * Full backup: bookmarks, saved graphs and, when asked, saved wallet scans
 * and settings, as one version 2 file (sealed with a password by default).
 * Version 1 workspace files and older formats still import through
 * useBookmarks().importBookmarks.
 */

import { bookmarkStore, mergeBookmarks, mergeGraphs, walletsSkippedByLock, type Bookmark } from "./useBookmarks";
import { prepareWalletImport, vaultStore } from "./walletVault";
import { savedGraphStore } from "./useSavedGraphs";
import { validateSavedGraph, type SavedGraph } from "@/lib/graph/saved-graph-types";
import { exportSavedWallets, importSavedWallets, SavedWalletError, type SavedWalletEntry } from "@/lib/wallet/saved-wallets";
import { sanitizeAnalysisSettings, saveAnalysisSettings } from "@/lib/analysis/settings";
import { normalizeApiUrl } from "@/lib/api/normalize-api-url";
import { isSealedEnvelope, type SealedEnvelope } from "@/lib/crypto/envelope";

/**
 * localStorage keys carried in a backup. "Also restore settings" restores all
 * but the custom API URL, which has its own opt-in (it decides where every
 * lookup is sent).
 */
export const SETTINGS_KEYS = ["analysis-settings", "ami-theme", "ami-language", "ami-network", "ami-custom-api-url"] as const;

export interface BackupPayload {
  version: 2;
  createdAt: number;
  bookmarks: Bookmark[];
  graphs: SavedGraph[];
  savedWallets?: SavedWalletEntry[];
  settings?: Record<string, string>;
  /** The wallet key lock's vault, carried as is (it is already sealed). */
  walletVault?: SealedEnvelope;
}

export interface BackupOptions {
  includeWallets: boolean;
  includeSavedWallets: boolean;
  includeSettings: boolean;
  /** Restore only: write the file's custom API URL (never part of includeSettings) */
  includeCustomApi?: boolean;
}

const CUSTOM_API_KEY = "ami-custom-api-url";

/** The file's custom API URL, validated as the settings input does, or null. */
export function backupCustomApi(p: BackupPayload): string | null {
  const v = p.settings?.[CUSTOM_API_KEY];
  return v ? normalizeApiUrl(v) : null;
}

export async function buildBackup(opts: BackupOptions): Promise<BackupPayload> {
  const payload: BackupPayload = {
    version: 2,
    createdAt: Date.now(),
    bookmarks: bookmarkStore.getSnapshot().filter((b) => opts.includeWallets || b.type !== "wallet"),
    graphs: savedGraphStore.getSnapshot(),
  };
  const vault = vaultStore.getSnapshot();
  if (opts.includeWallets && vault) payload.walletVault = vault;
  if (opts.includeSavedWallets) {
    const saved = await exportSavedWallets();
    if (saved.length > 0) payload.savedWallets = saved;
  }
  if (opts.includeSettings) {
    const settings: Record<string, string> = {};
    for (const k of SETTINGS_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) settings[k] = v;
      } catch { /* private browsing */ }
    }
    payload.settings = settings;
  }
  return payload;
}

/** A version 2 backup, or null for anything else (v1 and legacy files go to importBookmarks). */
export function parseBackup(x: unknown): BackupPayload | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.version !== 2 || !Array.isArray(o.bookmarks) || !Array.isArray(o.graphs)) return null;
  const payload: BackupPayload = {
    version: 2,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    bookmarks: o.bookmarks as Bookmark[],
    graphs: o.graphs as SavedGraph[],
  };
  if (Array.isArray(o.savedWallets)) payload.savedWallets = o.savedWallets as SavedWalletEntry[];
  if (typeof o.settings === "object" && o.settings !== null && !Array.isArray(o.settings)) {
    payload.settings = Object.fromEntries(
      Object.entries(o.settings).filter((e): e is [string, string] => (SETTINGS_KEYS as readonly string[]).includes(e[0]) && typeof e[1] === "string"),
    );
  }
  if (isSealedEnvelope(o.walletVault)) payload.walletVault = o.walletVault;
  return payload;
}

/** What a backup holds, for the summary shown before anything is written. */
export function summarizeBackup(p: BackupPayload) {
  const wallets = p.bookmarks.filter((b) => (b as Partial<Bookmark> | null)?.type === "wallet").length;
  return {
    bookmarks: p.bookmarks.length - wallets,
    wallets,
    graphs: p.graphs.filter(validateSavedGraph).length,
    savedWallets: p.savedWallets?.length ?? 0,
    settings: Object.keys(p.settings ?? {}).filter((k) => k !== CUSTOM_API_KEY).length,
    customApiHost: ((u) => (u ? new URL(u).host : null))(backupCustomApi(p)),
  };
}

export interface RestoreResult {
  bookmarks: number;
  graphs: number;
  savedWallets: number;
  settings: number;
  /** Wallet bookmarks left out because of the wallet lock (see prepareWalletImport) */
  skippedWallets: number;
  error?: "storage_full";
}

/**
 * Merge a backup into this browser: bookmarks and graphs keep the newer
 * savedAt, saved wallets the later scan; wallet bookmarks, saved wallet data
 * and settings only when asked.
 */
export async function restoreBackup(p: BackupPayload, opts: BackupOptions): Promise<RestoreResult> {
  const out: RestoreResult = { bookmarks: 0, graphs: 0, savedWallets: 0, settings: 0, skippedWallets: 0 };
  const full = (): RestoreResult => ({ ...out, error: "storage_full" });

  // IndexedDB first: an unexpected failure there leaves nothing half written
  if (opts.includeSavedWallets && p.savedWallets) {
    try {
      out.savedWallets = await importSavedWallets(p.savedWallets);
    } catch (e) {
      if (e instanceof SavedWalletError) return full();
      throw e;
    }
  }

  // Wallet lock: the file's vault is adopted or merged first, so a placeholder never lands without its key
  let prep = { items: p.bookmarks as unknown[], acceptLocked: false, lockOn: false, dropped: 0 };
  if (opts.includeWallets) {
    const r = await prepareWalletImport(p.bookmarks, p.walletVault);
    if (!r) return full();
    prep = r;
  }
  const b = mergeBookmarks(prep.items, opts.includeWallets, prep.acceptLocked, prep.lockOn);
  if (b === null) return full();
  out.bookmarks = b;
  out.skippedWallets = prep.dropped + walletsSkippedByLock(prep.items, opts.includeWallets, prep.acceptLocked, prep.lockOn);
  const g = mergeGraphs(p.graphs);
  if (g === null) return full();
  out.graphs = g;

  const writes: [string, string][] = [];
  if (opts.includeSettings && p.settings) {
    for (const [k, v] of Object.entries(p.settings)) {
      if (k === "analysis-settings") {
        let parsed: unknown;
        try { parsed = JSON.parse(v); } catch { continue; }
        // Clamped and typed like the settings panel; saved through the module so open views pick it up at once
        saveAnalysisSettings(sanitizeAnalysisSettings(parsed));
        out.settings++;
      } else if (k !== CUSTOM_API_KEY && (SETTINGS_KEYS as readonly string[]).includes(k)) {
        writes.push([k, v]);
      }
    }
  }
  const api = opts.includeCustomApi ? backupCustomApi(p) : null;
  if (api) writes.push([CUSTOM_API_KEY, api]);
  for (const [k, v] of writes) {
    try { localStorage.setItem(k, v); } catch { return full(); }
    out.settings++;
  }
  return out;
}
