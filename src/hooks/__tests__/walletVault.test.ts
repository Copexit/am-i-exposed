// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { bookmarkStore, mergeBookmarks, type Bookmark } from "@/hooks/useBookmarks";
import { ZPUB } from "@/lib/wallet/__tests__/fake-chain";
import { placeholderFor, VAULT_KEY } from "@/lib/backup/wallet-vault";
import { walletKey } from "@/lib/wallet/saved-wallets";
import { parseXpub } from "@/lib/bitcoin/descriptor";
import { WrongPasswordError } from "@/lib/crypto/envelope";
import {
  disableLock, enableLock, forgetLockedWallets, isUnlocked, lockNow, resolveBookmarkInput, saveWalletBookmark, unlock, vaultStore,
} from "../walletVault";
import { buildBackup, restoreBackup } from "../backup";

// PBKDF2 at 600k iterations per seal/open
vi.setConfig({ testTimeout: 30_000 });

const PW = "correct horse battery";
const TXID = "a".repeat(64);
const wallet = (input = ZPUB, savedAt = 5): Bookmark => ({ input, type: "wallet", grade: "C", score: 50, savedAt, scriptType: "p2wpkh", network: "mainnet", label: "Savings" });
const tx: Bookmark = { input: TXID, type: "txid", grade: "B", score: 70, savedAt: 4 };
const OPTS = { includeWallets: true, includeSavedWallets: false, includeSettings: false };

beforeEach(() => {
  localStorage.clear();
  bookmarkStore.remove();
  vaultStore.remove();
  lockNow();
});

describe("wallet key lock", () => {
  it("enable: localStorage holds no raw key, only a placeholder distinct from walletKey", async () => {
    bookmarkStore.set([wallet(), tx]);
    expect(await enableLock(PW)).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain(ZPUB);
    const [w] = bookmarkStore.getSnapshot().filter((b) => b.type === "wallet");
    expect(w).toMatchObject({ input: placeholderFor(ZPUB), locked: true, label: "Savings", scriptType: "p2wpkh" });
    expect(w!.input).toMatch(/^wallet-locked:[0-9a-f]{16}$/);
    expect(walletKey(parseXpub(ZPUB), "https://mempool.space/api")).not.toContain(w!.input.slice(14));
    expect(localStorage.getItem(VAULT_KEY)).toContain("am-i-exposed-sealed");
  });

  it("unlock resolves; a wrong password fails; lock now and a reload lock again", async () => {
    bookmarkStore.set([wallet()]);
    await enableLock(PW);
    lockNow();
    const [w] = bookmarkStore.getSnapshot();
    expect(resolveBookmarkInput(w!)).toBeNull();
    await expect(unlock("wrong password")).rejects.toBeInstanceOf(WrongPasswordError);
    expect(isUnlocked()).toBe(false);
    await unlock(PW);
    expect(resolveBookmarkInput(w!)).toBe(ZPUB);

    vi.resetModules();
    const fresh = await import("../walletVault");
    const { bookmarkStore: freshStore } = await import("@/hooks/useBookmarks");
    expect(fresh.isUnlocked()).toBe(false);
    expect(fresh.resolveBookmarkInput(freshStore.getSnapshot()[0]!)).toBeNull();
  });

  it("disable restores the plain keys and deletes the vault", async () => {
    bookmarkStore.set([wallet(), tx]);
    await enableLock(PW);
    await expect(disableLock("nope nope")).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await disableLock(PW)).toBe(true);
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();
    const w = bookmarkStore.getSnapshot().find((b) => b.type === "wallet");
    expect(w).toEqual(wallet());
  });

  it("forgot password removes the vault and only the locked wallets", () => {
    bookmarkStore.set([{ ...wallet(placeholderFor(ZPUB)), locked: true }, tx]);
    localStorage.setItem(VAULT_KEY, JSON.stringify({ format: "am-i-exposed-sealed", v: 1, kdf: "PBKDF2-SHA256", iterations: 600000, salt: "", iv: "", gzip: true, ct: "" }));
    forgetLockedWallets();
    expect(bookmarkStore.getSnapshot()).toEqual([tx]);
    expect(localStorage.getItem(VAULT_KEY)).toBeNull();
  });

  it("a new wallet bookmark goes into the vault while unlocked, and asks first while locked", async () => {
    await enableLock(PW);
    expect(await saveWalletBookmark(wallet())).toBe("ok");
    expect(JSON.stringify(localStorage)).not.toContain(ZPUB);
    const [w] = bookmarkStore.getSnapshot();
    expect(w?.locked).toBe(true);
    expect(resolveBookmarkInput(w!)).toBe(ZPUB);

    lockNow();
    bookmarkStore.set([]);
    expect(await saveWalletBookmark(wallet())).toBe("locked");
    expect(bookmarkStore.getSnapshot()).toEqual([]);
  });

  it("plain wallet imports are skipped while the lock is on, never stored in clear", async () => {
    await enableLock(PW);
    expect(mergeBookmarks([wallet()], true)).toBe(0);
    expect(JSON.stringify(localStorage)).not.toContain(ZPUB);
  });

  it("a backup carries the vault; restore adopts it, or merges it when the same password opens both", async () => {
    bookmarkStore.set([wallet()]);
    await enableLock(PW);
    const backup = await buildBackup(OPTS);
    expect(backup.walletVault).toBeDefined();
    expect(JSON.stringify(backup)).not.toContain(ZPUB);

    // Fresh browser, lock off: the vault comes as is
    localStorage.clear(); bookmarkStore.remove(); vaultStore.remove(); lockNow();
    let r = await restoreBackup(backup, OPTS);
    expect(r).toMatchObject({ bookmarks: 1, skippedWallets: 0 });
    await unlock(PW);
    expect(resolveBookmarkInput(bookmarkStore.getSnapshot()[0]!)).toBe(ZPUB);

    // Another vault with another password: its locked wallets are skipped, this vault is kept
    localStorage.clear(); bookmarkStore.remove(); vaultStore.remove(); lockNow();
    bookmarkStore.set([tx]);
    await enableLock("another password");
    const vaultBefore = localStorage.getItem(VAULT_KEY);
    r = await restoreBackup(backup, OPTS);
    expect(r.skippedWallets).toBe(1);
    expect(localStorage.getItem(VAULT_KEY)).toBe(vaultBefore);
    expect(bookmarkStore.getSnapshot()).toEqual([tx]);
  });
});
