"use client";

/**
 * Wallet key lock, bookmark side: moves wallet bookmark keys into the sealed
 * vault (`ami-wallet-vault`) and back, and holds this tab's unlocked copy.
 *
 * The unlocked state is module memory only: a reload locks again. It holds
 * the derived non-extractable AES key (never the password), so a save re-seals
 * without PBKDF2. The state is tied to the stored vault it opened: when another
 * tab rewrites the vault, this tab counts as locked again.
 *
 * Every write is a compare-and-swap: after the (async) seal, the vault and the
 * bookmarks must still be what the write was computed from, else it is redone
 * from the fresh state. No write ever stores a locked bookmark without its key.
 */

import { useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./createLocalStorageStore";
import { bookmarkStore, isValidBookmark, matchesInput, type Bookmark } from "./useBookmarks";
import {
  VAULT_KEY, isLockOn, newVaultKey, openVault, openVaultWithKey, parseVault, placeholderFor, sealVault, type VaultEntries,
} from "@/lib/backup/wallet-vault";
import type { SealedEnvelope, SealKey } from "@/lib/crypto/envelope";

export const vaultStore = createLocalStorageStore<SealedEnvelope | null>(VAULT_KEY, null, parseVault);

interface Unlocked { sealKey: SealKey; entries: VaultEntries; raw: string }
let mem: Unlocked | null = null;
const listeners = new Set<() => void>();
const setMem = (m: Unlocked | null) => { mem = m; listeners.forEach((l) => l()); };
const subscribeMem = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const rawOf = (v: SealedEnvelope | null) => (v ? JSON.stringify(v) : "");
const vaultRaw = () => rawOf(vaultStore.getSnapshot());
const current = (): Unlocked | null => (mem && mem.raw === vaultRaw() ? mem : null);

export const isUnlocked = () => current() !== null;
export const lockNow = () => setMem(null);

/** The key to scan for a bookmark, or null while its wallet is locked. Never returns a placeholder. */
export function resolveBookmarkInput(b: Bookmark): string | null {
  return b.locked === true ? current()?.entries[b.input] ?? null : b.input;
}

/** The key behind a placeholder (from a `#xpub=` hash), or null while locked or unknown. */
export const resolvePlaceholder = (ph: string): string | null => current()?.entries[ph] ?? null;

/** The placeholder to show in the URL for `input` when it is a locked bookmark, else null. */
export function lockedPlaceholder(input: string): string | null {
  const ph = placeholderFor(input);
  return bookmarkStore.getSnapshot().some((b) => b.locked === true && b.input === ph) ? ph : null;
}

type Result = "ok" | "conflict" | "failed";
interface Base { vault: string; bookmarks: string; list: Bookmark[] }
const readBase = (): Base => {
  const list = bookmarkStore.getSnapshot();
  return { vault: vaultRaw(), bookmarks: JSON.stringify(list), list };
};

/**
 * Seal `entries` (pruned to the locked bookmarks of `list` plus `keep`) as the
 * vault, then store `list` if it differs: only when nothing changed since `base`.
 */
async function commit(k: SealKey, entries: VaultEntries, list: Bookmark[], base: Base, keep: VaultEntries = {}): Promise<Result> {
  const used = new Set(list.filter((b) => b.locked === true).map((b) => b.input).concat(Object.keys(keep)));
  const pruned = Object.fromEntries(Object.entries(entries).filter(([ph]) => used.has(ph)));
  // Never a locked bookmark without its key
  if (list.some((b) => b.locked === true && !Object.hasOwn(pruned, b.input))) return "failed";
  const env = await sealVault(pruned, k);
  // Synchronous from here: the checks and both writes cannot interleave with another write
  if (vaultRaw() !== base.vault || JSON.stringify(bookmarkStore.getSnapshot()) !== base.bookmarks) return "conflict";
  if (!vaultStore.set(env)) return "failed";
  setMem({ sealKey: k, entries: pruned, raw: rawOf(env) });
  return JSON.stringify(list) === base.bookmarks || bookmarkStore.set(list) ? "ok" : "failed";
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

const sealInto = (u: Unlocked, list: Bookmark[], base: Base): Promise<Result> => {
  const locked = lockWallets(list);
  return commit(u.sealKey, { ...u.entries, ...locked.extra }, locked.list, base);
};

/** Run a write against the unlocked state, redone from fresh state when another write landed meanwhile. */
async function withUnlocked(f: (u: Unlocked, base: Base) => Promise<Result>): Promise<"ok" | "locked" | "failed"> {
  for (let i = 0; i < 3; i++) {
    const u = current();
    if (!u) return "locked";
    const r = await f(u, readBase());
    if (r !== "conflict") return r;
  }
  return "failed";
}

/** Turn the lock on: every wallet bookmark's key moves into a new vault. Leaves this tab unlocked. */
export async function enableLock(password: string): Promise<boolean> {
  if (vaultStore.getSnapshot()) return false; // turned on meanwhile (another tab)
  const k = await newVaultKey(password);
  for (let i = 0; i < 3; i++) {
    const base = readBase();
    if (base.vault) return false;
    const locked = lockWallets(base.list);
    const r = await commit(k, locked.extra, locked.list, base);
    if (r === "ok") return true;
    if (r === "failed") {
      // Roll back only a vault this call wrote
      if (mem && vaultRaw() === mem.raw) vaultStore.remove();
      setMem(null);
      return false;
    }
  }
  return false;
}

/**
 * Open the vault (throws WrongPasswordError / DamagedVaultError), then lock any
 * wallet stored in clear meanwhile and drop keys no bookmark uses.
 */
export async function unlock(password: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const env = vaultStore.getSnapshot();
    if (!env) return; // turned off meanwhile
    const { entries, sealKey } = await openVault(env, password);
    if (vaultRaw() !== rawOf(env)) continue; // rewritten while opening: open the new one
    setMem({ sealKey, entries, raw: rawOf(env) });
    await withUnlocked((u, base) => {
      const needed = base.list.some((b) => b.type === "wallet" && b.locked !== true) ||
        Object.keys(u.entries).some((ph) => !base.list.some((b) => b.input === ph));
      return needed ? sealInto(u, base.list, base) : Promise.resolve("ok");
    });
    return;
  }
  throw new Error("Wallet vault keeps changing");
}

/**
 * Turn the lock off (throws WrongPasswordError): keys go back into the
 * bookmarks first, then the vault is deleted. Refuses (false) when a locked
 * bookmark has no key, so nothing is dropped.
 */
export async function disableLock(password: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const env = vaultStore.getSnapshot();
    if (!env) return true;
    const { entries } = await openVault(env, password);
    // Synchronous from here
    if (vaultRaw() !== rawOf(env)) continue;
    const list = bookmarkStore.getSnapshot();
    const byInput = new Map<string, Bookmark>();
    for (const b of list) {
      let e = b;
      if (b.locked === true) {
        const input = entries[b.input];
        if (input === undefined) return false;
        const { locked: _locked, ...rest } = b;
        e = { ...rest, input };
      }
      const cur = byInput.get(e.input);
      if (!cur || e.savedAt > cur.savedAt) byInput.set(e.input, e);
    }
    if (!bookmarkStore.set([...byInput.values()].sort((a, b) => b.savedAt - a.savedAt))) return false;
    vaultStore.remove();
    setMem(null);
    return true;
  }
  return false;
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
  const entry = { ...bookmark, savedAt: Date.now() };
  const withEntry = (list: Bookmark[]) => [entry, ...list.filter((b) => !matchesInput(b, bookmark.input))];
  if (!isLockOn()) return bookmarkStore.set(withEntry(bookmarkStore.getSnapshot())) ? "ok" : "failed";
  return withUnlocked((u, base) => sealInto(u, withEntry(base.list), base));
}

/**
 * Restore side: what to merge from a backup's bookmarks under the wallet lock.
 * - Lock off: the file's vault is adopted as is (its locked wallets come with it).
 * - Lock on and unlocked here: the file's wallets are sealed into this vault (its
 *   locked ones only when the file's vault is this same lock, or their key is already here).
 * - Lock on and locked: only locked wallets of this very vault are taken.
 * Returns null when storage is full (or the vault kept changing).
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
  const same = !!fileVault && rawOf(fileVault) === vaultRaw();
  if (!current()) return { items, acceptLocked: same, lockOn: true, dropped: 0 };

  let out: unknown[] = items;
  let dropped = 0;
  const r = await withUnlocked(async (u, base) => {
    let fileEntries: VaultEntries = {};
    if (fileVault && hasLocked && !same) {
      try { fileEntries = await openVaultWithKey(fileVault, u.sealKey); } catch { /* another lock: its locked wallets are skipped */ }
    }
    const extra: VaultEntries = {};
    dropped = 0;
    out = items.flatMap((b): unknown[] => {
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
    if (Object.keys(extra).length === 0) return "ok";
    return commit(u.sealKey, { ...u.entries, ...extra }, base.list, base, extra);
  });
  return r === "ok" ? { items: out, acceptLocked: true, lockOn: true, dropped } : null;
}

/** Lock status for the UI: on = a vault is stored, unlocked = opened in this tab. */
export function useWalletLock(): { on: boolean; unlocked: boolean } {
  const env = useSyncExternalStore(vaultStore.subscribe, vaultStore.getSnapshot, vaultStore.getServerSnapshot);
  const m = useSyncExternalStore(subscribeMem, () => mem, () => null);
  return { on: env !== null, unlocked: m !== null && m.raw === rawOf(env) };
}
