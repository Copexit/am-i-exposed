"use client";

/**
 * Wallet key lock, bookmark side: moves wallet bookmark keys into the sealed
 * vault (`ami-wallet-vault`) and back, and holds this tab's unlocked copy.
 *
 * The unlocked state is module memory only: a reload locks again. While
 * unlocked the password is kept in memory too (never stored), because saving
 * a wallet re-seals the vault. The state is tied to the stored vault it opened:
 * when another tab rewrites the vault, this tab counts as locked again.
 */

import { useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { bookmarkStore, isValidBookmark, matchesInput, type Bookmark } from "./useBookmarks";
import { VAULT_KEY, isLockOn, openVault, parseVault, placeholderFor, sealVault, type VaultEntries } from "@/lib/backup/wallet-vault";
import type { SealedEnvelope } from "@/lib/crypto/envelope";

export const vaultStore = createLocalStorageStore<SealedEnvelope | null>(VAULT_KEY, null, parseVault);

interface Unlocked { password: string; entries: VaultEntries; raw: string }
let mem: Unlocked | null = null;
const listeners = new Set<() => void>();
const setMem = (m: Unlocked | null) => { mem = m; listeners.forEach((l) => l()); };
const subscribeMem = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const rawOf = (v: SealedEnvelope | null) => (v ? JSON.stringify(v) : "");
const current = (): Unlocked | null => (mem && mem.raw === rawOf(vaultStore.getSnapshot()) ? mem : null);

export const isUnlocked = () => current() !== null;
export const lockNow = () => setMem(null);

/** The key to scan for a bookmark, or null while its wallet is locked. Never returns a placeholder. */
export function resolveBookmarkInput(b: Bookmark): string | null {
  return b.locked === true ? current()?.entries[b.input] ?? null : b.input;
}

/** Seal `entries` (pruned to the locked bookmarks of `list` plus `keep`) as the vault. */
async function writeVault(password: string, entries: VaultEntries, list: Bookmark[], keep: VaultEntries = {}): Promise<boolean> {
  const used = new Set(list.filter((b) => b.locked === true).map((b) => b.input).concat(Object.keys(keep)));
  const pruned = Object.fromEntries(Object.entries(entries).filter(([k]) => used.has(k)));
  const env = await sealVault(pruned, password);
  if (!vaultStore.set(env)) return false;
  setMem({ password, entries: pruned, raw: rawOf(env) });
  return true;
}

/** Plain wallet entries of `list` swapped for placeholders, and their keys. */
function lockWallets(list: Bookmark[]): { list: Bookmark[]; extra: VaultEntries } {
  const extra: VaultEntries = {};
  const byInput = new Map<string, Bookmark>();
  for (const b of list) {
    let e = b;
    if (b.type === "wallet" && b.locked !== true) {
      const ph = placeholderFor(b.input);
      extra[ph] = b.input;
      e = { ...b, input: ph, locked: true };
    }
    const cur = byInput.get(e.input);
    if (!cur || e.savedAt > cur.savedAt) byInput.set(e.input, e);
  }
  return { list: [...byInput.values()].sort((a, b) => b.savedAt - a.savedAt), extra };
}

/** Vault first, then bookmarks: a placeholder in storage always has its key sealed. */
async function sealInto(password: string, entries: VaultEntries, list: Bookmark[]): Promise<boolean> {
  const locked = lockWallets(list);
  if (!(await writeVault(password, { ...entries, ...locked.extra }, locked.list))) return false;
  return Object.keys(locked.extra).length === 0 || bookmarkStore.set(locked.list);
}

/** Turn the lock on: every wallet bookmark's key moves into a new vault. Leaves this tab unlocked. */
export async function enableLock(password: string): Promise<boolean> {
  if (await sealInto(password, {}, bookmarkStore.getSnapshot())) return true;
  vaultStore.remove();
  setMem(null);
  return false;
}

/** Open the vault (throws WrongPasswordError), then lock any wallet stored in clear meanwhile and drop keys no bookmark uses. */
export async function unlock(password: string): Promise<void> {
  const env = vaultStore.getSnapshot();
  if (!env) return;
  const entries = await openVault(env, password);
  setMem({ password, entries, raw: rawOf(env) });
  const list = bookmarkStore.getSnapshot();
  const needed = list.some((b) => b.type === "wallet" && b.locked !== true) ||
    Object.keys(entries).some((k) => !list.some((b) => b.input === k));
  if (needed) await sealInto(password, entries, list);
}

/** Turn the lock off (throws WrongPasswordError): keys go back into the bookmarks, the vault is deleted. */
export async function disableLock(password: string): Promise<boolean> {
  const env = vaultStore.getSnapshot();
  if (!env) return true;
  const entries = await openVault(env, password);
  const byInput = new Map<string, Bookmark>();
  for (const b of bookmarkStore.getSnapshot()) {
    let e: Bookmark | null = b;
    if (b.locked === true) {
      const input = entries[b.input];
      if (input === undefined) e = null; // no key: it could never be opened
      else {
        const { locked: _locked, ...rest } = b;
        e = { ...rest, input };
      }
    }
    const cur = e && byInput.get(e.input);
    if (e && (!cur || e.savedAt > cur.savedAt)) byInput.set(e.input, e);
  }
  if (!bookmarkStore.set([...byInput.values()].sort((a, b) => b.savedAt - a.savedAt))) return false;
  vaultStore.remove();
  setMem(null);
  return true;
}

/** "Forgot password": delete the vault and every locked wallet bookmark. */
export function forgetLockedWallets(): void {
  bookmarkStore.set(bookmarkStore.getSnapshot().filter((b) => b.locked !== true));
  vaultStore.remove();
  setMem(null);
}

/**
 * Save a wallet bookmark: in clear while the lock is off, into the vault while
 * it is on and unlocked. Returns "locked" (nothing written) when it needs unlocking first.
 */
export async function saveWalletBookmark(bookmark: Omit<Bookmark, "savedAt">): Promise<"ok" | "locked" | "failed"> {
  const list = [{ ...bookmark, savedAt: Date.now() }, ...bookmarkStore.getSnapshot().filter((b) => !matchesInput(b, bookmark.input))];
  if (!isLockOn()) return bookmarkStore.set(list) ? "ok" : "failed";
  const u = current();
  if (!u) return "locked";
  return (await sealInto(u.password, u.entries, list)) ? "ok" : "failed";
}

/**
 * Restore side: what to merge from a backup's bookmarks under the wallet lock.
 * - Lock off: the file's vault is adopted as is (its locked wallets come with it).
 * - Lock on and unlocked here: the file's wallets are sealed into this vault (its
 *   locked ones only when this password opens the file's vault too).
 * - Lock on and locked: only locked wallets of this very vault are taken.
 * Returns null when storage is full.
 */
export async function prepareWalletImport(items: unknown[], fileVault?: SealedEnvelope): Promise<
  { items: unknown[]; acceptLocked: boolean; lockOn: boolean; dropped: number } | null
> {
  const isLocked = (b: unknown): b is Bookmark => isValidBookmark(b) && b.type === "wallet" && b.locked === true;
  const hasLocked = items.some(isLocked);
  if (!isLockOn()) {
    if (!fileVault || !hasLocked) return { items, acceptLocked: false, lockOn: false, dropped: 0 };
    return vaultStore.set(fileVault) ? { items, acceptLocked: true, lockOn: false, dropped: 0 } : null;
  }
  const same = !!fileVault && rawOf(fileVault) === rawOf(vaultStore.getSnapshot());
  const u = current();
  if (!u) return { items, acceptLocked: same, lockOn: true, dropped: 0 };

  let fileEntries: VaultEntries = {};
  if (fileVault && hasLocked && !same) {
    try { fileEntries = await openVault(fileVault, u.password); } catch { /* another password: its locked wallets are skipped */ }
  }
  const extra: VaultEntries = {};
  let dropped = 0;
  const out = items.flatMap((b): unknown[] => {
    if (!isValidBookmark(b) || b.type !== "wallet") return [b];
    if (b.locked === true) {
      const key = fileEntries[b.input] ?? u.entries[b.input];
      if (key === undefined) { dropped++; return []; }
      extra[b.input] = key;
      return [b];
    }
    const ph = placeholderFor(b.input);
    extra[ph] = b.input;
    return [{ ...b, input: ph, locked: true }];
  });
  if (Object.keys(extra).length > 0 && !(await writeVault(u.password, { ...u.entries, ...extra }, bookmarkStore.getSnapshot(), extra))) return null;
  return { items: out, acceptLocked: true, lockOn: true, dropped };
}

/** Lock status for the UI: on = a vault is stored, unlocked = opened in this tab. */
export function useWalletLock(): { on: boolean; unlocked: boolean } {
  const env = useSyncExternalStore(vaultStore.subscribe, vaultStore.getSnapshot, vaultStore.getServerSnapshot);
  const m = useSyncExternalStore(subscribeMem, () => mem, () => null);
  return { on: env !== null, unlocked: m !== null && m.raw === rawOf(env) };
}
